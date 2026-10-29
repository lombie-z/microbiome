'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import { belowVisible, isLightDevice, journey, ledgeIn } from '@/lib/journey';
import { waterLanding } from './water';

// The real waterfall: thousands of white streaks pouring over the lip of the rock ledge under the planter
// (art/build-landing.py LEDGE_TOP, LEDGE_LIP) down to the lake, accelerating as they go, which is what makes falling
// water read as water. Each is a thin quad, upright and turned to face the camera, stretched with its speed, over a
// white sheet for the curtain's body. The planter's own streams land on the ledge above it.
const LIP_TOP = -0.7; // the ledge's top (three y: Blender's z)
// The lip curves back into the cliff at both ends (the ledge is a dome half sunk in the rock: centre x 2.0, reaching
// 3.0 out and 2.7 along).
const lipX = (z: number) => 2.0 - 3.0 * Math.sqrt(Math.max(0, 1 - (z / 2.7) ** 2));
const LIP_GLSL = 'float lipX(float z) { return 2.0 - 3.0 * sqrt(max(0.0, 1.0 - pow(z / 2.7, 2.0))); }';
// The water rolls over the lip (a quarter-round of this radius) and leaves it going outward: it falls clear of the
// undercut rock in an arc, x moving out by ARC * sqrt(distance fallen).
const ROLL = 0.22;
const ARC = 0.55;
const FLOW_Y = LIP_TOP + 0.08; // the water running across the ledge's top to the lip (over its lumps)
const START_Y = FLOW_Y - ROLL; // where the free fall begins, at the foot of the roll
const BOTTOM = -11.05; // the pool
const RZ = 3.75; // the curtain's half-width across the landing's view (three z)
const AERATE = 2.2; // how far the water falls (m) before it's fully white

// At the landing the curtain splits as the reference's does: a broad main fall, a gap with a few threads, and a thin
// fall to its right. t runs across the curtain from its left edge (as the landing sees it) to its right.
const PROFILE = /* glsl */ `
float profile(float t) {
  float main = smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.56, 0.63, t));
  float thin = smoothstep(0.73, 0.77, t) * (1.0 - smoothstep(0.86, 0.9, t)) * 0.75;
  return max(max(main, thin), 0.06);
}`;

const vertexShader = /* glsl */ `
${PROFILE}
${LIP_GLSL}
uniform float uTime;
uniform float uLanding;
attribute vec3 aStart;
attribute float aSpeed;
attribute float aPhase;
attribute float aWidth;
attribute float aShade;
attribute float aLane;
varying float vAlpha;
varying float vShade;
varying vec2 vQuad;
void main() {
  float top = ${START_Y.toFixed(3)};
  float drop = top - ${BOTTOM.toFixed(2)};
  // Time to fall the whole height from this streak's starting speed under gravity; loop over it.
  float g = 9.8;
  float life = (-aSpeed + sqrt(aSpeed * aSpeed + 2.0 * g * drop)) / g;
  float t = fract(uTime / life + aPhase) * life;
  float fallen = aSpeed * t + 0.5 * g * t * t;
  float v = aSpeed + g * t;
  // Leaving the foot of the roll over the lip and arcing out, clear of the rock, widening a little toward the pool.
  float z = aStart.z * mix(0.58, 0.78, fallen / drop);
  vec3 centre = vec3(lipX(z) - ${ROLL.toFixed(2)} - aStart.x - sqrt(fallen) * ${ARC.toFixed(2)}, top - fallen, z);
  // Stretch with speed (motion blur), widen a touch as it falls and breaks up.
  // (Shorter at the landing, where the curtain is seen whole and long smears would blur its texture.)
  float len = (0.14 + v * 0.06) * mix(1.0, 0.45, uLanding);
  float width = aWidth * (1.0 + fallen * 0.08);
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 p = centre + right * position.x * width + vec3(0.0, 1.0, 0.0) * position.y * len;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vQuad = position.xy * 2.0;
  // In over the lip, out into the splash; shaped as the reference's fall (a main column, a gap, a thin fall).
  vAlpha = smoothstep(0.0, 0.12, fallen) * (1.0 - smoothstep(drop - 0.5, drop, fallen)) * profile(aLane);
  // Glassy going over the lip, white once it's fallen a way and broken up: the broad, soft streaks (the curtain's
  // white haze) come in over the first couple of metres, the fine ones thicken. (Less so at the landing, seen whole.)
  float aerate = smoothstep(0.0, ${AERATE.toFixed(1)}, fallen);
  float clear = aWidth > 0.08 ? aerate : mix(0.55, 1.0, aerate);
  vAlpha *= mix(clear, 1.0, 0.5 * uLanding);
  vShade = aShade;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uLanding;
varying float vAlpha;
varying float vShade;
varying vec2 vQuad;
void main() {
  float a = (1.0 - vQuad.x * vQuad.x) * (1.0 - smoothstep(0.3, 1.0, abs(vQuad.y)));
  // Thinner on the way down (the camera is close), full at the landing.
  gl_FragColor = vec4(uColor * vShade, a * vAlpha * uOpacity * mix(0.6, 0.55, uLanding));
  #include <colorspace_fragment>
}`;

const sheetVertex = /* glsl */ `
${LIP_GLSL}
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  // As wide as the strands' curtain: narrower at the top, widening as it falls.
  p.x *= mix(0.74, 0.58, uv.y);
  // Curving round with the ledge's lip and arcing out as it falls, as the strands do (the plane's local z is the
  // world's -x; it sits at x 0).
  float fallen = (1.0 - uv.y) * ${(START_Y - BOTTOM).toFixed(3)};
  p.z = -(lipX(p.x) - ${ROLL.toFixed(2)} - 0.06 - sqrt(fallen) * ${ARC.toFixed(2)});
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const sheetFragment = /* glsl */ `
${PROFILE}
uniform float uTime;
uniform float uLanding;
uniform float uIn;
uniform float uFlow;
varying vec2 vUv;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1, 0)), u.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  // Vertical ropes racing down, brighter and dimmer.
  float ropes = fNoise(vec2(vUv.x * 60.0, vUv.y * 3.0 + uTime * 1.4)) * 0.5 + fNoise(vec2(vUv.x * 170.0, vUv.y * 7.0 + uTime * 2.2)) * 0.3
    + fNoise(vec2(vUv.x * 420.0, vUv.y * 14.0 + uTime * 3.0)) * 0.2;
  // Packets of foam racing down the ropes: the frothy clumps that make a real fall's texture.
  float clumps = smoothstep(0.55, 0.8, fNoise(vec2(vUv.x * 28.0, vUv.y * 5.0 + uTime * 2.6)) * 0.6
    + fNoise(vec2(vUv.x * 80.0, vUv.y * 14.0 + uTime * 3.4)) * 0.4);
  // Ragged sides that shift as it falls, not a clean edge: the profile is sampled a little off to each side.
  float wobble = (fNoise(vec2(vUv.y * 9.0 + uTime * 2.0, 3.0)) - 0.5) * 0.08;
  vec2 q = vec2(vUv.x + wobble, vUv.y);
  float edge = smoothstep(0.0, 0.08, q.x) * smoothstep(1.0, 0.92, q.x);
  // Frayed sides: the ropes thin out toward the edges.
  edge *= smoothstep(0.2, 0.5, ropes + edge * 0.5);
  // Crisp strands: a narrow step between rope and gap, so the curtain reads as distinct falling ropes, not a smear.
  float body = max(smoothstep(0.42, 0.56, ropes), clumps);
  // See-through in the gaps between ropes (the rock shows dark behind), solid in the ropes and foam.
  // (On the ledge's top the water fades in from the back, running toward the lip.)
  float a = uIn * mix(1.0, smoothstep(1.0, 0.55, vUv.y), uFlow) * mix(0.7, 1.0, uLanding) * edge * mix(0.45, 1.0, body) * smoothstep(0.0, 0.04, vUv.y) * smoothstep(0.1, 0.5, profile(q.x));
  // Glassy over the lip, white once it's fallen a way (the ledge-top flow is left as it is).
  float aerate = mix(smoothstep(0.0, ${AERATE.toFixed(1)}, (1.0 - vUv.y) * ${(START_Y - BOTTOM).toFixed(3)}), 1.0, uFlow);
  a *= mix(mix(0.35, 1.0, aerate), 1.0, 0.5 * uLanding);
  vec3 c = vec3(1.35, 1.24, 1.08) * mix(0.45, 1.15, body) * mix(1.0, 0.86, vUv.x);
  c += vec3(0.35, 0.3, 0.25) * clumps;
  // The low sun from the left: the main column's sunward edge glows gold, and light comes through where it's thin.
  float sunward = 1.0 - smoothstep(0.02, 0.2, q.x);
  c += vec3(0.6, 0.42, 0.18) * sunward * body;
  c += vec3(0.5, 0.36, 0.2) * (1.0 - body) * 0.6;
  // Glitter: droplets in the ropes flashing in the low sun, bright enough to bloom.
  float glitter = smoothstep(0.78, 0.92, fNoise(vec2(vUv.x * 520.0, vUv.y * 70.0 + uTime * 7.0))) * body;
  c += vec3(2.2, 1.8, 1.3) * glitter;
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

export function FallStreaks() {
  const { geometry, material } = useMemo(() => {
    const count = isLightDevice() ? 3500 : 10000;
    const geometry = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    const start = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    const phase = new Float32Array(count);
    const width = new Float32Array(count);
    const shade = new Float32Array(count);
    const laneAt = new Float32Array(count);
    // Water in a fall travels in strands: lanes across the curtain, some thick with water and some thin, so it shows
    // bright ropes with darker gaps rather than an even smear.
    const LANES = 96;
    const lanes = Array.from({ length: LANES }, (_, k) => ({
      at: (k + 0.5) / LANES,
      weight: 0.15 + Math.random() ** 2 * 1.6,
    }));
    const total = lanes.reduce((sum, l) => sum + l.weight, 0);
    for (let i = 0; i < count; i++) {
      let pick = Math.random() * total;
      let lane = lanes[LANES - 1];
      for (const l of lanes) {
        pick -= l.weight;
        if (pick <= 0) {
          lane = l;
          break;
        }
      }
      // Across the width (frayed at the edges), through the depth.
      const across = Math.max(-1.15, Math.min(1.15, (lane.at * 2 - 1) * 1.08 + (Math.random() - 0.5) * 0.02));
      const a = Math.asin(Math.max(-1, Math.min(1, across)));
      // Just off the lip, a little depth to the sheet of water going over it.
      start[i * 3 + 1] = LIP_TOP;
      start[i * 3 + 2] = across * RZ;
      // (x: how far each strand sits off the water's face, a little depth to the falling sheet.)
      start[i * 3] = Math.random() * 0.18;
      laneAt[i] = lane.at;
      speed[i] = 2.5 + Math.random() * 2.5;
      phase[i] = Math.random();
      // Mostly fine streaks, with some broad and soft: the curtain's white body round the ropes.
      const body = Math.random() < 0.18;
      width[i] = body ? 0.1 + Math.random() * 0.12 : 0.012 + Math.random() * 0.03;
      // Sunlit on the sun's side (-z), greyer in the thin lanes.
      shade[i] = (body ? 0.85 : 0.75 + Math.random() * 0.35) * (0.85 + 0.15 * Math.min(lane.weight, 1)) * (1.0 - 0.1 * Math.sin(a));
    }
    geometry.setAttribute('aStart', new InstancedBufferAttribute(start, 3));
    geometry.setAttribute('aSpeed', new InstancedBufferAttribute(speed, 1));
    geometry.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
    geometry.setAttribute('aWidth', new InstancedBufferAttribute(width, 1));
    geometry.setAttribute('aShade', new InstancedBufferAttribute(shade, 1));
    geometry.setAttribute('aLane', new InstancedBufferAttribute(laneAt, 1));
    geometry.instanceCount = count;
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uLanding: waterLanding,
        // A touch past white, so the bloom gives the curtain its glow.
        uColor: { value: new Color(1.45, 1.38, 1.28) },
        uOpacity: { value: 0.5 },
      },
      // (Both sides, so the lake's mirror, which sees them flipped, reflects the fall's strands too.)
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    return { geometry, material };
  }, []);

  const sheet = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: sheetVertex,
        fragmentShader: sheetFragment,
        uniforms: { uTime: { value: 0 }, uLanding: waterLanding, uIn: { value: 0 }, uFlow: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    []
  );

  // The water running across the ledge's top to the lip and rolling over it, where the curtain begins.
  const flow = useMemo(() => {
    const geometry = new BufferGeometry();
    const ACROSS = 64;
    const ALONG = 24;
    const half = RZ * 0.58;
    const positions: number[] = [];
    const uvs: number[] = [];
    for (let j = 0; j <= ALONG; j++) {
      const t = j / ALONG;
      for (let i = 0; i <= ACROSS; i++) {
        const z = -half + (2 * half * i) / ACROSS;
        let x: number;
        let y: number;
        if (t < 0.65) {
          x = lipX(z) + (1 - t / 0.65) * 1.1;
          y = FLOW_Y;
        } else {
          const a = ((t - 0.65) / 0.35) * (Math.PI / 2);
          x = lipX(z) - Math.sin(a) * ROLL;
          y = FLOW_Y - (1 - Math.cos(a)) * ROLL;
        }
        positions.push(x, y, z);
        uvs.push(i / ACROSS, 1 - t);
      }
    }
    const index: number[] = [];
    for (let j = 0; j < ALONG; j++)
      for (let i = 0; i < ACROSS; i++) {
        const a = j * (ACROSS + 1) + i;
        index.push(a, a + 1, a + ACROSS + 1, a + 1, a + ACROSS + 2, a + ACROSS + 1);
      }
    geometry.setIndex(index);
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    const material = new ShaderMaterial({
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: sheetFragment,
      uniforms: { uTime: sheet.uniforms.uTime, uLanding: waterLanding, uIn: sheet.uniforms.uIn, uFlow: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    return { geometry, material };
  }, [sheet]);

  useFrame((state) => {
    flow.material.visible = belowVisible(journey.frame);
    material.uniforms.uTime.value = state.clock.elapsedTime;
    sheet.uniforms.uTime.value = state.clock.elapsedTime;
    // Both only with the world below (lib/journey.ts belowVisible): the ledge is part of it.
    const real = belowVisible(journey.frame);
    material.visible = real;
    sheet.visible = real;
    // Coming in with the ledge.
    const fadeIn = ledgeIn(journey.frame);
    material.uniforms.uOpacity.value = 0.5 * fadeIn;
    sheet.uniforms.uIn.value = fadeIn;
  });

  return (
    <>
      <mesh name="SprayFall" geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />
      <mesh name="SprayFallFlow" geometry={flow.geometry} material={flow.material} frustumCulled={false} renderOrder={2} />
      {/* The curtain's body: a white sheet behind the strands, so the cliff doesn't show through. */}
      <mesh
        name="SprayFallSheet"
        material={sheet}
        position={[0, (START_Y + BOTTOM) / 2, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        frustumCulled={false}
        renderOrder={2}
      >
        <planeGeometry args={[RZ * 2, START_Y - BOTTOM, 64, 160]} />
      </mesh>
    </>
  );
}

'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { Color, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry, ShaderMaterial } from 'three';
import { isLightDevice } from '@/lib/journey';
import { waterLanding } from './water';

// The big fall's body: thousands of white streaks pouring down the curtain (art/build-spill.py main_fall) and
// accelerating as they go, which is what makes falling water read as water. Each is a thin quad, upright and turned to
// face the camera, stretched with its speed. The fall's mesh is the faint sheet behind them.
const TOP = -5.9; // in the braid's lower end, where the streams have fused
const LANDING_TOP = 0.6; // at the landing the curtain pours from above the frame, as the reference's fall
const BOTTOM = -11.05; // the pool
const RX = 1.45; // the curtain's half-depth (three x)
const RZ = 3.75; // its half-width across the landing's view (three z)

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
  float top = mix(${TOP.toFixed(2)}, ${LANDING_TOP.toFixed(2)}, uLanding);
  float drop = top - ${BOTTOM.toFixed(2)};
  // Time to fall the whole height from this streak's starting speed under gravity; loop over it.
  float g = 9.8;
  float life = (-aSpeed + sqrt(aSpeed * aSpeed + 2.0 * g * drop)) / g;
  float t = fract(uTime / life + aPhase) * life;
  float fallen = aSpeed * t + 0.5 * g * t * t;
  float v = aSpeed + g * t;
  // Pour out of the braid's narrow end and fan out into the full curtain over the first metre and a half.
  vec3 centre = vec3(aStart.x, top - fallen, aStart.z);
  // At the landing it's one broad curtain from the top, a little narrower than the braid's fan and widening slowly.
  float fan = mix(mix(0.12, 1.0, smoothstep(0.0, 1.6, fallen)), mix(0.62, 0.78, fallen / drop), uLanding);
  centre.xz *= fan;
  // Stretch with speed (motion blur), widen a touch as it falls and breaks up.
  float len = 0.14 + v * 0.06;
  float width = aWidth * (1.0 + fallen * 0.08);
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 p = centre + right * position.x * width + vec3(0.0, 1.0, 0.0) * position.y * len;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vQuad = position.xy * 2.0;
  // Fade in below the braid and out into the splash.
  vAlpha = smoothstep(0.0, 0.9, fallen) * (1.0 - smoothstep(drop - 0.5, drop, fallen)) * mix(1.0, profile(aLane), uLanding);
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
  // Thinner on the way down beside the braid (the camera is right in it), full at the landing.
  gl_FragColor = vec4(uColor * vShade, a * vAlpha * uOpacity * mix(0.6, 1.0, uLanding));
  #include <colorspace_fragment>
}`;

const sheetVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  // As wide as the strands' curtain: narrower at the top, widening as it falls.
  p.x *= mix(0.74, 0.58, uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const sheetFragment = /* glsl */ `
${PROFILE}
uniform float uTime;
uniform float uLanding;
varying vec2 vUv;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1, 0)), u.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  // Vertical ropes racing down, brighter and dimmer.
  float ropes = fNoise(vec2(vUv.x * 60.0, vUv.y * 4.0 + uTime * 1.4)) * 0.6 + fNoise(vec2(vUv.x * 170.0, vUv.y * 9.0 + uTime * 2.2)) * 0.4;
  float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
  // Frayed sides: the ropes thin out toward the edges.
  edge *= smoothstep(0.2, 0.5, ropes + edge * 0.5);
  float a = uLanding * edge * mix(0.55, 0.9, ropes) * smoothstep(0.0, 0.04, vUv.y) * smoothstep(0.1, 0.5, profile(vUv.x));
  // Deep shadowed gaps between bright ropes, as in the reference's fall.
  vec3 c = vec3(1.25, 1.2, 1.12) * mix(0.45, 1.1, smoothstep(0.25, 0.75, ropes)) * mix(1.0, 0.88, vUv.x);
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
      start[i * 3] = (Math.random() * 2 - 1) * RX * 0.8;
      start[i * 3 + 1] = TOP;
      start[i * 3 + 2] = across * RZ;
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
        uniforms: { uTime: { value: 0 }, uLanding: waterLanding },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    []
  );

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    sheet.uniforms.uTime.value = state.clock.elapsedTime;
    sheet.visible = waterLanding.value > 0.01;
  });

  return (
    <>
      <mesh name="SprayFall" geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />
      {/* The curtain's body at the landing: a white sheet behind the strands, so the cliff doesn't show through. */}
      <mesh
        name="SprayFallSheet"
        material={sheet}
        position={[0, (LANDING_TOP + BOTTOM) / 2, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        frustumCulled={false}
        renderOrder={2}
      >
        <planeGeometry args={[RZ * 2, LANDING_TOP - BOTTOM, 1, 1]} />
      </mesh>
    </>
  );
}

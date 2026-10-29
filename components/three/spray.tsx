'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, type Mesh, type Object3D, ShaderMaterial, Vector3 } from 'three';
import { isLightDevice, journey, landingAt } from '@/lib/journey';

// Spray and mist as GPU particles. Each particle loops through its own short life: it starts at aStart, moves with
// aVelocity under gravity, and fades in and out. One material, tuned per system.

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uGravity;
uniform float uScale;
attribute vec3 aStart;
attribute vec3 aVelocity;
attribute float aPhase;
attribute float aLife;
attribute float aSize;
varying float vAlpha;
varying float vSeed;
void main() {
  float t = fract(uTime / aLife + aPhase) * aLife;
  float k = t / aLife;
  vec3 p = aStart + aVelocity * t + vec3(0.0, 0.5 * uGravity * t * t, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Size in world units, so near drops are big and far ones are specks.
  gl_PointSize = aSize * uScale * projectionMatrix[1][1] / -mv.z;
  vAlpha = sin(3.14159 * k) * smoothstep(0.03, 0.4, -mv.z);
  vSeed = aPhase * 37.0;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSoftness;
varying float vAlpha;
varying float vSeed;
float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1, 0)), u.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(1.0 - uSoftness, 1.0, d);
  // Soft sprites (mist) get billows: noise inside the disc, each particle its own.
  if (uSoftness > 0.9) {
    vec2 q = gl_PointCoord * 3.0 + vSeed;
    float b = sNoise(q) * 0.6 + sNoise(q * 2.3) * 0.3 + sNoise(q * 5.1) * 0.1;
    a *= smoothstep(0.38, 0.58, b + (1.0 - d) * 0.35);
  }
  // Soft sprites are lit from above: brighter crowns, shadowed undersides.
  vec3 colour = uColor * (uSoftness > 0.9 ? mix(0.78, 1.12, 1.0 - gl_PointCoord.y) : 1.0);
  gl_FragColor = vec4(colour, a * vAlpha * uOpacity);
  #include <colorspace_fragment>
}`;

interface System {
  count: number;
  /** Writes one particle's start, velocity, life (s) and size (m). */
  emit: (i: number, start: Vector3, velocity: Vector3) => { life: number; size: number };
  gravity: number;
  color: string | Color;
  opacity: number;
  softness: number;
}

function particles({ count, emit, gravity, color, opacity, softness }: System) {
  const start = new Float32Array(count * 3);
  const velocity = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const life = new Float32Array(count);
  const size = new Float32Array(count);
  const s = new Vector3();
  const v = new Vector3();
  for (let i = 0; i < count; i++) {
    const p = emit(i, s.set(0, 0, 0), v.set(0, 0, 0));
    s.toArray(start, i * 3);
    v.toArray(velocity, i * 3);
    phase[i] = Math.random();
    life[i] = p.life;
    size[i] = p.size;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aStart', new BufferAttribute(start, 3));
  geometry.setAttribute('aVelocity', new BufferAttribute(velocity, 3));
  geometry.setAttribute('aPhase', new BufferAttribute(phase, 1));
  geometry.setAttribute('aLife', new BufferAttribute(life, 1));
  geometry.setAttribute('aSize', new BufferAttribute(size, 1));
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uGravity: { value: gravity },
      uScale: { value: 1 },
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
      uSoftness: { value: softness },
    },
    transparent: true,
    depthWrite: false,
  });
  return { geometry, material };
}

/** Random points on the falling water (where it's falling, not still), with their outward normals. */
function fallSurface(scene: Object3D) {
  const points: { p: Vector3; n: Vector3 }[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.name.startsWith('Fall') || mesh.name.startsWith('FallMain')) return;
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const flow = g.getAttribute('_flow');
    const fade = g.getAttribute('_fade');
    for (let i = 0; i < pos.count; i += 3) {
      // Only where the water is falling and fully there (not the still channel, nor where the streams fade out).
      if ((flow && flow.getX(i) < 0.5) || (fade && fade.getX(i) < 0.95)) continue;
      const p = new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      // (Only above the rock ledge they land on.)
      if (p.y < -0.7) continue;
      const n = new Vector3().fromBufferAttribute(nor, i).transformDirection(mesh.matrixWorld);
      points.push({ p, n });
    }
  });
  return points;
}

const POOL_Y = -11;
// The big fall's foot (art/build-spill.py): a curtain about 3 deep (x) and 7.7 wide (z) where it meets the pool.
const FALL_FOOT = 3.2;
// The rock ledge's lip, where the planter's streams land and the real fall pours over (art/build-landing.py).
const LIP = new Vector3(-1.05, -0.8, 0);

/** Gives a system an opacity that follows the landing (0 to 1), set in Spray's frame loop. */
function withLanding(system: ReturnType<typeof particles>, opacity: (landing: number) => number) {
  system.material.userData.opacity = opacity;
  return system;
}

export function Spray({ scene }: { scene: Object3D }) {
  const systems = useMemo(() => {
    const share = isLightDevice() ? 0.45 : 1;
    const surface = fallSurface(scene);
    const pick = () => surface[Math.floor(Math.random() * surface.length)];
    return [
      // Drops peeling off the falls and dropping away.
      particles({
        count: Math.round(2600 * share),
        gravity: -3,
        color: '#eef6ff',
        opacity: 0.9,
        softness: 0.5,
        emit: (_, start, velocity) => {
          const { p, n } = pick();
          start.copy(p).addScaledVector(n, 0.01);
          velocity
            .copy(n)
            .multiplyScalar(0.12 + Math.random() * 0.25)
            .add(new Vector3(0, -0.9, 0));
          return { life: 0.5 + Math.random() * 0.6, size: 0.006 + Math.random() * 0.012 };
        },
      }),
      // Kicked up where the big fall lands.
      particles({
        count: Math.round(1400 * share),
        gravity: -4.5,
        color: '#f2f8ff',
        opacity: 0.95,
        softness: 0.5,
        emit: (_, start, velocity) => {
          const a = Math.random() * Math.PI * 2;
          const r = 0.38 + Math.random() * 0.15;
          start.set(Math.cos(a) * r, POOL_Y + 0.02, Math.sin(a) * r);
          velocity
            .set(Math.cos(a), 0, Math.sin(a))
            .multiplyScalar(0.3 + Math.random() * 0.7)
            .add(new Vector3(0, 1 + Math.random() * 1.6, 0));
          return { life: 0.5 + Math.random() * 0.5, size: 0.01 + Math.random() * 0.02 };
        },
      }),
      // Mist off the pool, rising and spreading slowly.
      withLanding(
        particles({
          count: 300,
          gravity: 0,
          color: '#fff0e2',
          opacity: 0.2,
          softness: 1,
          emit: (_, start, velocity) => {
            // A great billowing cloud of mist at the fall's foot, rolling up and out over the lake.
            const a = Math.random() * Math.PI * 2;
            const r = FALL_FOOT * 0.6 + Math.random() * 3.5;
            start.set(Math.cos(a) * r * 0.7, POOL_Y + 0.05 + Math.random() * 0.8, Math.sin(a) * r * 1.1);
            velocity.set(Math.cos(a) * 0.18, 0.2 + Math.random() * 0.3, Math.sin(a) * 0.18);
            return { life: 6 + Math.random() * 5, size: 2 + Math.random() * 2.5 };
          },
        }),
        // The landing's mist bank takes over from this broad haze.
        (landing) => 0.2 * (1 - 0.8 * landing)
      ),
      // At the landing: a bank of mist rolling off the fall's foot and along the cliffs' base, lit by the low sun (the
      // reference's great white billows). Only visible from afar, so it fades in with the landing.
      withLanding(
        particles({
          count: Math.round(240 * share),
          gravity: 0,
          // Past white: backlit by the low sun, it blooms, as the reference's billows blaze.
          color: new Color(1.5, 1.38, 1.2),
          opacity: 0,
          softness: 1,
          emit: (_, start, velocity) => {
            // Thickest at the fall's foot, thinning out along the cliffs (mostly toward the sun, -z).
            const along = (Math.random() < 0.7 ? -1 : 0.6) * Math.random() ** 1.8 * 9;
            const height = Math.random() ** 2.5 * 3.4 * (1 - Math.abs(along) / 12);
            start.set(-1.2 + Math.random() * 2.8, POOL_Y + 0.2 + height, along);
            velocity.set((Math.random() - 0.5) * 0.12, 0.08 + Math.random() * 0.12, (Math.random() - 0.5) * 0.25);
            return { life: 9 + Math.random() * 6, size: 1.2 + Math.random() * 2.0 };
          },
        }),
        (landing) => 0.3 * landing
      ),
      // A softer haze where the water goes over the ledge.
      particles({
        count: 40,
        gravity: 0,
        color: '#ffffff',
        opacity: 0.1,
        softness: 1,
        emit: (_, start, velocity) => {
          // Spray off the lip where the water goes over, along its width.
          start.set(LIP.x - Math.random() * 0.3, LIP.y - Math.random() * 0.6, (Math.random() * 2 - 1) * 2.0);
          velocity.set(-0.08 - Math.random() * 0.08, -0.12, (Math.random() - 0.5) * 0.06);
          return { life: 5 + Math.random() * 3, size: 0.6 + Math.random() * 0.6 };
        },
      }),
    ];
  }, [scene]);

  useFrame((state) => {
    for (const { material } of systems) {
      material.uniforms.uTime.value = state.clock.elapsedTime;
      // The landing's mist bank (opacity 0 at rest) fades in as the camera arrives.
      if (material.userData.opacity) material.uniforms.uOpacity.value = material.userData.opacity(landingAt(journey.frame));
      material.uniforms.uScale.value = state.size.height * state.viewport.dpr * 0.5;
    }
  });

  return (
    <>
      {systems.map(({ geometry, material }) => (
        <points key={material.uuid} name="Spray" geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />
      ))}
    </>
  );
}

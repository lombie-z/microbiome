'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry, ShaderMaterial } from 'three';
import { journey, landingAt } from '@/lib/journey';

// The great billows of spray at the fall's foot, as in the reference: heaped cauliflower clouds sitting on the water,
// their crowns blazing in the low sun and their undersides in soft shadow, thickest at the fall and trailing off along
// the cliffs. Each is a camera-facing card drawing its own churning heap; only shown at the landing (from up close,
// the spray particles do this job).

const POOL_Y = -11;

const vertexShader = /* glsl */ `
attribute vec3 aCentre;
attribute vec2 aSize;
attribute float aSeed;
attribute float aAlpha;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
void main() {
  vUv = uv;
  vSeed = aSeed;
  vAlpha = aAlpha;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  // Cards stand upright (heaps sit on the water) and turn to face the camera round the vertical.
  right = normalize(vec3(right.x, 0.0, right.z));
  vec3 p = aCentre + right * position.x * aSize.x + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * aSize.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
float mHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float mNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mHash(i), mHash(i + vec2(1, 0)), u.x), mix(mHash(i + vec2(0, 1)), mHash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * mNoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return v;
}
// The heap: a dome rising from a flat base, its outline broken into billows that roll slowly upward.
float heap(vec2 uv) {
  vec2 q = vec2((uv.x - 0.5) * 2.0, uv.y);
  float dome = 1.0 - length(vec2(q.x, q.y * 1.15));
  vec2 p = uv * vec2(3.2, 2.6) + vec2(vSeed * 13.0, -uTime * 0.06 + vSeed * 7.0);
  float billows = fbm(p) - 0.5 + 0.35 * (fbm(p * 2.7 + 3.0) - 0.5);
  return dome + billows * 0.75;
}
void main() {
  float d = heap(vUv);
  // A soft foot, so the card never shows a hard bottom edge on the water.
  float a = smoothstep(0.02, 0.22, d) * smoothstep(0.0, 0.22, vUv.y);
  if (a < 0.01) discard;
  // Lit from the low sun, up and to the left: brighter where the heap thins toward it (its sunward crowns), and
  // brightest at the very edges where light shines through.
  float toward = heap(vUv + vec2(-0.03, 0.05));
  float lit = clamp((d - toward) * 6.0 + 0.55, 0.0, 1.0);
  float rim = 1.0 - smoothstep(0.02, 0.3, d);
  vec3 shade = vec3(0.86, 0.74, 0.72);
  vec3 sun = vec3(1.55, 1.36, 1.1);
  vec3 c = mix(shade, sun, lit) + vec3(0.6, 0.45, 0.25) * rim;
  // Lower down it's denser and darker, near the water.
  c *= mix(0.86, 1.0, smoothstep(0.0, 0.5, vUv.y));
  gl_FragColor = vec4(c, a * uOpacity * vAlpha);
  #include <colorspace_fragment>
}`;

// Heaps (x and z in three's space: z negative toward the sun; height; width; optional opacity): at the fall's foot, then trailing away
// along the cliffs' feet into the bay as fainter veils that layer the distance.
const HEAPS: ([number, number, number, number] | [number, number, number, number, number])[] = [
  [-0.6, -0.5, 3.6, 5.5],
  [0.1, 1.8, 2.8, 4.2],
  [0.8, -3.0, 3.0, 4.8],
  [-0.6, -5.4, 2.3, 4.4],
  [0.1, 3.5, 1.9, 3.2],
  [0.8, -7.6, 1.8, 3.8],
  [-0.6, -9.6, 1.3, 3.2],
  [0.1, 0.8, 4.4, 3.6],
  [0.8, -1.9, 4.0, 3.4],
  // Spray climbing the cliffs either side of the fall, tall and thin.
  [1.6, -4.2, 8.5, 5.0, 0.3],
  [1.8, 3.2, 7.0, 4.0, 0.3],
  [2.2, -8.5, 6.0, 5.5, 0.35],
  // Veils further off, in front of the spur and out into the bay.
  [4, -13, 2.2, 7],
  [9, -17, 2.6, 9],
  [15, -21, 3.0, 11],
  [22, -24, 3.2, 12],
];
export function MistBank() {
  const { geometry, material } = useMemo(() => {
    const geometry = new InstancedBufferGeometry();
    const card = new PlaneGeometry(1, 1);
    geometry.index = card.index;
    geometry.setAttribute('position', card.getAttribute('position'));
    geometry.setAttribute('uv', card.getAttribute('uv'));
    const centre = new Float32Array(HEAPS.length * 3);
    const size = new Float32Array(HEAPS.length * 2);
    const seed = new Float32Array(HEAPS.length);
    const alpha = new Float32Array(HEAPS.length);
    HEAPS.forEach(([x, z, height, width, opacity = 1], i) => {
      alpha[i] = opacity;
      centre.set([x, POOL_Y - 0.2, z], i * 3);
      size.set([width, height], i * 2);
      seed[i] = i * 0.37 + 0.1;
    });
    geometry.setAttribute('aCentre', new InstancedBufferAttribute(centre, 3));
    geometry.setAttribute('aSize', new InstancedBufferAttribute(size, 2));
    geometry.setAttribute('aSeed', new InstancedBufferAttribute(seed, 1));
    geometry.setAttribute('aAlpha', new InstancedBufferAttribute(alpha, 1));
    geometry.instanceCount = HEAPS.length;
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      // Both sides: the lake's mirror sees the cards from behind (a reflection flips faces), and the billows should be
      // in the water too.
      side: DoubleSide,
    });
    return { geometry, material };
  }, []);

  useFrame((state) => {
    const landing = landingAt(journey.frame);
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uOpacity.value = 0.72 * landing;
  });

  return <mesh name="SprayMistBank" geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />;
}

'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { CircleGeometry, Color, Vector3 } from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { isLightDevice } from '@/lib/journey';
import { SUN_POSITION } from './sky';

// The lake under the landing (art/build-landing.py LAKE_CENTRE, LAKE_Z; Blender's -y is three's z): a still mirror of
// the cliffs, the fall and the low sun, as in the reference. three's Reflector renders the mirrored view; this shader
// ripples it slightly, mixes in the water's own colour where you look down into it, and scatters sun sparkles.
const CENTRE = new Vector3(-5, -11, 0);
const RADIUS = 45;

const LakeShader = {
  name: 'LakeShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uSun: { value: new Vector3() },
    uDeep: { value: new Color('#6e5a4c') },
    uGlint: { value: new Color('#ffd9a0') },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec3 uSun;
    uniform vec3 uDeep;
    uniform vec3 uGlint;
    varying vec4 vUv;
    varying vec3 vWorld;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    // Small wind ripples: two drifting noise layers give the surface a gently moving normal.
    float ripples(vec2 p) {
      return vnoise(p * 2.2 + uTime * 0.35) + 0.5 * vnoise(p * 5.3 - uTime * 0.6);
    }
    vec3 rippleNormal(vec2 p) {
      float e = 0.05;
      float h0 = ripples(p);
      return normalize(vec3(-(ripples(p + vec2(e, 0.0)) - h0) / e * 0.06, 1.0, -(ripples(p + vec2(0.0, e)) - h0) / e * 0.06));
    }
    void main() {
      vec3 n = rippleNormal(vWorld.xz);
      vec3 v = normalize(cameraPosition - vWorld);
      // The mirrored view, nudged by the ripples.
      vec4 uv = vUv;
      // Gentle: the reference's lake is nearly glassy, its reflections only shivering.
      uv.xy += n.xz * uv.w * 0.012;
      // Reflections warm a touch, as water does under a low gold sun.
      vec3 reflection = texture2DProj(tDiffuse, uv).rgb * vec3(1.06, 0.98, 0.86);
      // Fresnel: mostly reflection at the low angles we see the lake from, the water's own colour looking down.
      float fresnel = 0.25 + 0.75 * pow(1.0 - max(dot(v, n), 0.0), 3.0);
      vec3 col = mix(uDeep, reflection, fresnel);
      // Sun sparkles: a tight highlight on the ripples, broken up so it glitters, bright enough for the bloom.
      vec3 l = normalize(uSun - vWorld);
      float spec = pow(max(dot(reflect(-l, n), v), 0.0), 260.0);
      float glitter = step(0.72, vnoise(vWorld.xz * 14.0 + uTime * 1.5));
      col += uGlint * spec * (0.6 + 6.0 * glitter);
      // The sun's path across the water: a broad band of glitter toward it, as the reference's sparkling lake.
      float path = pow(max(dot(reflect(-l, vec3(0.0, 1.0, 0.0)), v), 0.0), 30.0);
      float fine = step(0.8, vnoise(vWorld.xz * vec2(9.0, 26.0) + uTime * vec2(0.8, 1.7)));
      col += uGlint * path * fine * 1.8;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export function Lake() {
  const light = isLightDevice();
  const lake = useMemo(() => {
    const size = light ? 512 : 1024;
    const mirror = new Reflector(new CircleGeometry(RADIUS, 128), { textureWidth: size, textureHeight: size, clipBias: 0.003, shader: LakeShader });
    mirror.name = 'Lake';
    mirror.position.copy(CENTRE);
    mirror.rotation.x = -Math.PI / 2;
    return mirror;
  }, [light]);
  useEffect(() => () => lake.dispose(), [lake]);

  useFrame((state) => {
    const uniforms = (lake.material as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
    uniforms.uTime.value = state.clock.elapsedTime;
    (uniforms.uSun.value as Vector3).copy(SUN_POSITION);
  });

  return <primitive object={lake} />;
}

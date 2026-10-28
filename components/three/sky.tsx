'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BackSide, Color, type DirectionalLight, Fog, type Mesh, ShaderMaterial, Vector3 } from 'three';
import { BEATS, journey, smoothstep } from '@/lib/journey';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Above the clouds everything sits on the blog's plaster; below them the sky warms into a low sun.
export const PLASTER = new Color('#f5f2ed');
const SKY_TOP = new Color('#e9b0ad');
const SKY_HORIZON = new Color('#ffdcac');
const SUN_GLOW = new Color('#ffcf88');
const CLOUD_LIT = new Color('#ffd9b0');
const CLOUD_SHADE = new Color('#e9a3a6');
const WARM_LIGHT = new Color('#ffc890');
/** Where the sun sits (art/build-sky.py), in three.js space (y up). */
export const SUN_POSITION = new Vector3(60, -0.5, -20);

/** 0 above the clouds, 1 once the sun is fully out. */
export const bloomAt = (frame: number) => smoothstep(BEATS.sunIn, BEATS.sunFull, frame);

const vertexShader = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uSun;
uniform float uOpacity;
uniform float uTime;
varying vec3 vDirection;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return v;
}
void main() {
  vec3 d = normalize(vDirection);
  vec3 sky = mix(uHorizon, uTop, smoothstep(-0.05, 0.6, d.y));
  float toward = max(dot(d, uSun), 0.0);
  // A wide warm haze around the sun and a brighter halo close in (the sun disc itself is a mesh, for the rays).
  sky += uGlow * (pow(toward, 5.0) * 0.45 + pow(toward, 48.0) * 0.8);
  // Soft drifting clouds on a dome overhead: lit gold toward the sun, rosy away from it, thinning to the horizon.
  vec2 uv = d.xz / (d.y + 0.18) * 1.2 + vec2(uTime * 0.004, 0.0);
  float c = smoothstep(0.48, 0.78, fbm(uv));
  float shade = smoothstep(0.45, 0.9, fbm(uv * 1.7 + 3.0));
  vec3 cloud = mix(uCloudLit, uCloudShade, shade * 0.7) + uGlow * pow(toward, 6.0) * 0.6;
  sky = mix(sky, cloud, c * smoothstep(0.02, 0.25, d.y) * 0.85);
  gl_FragColor = vec4(sky, uOpacity);
  #include <colorspace_fragment>
}`;

/** The sky dome, fog and warm sun light, all following the journey. */
export function Sky({ sun }: { sun: Mesh | null }) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const dome = useRef<Mesh>(null);
  const light = useRef<DirectionalLight>(null);
  const fog = useMemo(() => new Fog(PLASTER.clone(), 1000, 2000), []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTop: { value: SKY_TOP },
          uHorizon: { value: SKY_HORIZON },
          uGlow: { value: SUN_GLOW },
          uCloudLit: { value: CLOUD_LIT },
          uCloudShade: { value: CLOUD_SHADE },
          uTime: { value: 0 },
          uSun: { value: SUN_POSITION.clone().normalize() },
          uOpacity: { value: 0 },
        },
        side: BackSide,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    []
  );

  useEffect(() => {
    scene.background = PLASTER;
    scene.fog = fog;
    return () => {
      scene.fog = null;
      scene.background = null;
    };
  }, [scene, fog]);

  useFrame((state) => {
    const f = journey.frame;
    const bloom = bloomAt(f);
    material.uniforms.uOpacity.value = bloom;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    dome.current?.position.copy(camera.position);

    // Fog: none for the hero, close once among the falls (it hides what's far below when looking down), lifting for
    // the pool. Its colour is the sky's horizon, so things melt into the background.
    // Three states: none for the hero; close among the falls (it hides what's far below when looking down); a warm
    // aerial haze over the lake, so the cliffs and mountains fade with distance. It thins for the final pull-back.
    const among = smoothstep(BEATS.open, BEATS.fogIn, f);
    const lake = smoothstep(BEATS.fogOut[0], BEATS.fogOut[1], f);
    const away = smoothstep(820, 900, f);
    fog.near = lerp(lerp(1000, 0.8, among), 6, lake) + away * 20;
    fog.far = lerp(lerp(2000, 5.5, among), 95, lake) + away * 120;
    fog.color.copy(PLASTER).lerp(SKY_HORIZON, bloom);

    // Low, warm, behind the scene at the landing: it rims the reeds, the frog and the spray.
    if (light.current) light.current.intensity = bloom * (0.9 + 1.3 * smoothstep(BEATS.fogOut[0], BEATS.fogOut[1], f));
    if (sun) {
      const m = sun.material as { opacity: number };
      m.opacity = bloom;
      sun.visible = bloom > 0.001;
    }
  });

  return (
    <>
      <mesh ref={dome} name="SkyDome" material={material} renderOrder={-100} frustumCulled={false}>
        <sphereGeometry args={[150, 32, 16]} />
      </mesh>
      <directionalLight ref={light} position={SUN_POSITION.toArray()} color={WARM_LIGHT} intensity={0} />
    </>
  );
}

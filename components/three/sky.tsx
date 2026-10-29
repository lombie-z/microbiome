'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BackSide, Color, type DirectionalLight, Fog, type Mesh, ShaderMaterial, Vector3 } from 'three';
import { BEATS, journey, smoothstep } from '@/lib/journey';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Above the clouds everything sits on the blog's plaster; below them the sky warms into a low sun.
export const PLASTER = new Color('#f5f2ed');
const SKY_TOP = new Color('#c9a9c2');
const SKY_HORIZON = new Color('#ffd49c');
const SUN_GLOW = new Color('#ffcf88');
const CLOUD_LIT = new Color('#ffd6a6');
const CLOUD_SHADE = new Color('#c48fa3');
const WARM_LIGHT = new Color('#ffcba3');
/** Where the sun sits (art/build-sky.py), in three.js space (y up). */
export const SUN_POSITION = new Vector3(47.6, 7.4, -47.4);
const LANDING_LIGHT = new Vector3(-20, 16, -42);

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
uniform float uDebug;
varying vec3 vDirection;
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), u.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), u.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise3(p); p = p * 2.07 + 5.3; a *= 0.5; }
  return v;
}
float clouds(vec3 d) {
  // Flattened toward the horizon (clouds are layers, seen edge-on far away), drifting slowly.
  vec3 p = vec3(d.x, d.y * 2.6, d.z) * 3.2 + vec3(uTime * 0.01, 0.0, 0.0);
  p += vec3(fbm3(p * 0.7 + 9.0), 0.0, fbm3(p * 0.7 + 17.0)) * 0.8;  // billows, not streaks
  return fbm3(p);
}
void main() {
  vec3 d = normalize(vDirection);
  vec3 sky = mix(uHorizon, uTop, smoothstep(-0.02, 0.32, d.y));
  float toward = max(dot(d, uSun), 0.0);
  // A wide warm haze around the sun and a brighter halo close in (the sun disc itself is a mesh, for the rays).
  // A soft wide glow and a small hot core (the disc itself is a mesh, so the light rays have a source).
  sky += uGlow * (pow(toward, 8.0) * 0.3 + pow(toward, 90.0) * 0.5 + pow(toward, 900.0) * 3.0);
  // Soft drifting clouds on a dome overhead: lit gold toward the sun, rosy away from it, thinning to the horizon.
  // Clouds across the whole sky: rose-gold bodies, gold where they face the sun (density sampled a step toward it is
  // lower there), lavender-grey in their shadowed undersides, glowing near the sun; thinning into the horizon haze.
  float body = clouds(d);
  float c = smoothstep(0.46, 0.62, body);
  float lit = clamp((body - clouds(normalize(d + uSun * 0.035))) * 6.0 + 0.5, 0.0, 1.0);
  vec3 cloud = mix(uCloudShade, uCloudLit, lit);
  cloud = mix(cloud, uCloudShade * 0.85, smoothstep(0.62, 0.8, body) * (1.0 - lit) * 0.6);
  cloud += uGlow * (pow(toward, 3.0) * 0.7 + pow(toward, 14.0) * 0.9) * (0.4 + lit);
  sky = mix(sky, cloud, c * smoothstep(-0.01, 0.08, d.y));
  if (uDebug > 0.5) sky = vec3(c, body, lit);
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
          // Dev: ?skydebug shows the cloud mask (red), raw noise (green) and height (blue).
          uDebug: { value: process.env.NODE_ENV === 'development' && window.location.search.includes('skydebug') ? 1 : 0 },
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
    fog.near = lerp(lerp(1000, 0.8, among), 18, lake) + away * 20;
    fog.far = lerp(lerp(2000, 5.5, among), 170, lake) + away * 120;
    fog.color.copy(PLASTER).lerp(SKY_HORIZON, bloom);

    // Low, warm, behind the scene at the landing: it rims the reeds, the frog and the spray.
    if (light.current) {
      const landing = smoothstep(BEATS.fogOut[0], BEATS.fogOut[1], f);
      light.current.intensity = bloom * (0.9 + 1.1 * landing);
      // At the landing the light is cheated round to rake across the cliff faces from the left (as in the reference),
      // while the sun itself stays where it's seen, low over the saddle.
      light.current.position.lerpVectors(SUN_POSITION, LANDING_LIGHT, landing);
    }
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

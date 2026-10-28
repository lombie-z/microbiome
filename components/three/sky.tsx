'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BackSide, Color, type DirectionalLight, Fog, type Mesh, ShaderMaterial, Vector3 } from 'three';
import { BEATS, journey, smoothstep } from '@/lib/journey';

// Above the clouds everything sits on the blog's plaster; below them the sky warms into a low sun.
export const PLASTER = new Color('#f5f2ed');
const SKY_TOP = new Color('#f2b98c');
const SKY_HORIZON = new Color('#fde9cf');
const SUN_GLOW = new Color('#ffd7a1');
const WARM_LIGHT = new Color('#ffc890');
/** Where the sun sits (art/build-sky.py), in three.js space (y up). */
export const SUN_POSITION = new Vector3(48, -7.5, -45);

/** 0 above the clouds, 1 once the sun is fully out. */
export const bloomAt = (frame: number) => smoothstep(BEATS.sunIn, BEATS.sunFull, frame);

const vertexShader = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // always at the far plane
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSun;
uniform float uOpacity;
varying vec3 vDirection;
void main() {
  vec3 d = normalize(vDirection);
  vec3 sky = mix(uHorizon, uTop, smoothstep(-0.25, 0.65, d.y));
  float toward = max(dot(d, uSun), 0.0);
  // A wide warm haze around the sun and a brighter halo close in (the sun disc itself is a mesh, for the rays).
  sky += uGlow * (pow(toward, 6.0) * 0.35 + pow(toward, 60.0) * 0.6);
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

  useFrame(() => {
    const f = journey.frame;
    const bloom = bloomAt(f);
    material.uniforms.uOpacity.value = bloom;
    dome.current?.position.copy(camera.position);

    // Fog: none for the hero, close once among the falls (it hides what's far below when looking down), lifting for
    // the pool. Its colour is the sky's horizon, so things melt into the background.
    const among = smoothstep(BEATS.open, BEATS.fogIn, f) * (1 - smoothstep(BEATS.fogOut[0], BEATS.fogOut[1], f));
    fog.near = 0.8 + (1 - among) * 400;
    fog.far = 5.5 + (1 - among) * 800 + smoothstep(BEATS.fogOut[0], BEATS.fogOut[1], f) * 30;
    fog.color.copy(PLASTER).lerp(SKY_HORIZON, bloom);

    if (light.current) light.current.intensity = bloom * 0.9;
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

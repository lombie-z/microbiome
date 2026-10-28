'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { Color, InstancedBufferAttribute, InstancedBufferGeometry, PlaneGeometry, ShaderMaterial } from 'three';
import { isLightDevice } from '@/lib/journey';

// The big fall's body: thousands of white streaks pouring down the curtain (art/build-spill.py main_fall) and
// accelerating as they go, which is what makes falling water read as water. Each is a thin quad, upright and turned to
// face the camera, stretched with its speed. The fall's mesh is the faint sheet behind them.
const TOP = -5.9; // in the braid's lower end, where the streams have fused
const BOTTOM = -11.05; // the pool
const RX = 1.45; // the curtain's half-depth (three x)
const RZ = 3.75; // its half-width across the landing's view (three z)

const vertexShader = /* glsl */ `
uniform float uTime;
attribute vec3 aStart;
attribute float aSpeed;
attribute float aPhase;
attribute float aWidth;
varying float vAlpha;
varying vec2 vQuad;
void main() {
  float drop = ${(TOP - BOTTOM).toFixed(2)};
  // Time to fall the whole height from this streak's starting speed under gravity; loop over it.
  float g = 9.8;
  float life = (-aSpeed + sqrt(aSpeed * aSpeed + 2.0 * g * drop)) / g;
  float t = fract(uTime / life + aPhase) * life;
  float fallen = aSpeed * t + 0.5 * g * t * t;
  float v = aSpeed + g * t;
  // Pour out of the braid's narrow end and fan out into the full curtain over the first metre and a half.
  vec3 centre = vec3(aStart.x, aStart.y - fallen, aStart.z);
  centre.xz *= mix(0.12, 1.0, smoothstep(0.0, 1.6, fallen));
  // Stretch with speed (motion blur), widen a touch as it falls and breaks up.
  float len = 0.12 + v * 0.06;
  float width = aWidth * (1.0 + fallen * 0.08);
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 p = centre + right * position.x * width + vec3(0.0, 1.0, 0.0) * position.y * len;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vQuad = position.xy * 2.0;
  // Fade in below the braid and out into the splash.
  vAlpha = smoothstep(0.0, 0.9, fallen) * (1.0 - smoothstep(drop - 0.5, drop, fallen));
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying vec2 vQuad;
void main() {
  float a = (1.0 - vQuad.x * vQuad.x) * (1.0 - smoothstep(0.3, 1.0, abs(vQuad.y)));
  gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
  #include <colorspace_fragment>
}`;

export function FallStreaks() {
  const { geometry, material } = useMemo(() => {
    const count = isLightDevice() ? 1200 : 3200;
    const geometry = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    const start = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    const phase = new Float32Array(count);
    const width = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // On the curtain's skin (an ellipse), a little inside or out of it, so it has some thickness.
      const a = Math.random() * Math.PI * 2;
      const skin = 0.88 + Math.random() * 0.2;
      start[i * 3] = Math.cos(a) * RX * skin;
      start[i * 3 + 1] = TOP;
      start[i * 3 + 2] = Math.sin(a) * RZ * skin;
      speed[i] = 2.5 + Math.random() * 2.5;
      phase[i] = Math.random();
      width[i] = 0.025 + Math.random() * 0.06;
    }
    geometry.setAttribute('aStart', new InstancedBufferAttribute(start, 3));
    geometry.setAttribute('aSpeed', new InstancedBufferAttribute(speed, 1));
    geometry.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
    geometry.setAttribute('aWidth', new InstancedBufferAttribute(width, 1));
    geometry.instanceCount = count;
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        // A touch past white, so the bloom gives the curtain its glow.
        uColor: { value: new Color(1.25, 1.2, 1.12) },
        uOpacity: { value: 0.42 },
      },
      transparent: true,
      depthWrite: false,
    });
    return { geometry, material };
  }, []);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return <mesh name="SprayFall" geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />;
}

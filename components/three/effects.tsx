'use client';

import { useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer, GodRays, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction, type GodRaysEffect, type NoiseEffect, type VignetteEffect } from 'postprocessing';
import { useRef } from 'react';
import { type Mesh, ShaderChunk } from 'three';
import { journey, landingAt, smoothstep } from '@/lib/journey';
import { Grade, type GradeEffect } from './grade';
import { NearBlur, type NearBlurEffect } from './near-blur';
import { bloomAt } from './sky';

// Every built-in material ends with this chunk: keep its output finite and in range. The effects render to a
// half-float buffer, and one Inf or NaN pixel (a sun glint on glossy clay can overflow it) gets smeared by the bloom
// into a black speck, or across the whole screen.
if (!ShaderChunk.dithering_fragment.includes('isnan')) {
  ShaderChunk.dithering_fragment += `
if (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) gl_FragColor = vec4(0.0);
gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(16.0));`;
}

/**
 * The finish: bloom on anything brighter than white (the sun, glints and white water), light rays from the sun, and
 * a little vignette and grain once the journey is under way. The hero has none of it, so it matches the blog.
 */
export function Effects({ sun, multisampling }: { sun: Mesh | null; multisampling: number }) {
  const vignette = useRef<VignetteEffect>(null);
  const grain = useRef<NoiseEffect>(null);
  const grade = useRef<GradeEffect>(null);
  const nearBlur = useRef<NearBlurEffect>(null);
  const rays = useRef<GodRaysEffect>(null);

  useFrame(() => {
    const underway = smoothstep(10, 120, journey.frame);
    const bloom = bloomAt(journey.frame);
    if (vignette.current) vignette.current.darkness = 0.18 * underway + 0.12 * bloom;
    if (grain.current) grain.current.blendMode.opacity.value = 0.05 * underway;
    if (grade.current) grade.current.weight = landingAt(journey.frame);
    // Gentler rays at the landing: full strength they wash the sky's clouds out round the sun.
    if (rays.current) rays.current.godRaysMaterial.weight = 0.6 * (1 - 0.55 * landingAt(journey.frame));
    // The shallow focus is the landing's still shot; it clears as the camera rises away (from frame 800).
    if (nearBlur.current) nearBlur.current.weight = landingAt(journey.frame) * (1 - smoothstep(800, 840, journey.frame));
  });

  return (
    <EffectComposer multisampling={multisampling} autoClear={false}>
      <NearBlur ref={nearBlur} />
      <Bloom mipmapBlur luminanceThreshold={1.1} luminanceSmoothing={0.25} intensity={0.55} radius={0.7} />
      {sun && !(process.env.NODE_ENV === 'development' && window.location.search.includes('norays')) && (
        <GodRays ref={rays} sun={sun} samples={60} density={0.97} decay={0.95} weight={0.6} exposure={0.62} clampMax={1} blur />
      )}
      <Grade ref={grade} />
      <Vignette ref={vignette} offset={0.35} darkness={0} />
      <Noise ref={grain} premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0} />
    </EffectComposer>
  );
}

'use client';

import { useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer, GodRays, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction, type NoiseEffect, type VignetteEffect } from 'postprocessing';
import { useRef } from 'react';
import type { Mesh } from 'three';
import { journey, smoothstep } from '@/lib/journey';
import { bloomAt } from './sky';

/**
 * The finish: bloom on anything brighter than white (the sun, glints and white water), light rays from the sun, and
 * a little vignette and grain once the journey is under way. The hero has none of it, so it matches the blog.
 */
export function Effects({ sun }: { sun: Mesh | null }) {
  const vignette = useRef<VignetteEffect>(null);
  const grain = useRef<NoiseEffect>(null);

  useFrame(() => {
    const underway = smoothstep(10, 120, journey.frame);
    const bloom = bloomAt(journey.frame);
    if (vignette.current) vignette.current.darkness = 0.18 * underway + 0.12 * bloom;
    if (grain.current) grain.current.blendMode.opacity.value = 0.05 * underway;
  });

  return (
    <EffectComposer multisampling={4} autoClear={false}>
      <Bloom mipmapBlur luminanceThreshold={1.1} luminanceSmoothing={0.25} intensity={0.55} radius={0.7} />
      <>{sun && !(process.env.NODE_ENV === 'development' && window.location.search.includes('norays')) && <GodRays sun={sun} samples={48} density={0.96} decay={0.92} weight={0.45} exposure={0.5} clampMax={1} blur />}</>
      <Vignette ref={vignette} offset={0.35} darkness={0} />
      <Noise ref={grain} premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0} />
    </EffectComposer>
  );
}

'use client';

import { useFrame } from '@react-three/fiber';
import { Bloom, DepthOfField, EffectComposer, GodRays, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction, type BloomEffect, type DepthOfFieldEffect, type GodRaysEffect, type NoiseEffect, type VignetteEffect } from 'postprocessing';
import { useRef } from 'react';
import { type Mesh, ShaderChunk, type Sphere, Vector3 } from 'three';
import { journey, landingAt, smoothstep } from '@/lib/journey';
import { Grade, type GradeEffect } from './grade';
import { NearBlur, type NearBlurEffect } from './near-blur';
import { bloomAt, SUN_POSITION } from './sky';

const sunOnScreen = new Vector3();

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
  const focus = useRef<DepthOfFieldEffect>(null);
  const bloomFx = useRef<BloomEffect>(null);

  useFrame((state) => {
    const underway = smoothstep(10, 120, journey.frame);
    const bloom = bloomAt(journey.frame);
    if (vignette.current) vignette.current.darkness = 0.18 * underway + 0.12 * bloom;
    if (grain.current) grain.current.blendMode.opacity.value = 0.05 * underway;
    // The extra glow is for the still landing shot only: on the approach, right up against the white fall, it would
    // blow out to white.
    const arrived = smoothstep(720, 765, journey.frame);
    if (grade.current) {
      grade.current.weight = landingAt(journey.frame);
      grade.current.glow = 0.55 * arrived;
      // Where the sun is on screen, for its starburst (only at the landing, and not when it's behind the camera).
      // (From the sun disc itself, the centre of its geometry: Blender's mesh isn't centred on its origin.)
      if (sun) {
        if (!sun.geometry.boundingSphere) sun.geometry.computeBoundingSphere();
        sunOnScreen.copy((sun.geometry.boundingSphere as Sphere).center).applyMatrix4(sun.matrixWorld);
      } else sunOnScreen.copy(SUN_POSITION).add(state.camera.position);
      // (The camera has moved this frame but its matrices only update when it renders.)
      state.camera.updateMatrixWorld();
      sunOnScreen.project(state.camera);
      const facing = sunOnScreen.z < 1 ? 1 : 0;
      grade.current.setSun(sunOnScreen.x * 0.5 + 0.5, sunOnScreen.y * 0.5 + 0.5, facing * arrived, state.size.width / state.size.height);
    }
    // Gentler rays at the landing: full strength they wash the sky's clouds out round the sun.
    // The landing's lens: sharp from the frog out past the lilies (the focus is centred mid-way, its range wide, since
    // the blur is symmetric about it), the far valley, mountains and cliffs going soft (the reference's depth of field). Off everywhere else.
    if (focus.current) focus.current.bokehScale = 1.8 * landingAt(journey.frame);
    // A livelier bloom at the landing: more of the bright scene glows (glints, lit rims, the fall, the mist).
    if (bloomFx.current) {
      bloomFx.current.luminanceMaterial.threshold = 1.1 - 0.2 * arrived;
      bloomFx.current.intensity = 0.55 + 0.25 * arrived;
    }
    if (rays.current) rays.current.godRaysMaterial.weight = 0.6 * (1 - 0.85 * landingAt(journey.frame));
    // The shallow focus is the landing's still shot.
    if (nearBlur.current) nearBlur.current.weight = landingAt(journey.frame);
  });

  return (
    <EffectComposer multisampling={multisampling} autoClear={false}>
      <DepthOfField ref={focus} focusDistance={7} focusRange={24} bokehScale={0} />
      <NearBlur ref={nearBlur} />
      <Bloom ref={bloomFx} mipmapBlur luminanceThreshold={1.1} luminanceSmoothing={0.25} intensity={0.55} radius={0.7} />
      {sun && !(process.env.NODE_ENV === 'development' && window.location.search.includes('norays')) && (
        <GodRays ref={rays} sun={sun} samples={60} density={0.97} decay={0.95} weight={0.6} exposure={0.62} clampMax={1} blur />
      )}
      <Grade ref={grade} />
      <Vignette ref={vignette} offset={0.35} darkness={0} />
      <Noise ref={grain} premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0} />
    </EffectComposer>
  );
}

'use client';

import { PerformanceMonitor, SoftShadows, useProgress } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { type RefObject, Suspense, useEffect, useRef, useState } from 'react';
import type { Mesh } from 'three';
import { devFlag as flag, isLightDevice, journey } from '@/lib/journey';
import { Biome } from './biome';
import { Effects } from './effects';
import { JourneyCamera } from './journey-camera';
import { Lake } from './lake';
import { Sky } from './sky';

/** Download progress (0-100) of the model and decoder, for the loading overlay. */
function Progress({ onProgress }: { onProgress: (progress: number) => void }) {
  const progress = useProgress((s) => s.progress);
  useEffect(() => onProgress(progress), [progress, onProgress]);
  return null;
}

// Without the effect composer something still has to render (the outline pass's positive-priority frame callback
// turns off R3F's own rendering).
function Render() {
  useFrame(({ gl, scene, camera }) => gl.render(scene, camera), 1);
  return null;
}

/**
 * Shadows are the most expensive thing drawn (the sun's map covers the whole canyon), so they're redrawn only when
 * something they depend on has moved: while the camera's travelling (the lights follow the journey), and otherwise
 * every few frames for the swaying reeds and drifting toy.
 */
function ShadowBudget() {
  const last = { frame: -1, tick: 0 };
  useFrame(({ gl }) => {
    gl.shadowMap.autoUpdate = false;
    const moving = Math.abs(journey.frame - last.frame) > 0.05;
    last.frame = journey.frame;
    last.tick = (last.tick + 1) % 4;
    if (moving || last.tick === 0) gl.shadowMap.needsUpdate = true;
  }, -2);
  return null;
}

/**
 * A resolution change reallocates every render buffer (a visible hitch), so it waits until the scroll has been still
 * for half a second.
 */
function ApplyWhenStill({ wanted, dpr, setDpr }: { wanted: RefObject<number>; dpr: number; setDpr: (dpr: number) => void }) {
  const still = useRef({ frame: -1, since: 0 });
  useFrame(({ clock }) => {
    const s = still.current;
    if (Math.abs(journey.frame - s.frame) > 0.01) {
      s.frame = journey.frame;
      s.since = clock.elapsedTime;
    }
    if (wanted.current !== dpr && clock.elapsedTime - s.since > 0.5) setDpr(wanted.current);
  });
  return null;
}

/** Dev: the renderer on window.__renderer, for measuring draw calls and frame cost. */
function Expose() {
  useFrame(({ gl }) => {
    (window as unknown as { __renderer?: unknown; __journeyFrame?: number }).__renderer = gl;
    (window as unknown as { __journeyFrame?: number }).__journeyFrame = journey.frame;
  });
  return null;
}

/**
 * Trying a pixel-art look: ?pixel=N renders the scene at 1/N of the screen's resolution and scales it up with hard
 * pixel edges. Far cheaper to draw (every pass scales with pixel count); off unless asked for.
 */
const pixelSize = () => {
  if (typeof window === 'undefined') return 0;
  const n = Number(new URLSearchParams(window.location.search).get('pixel'));
  return n > 1 ? n : 0;
};

export default function JourneyCanvas({ onReady, onProgress }: { onReady: () => void; onProgress: (progress: number) => void }) {
  const [sun, setSun] = useState<Mesh | null>(null);
  const [light] = useState(isLightDevice);
  // Resolution adapts to the machine: down toward 1 while frames are slow, back up (to the cap) when there's room.
  const [pixel] = useState(pixelSize);
  const maxDpr = pixel ? 1 / pixel : light ? 1.5 : 1.75;
  const [dpr, setDpr] = useState(maxDpr);
  const wanted = useRef(maxDpr);
  return (
    <Canvas
      shadows={!flag('noshadow')}
      flat
      dpr={dpr}
      gl={{ antialias: false }}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1, imageRendering: pixel ? 'pixelated' : undefined }}
    >
      <PerformanceMonitor
        bounds={(refresh) => (refresh > 90 ? [50, 90] : [40, 58])}
        onChange={({ factor }) => {
          if (pixel) return;
          wanted.current = Math.round((1 + (maxDpr - 1) * factor) * 4) / 4;
        }}
      />
      <ApplyWhenStill wanted={wanted} dpr={dpr} setDpr={setDpr} />
      <ShadowBudget />
      {!flag('nosoft') && <SoftShadows size={42} samples={light ? 6 : 10} focus={0.35} />}
      <Progress onProgress={onProgress} />
      {process.env.NODE_ENV === 'development' && <Expose />}
      <JourneyCamera />
      <Sky sun={sun} />
      {!flag('nolake') && <Lake />}
      <Suspense fallback={null}>
        <Biome onReady={onReady} onSun={setSun} />
      </Suspense>
      {flag('nofx') ? <Render /> : <Effects sun={light ? null : sun} />}
    </Canvas>
  );
}

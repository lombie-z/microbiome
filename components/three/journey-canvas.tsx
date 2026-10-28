'use client';

import { SoftShadows, useProgress } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useState } from 'react';
import type { Mesh } from 'three';
import { isLightDevice } from '@/lib/journey';
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

// Dev switches for isolating rendering problems: ?nofx (no post effects), ?nospray.
const flag = (name: string) => process.env.NODE_ENV === 'development' && new URLSearchParams(window.location.search).has(name);

// Without the effect composer something still has to render (the outline pass's positive-priority frame callback
// turns off R3F's own rendering).
function Render() {
  useFrame(({ gl, scene, camera }) => gl.render(scene, camera), 1);
  return null;
}

export default function JourneyCanvas({ onReady, onProgress }: { onReady: () => void; onProgress: (progress: number) => void }) {
  const [sun, setSun] = useState<Mesh | null>(null);
  const [light] = useState(isLightDevice);
  return (
    <Canvas shadows flat dpr={[1, light ? 1.5 : 1.75]} gl={{ antialias: false }} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
      <SoftShadows size={42} samples={light ? 10 : 24} focus={0.35} />
      <Progress onProgress={onProgress} />
      <JourneyCamera />
      <Sky sun={sun} />
      <Lake />
      <Suspense fallback={null}>
        <Biome onReady={onReady} onSun={setSun} />
      </Suspense>
      {flag('nofx') ? <Render /> : <Effects sun={light ? null : sun} multisampling={light ? 0 : 4} />}
    </Canvas>
  );
}

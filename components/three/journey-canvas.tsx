'use client';

import { SoftShadows } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useState } from 'react';
import type { Mesh } from 'three';
import { Biome } from './biome';
import { Effects } from './effects';
import { JourneyCamera } from './journey-camera';
import { Sky } from './sky';

export default function JourneyCanvas({ onReady }: { onReady: () => void }) {
  const [sun, setSun] = useState<Mesh | null>(null);
  return (
    <Canvas shadows flat dpr={[1, 1.75]} gl={{ antialias: false }} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
      <SoftShadows size={42} samples={24} focus={0.35} />
      <JourneyCamera />
      <Sky sun={sun} />
      <Suspense fallback={null}>
        <Biome onReady={onReady} onSun={setSun} />
      </Suspense>
      <Effects sun={sun} />
    </Canvas>
  );
}

'use client';

import { SoftShadows } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense } from 'react';
import { Biome } from './biome';

// Any useFrame with a positive priority takes over rendering, and the outline pass needs one; so render last, here.
function Render() {
  useFrame(({ gl, scene, camera }) => gl.render(scene, camera), 1);
  return null;
}

export default function JourneyCanvas({ onReady }: { onReady: () => void }) {
  return (
    <Canvas shadows flat dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
      <SoftShadows size={42} samples={24} focus={0.35} />
      <Suspense fallback={null}>
        <Biome onReady={onReady} />
      </Suspense>
      <Render />
    </Canvas>
  );
}

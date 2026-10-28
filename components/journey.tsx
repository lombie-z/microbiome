'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';

// three.js and the model load in the browser after the page is up; the Blender still holds the hero until then.
const JourneyCanvas = dynamic(() => import('@/components/three/journey-canvas'), { ssr: false });

export function Journey() {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-0 grid place-items-center" aria-hidden="true">
        {/* Same box as the hero stage (lib/journey.ts heroStageSize). */}
        {/* biome-ignore lint/performance/noImgElement: a fixed-size transparent still; next/image adds nothing here. */}
        <img
          src="/images/3d/micro-biome.webp"
          alt=""
          className={cn('aspect-square w-[min(calc(min(640px,100vw)-48px),72svh)] object-contain transition-opacity duration-500', ready && 'opacity-0')}
        />
      </div>
      <JourneyCanvas onReady={onReady} />
    </>
  );
}

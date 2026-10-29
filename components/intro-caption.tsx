'use client';

import { useEffect, useRef } from 'react';
import { journey, smoothstep } from '@/lib/journey';

/** The hero's caption: pinned to the bottom of the screen, it fades as soon as the camera starts to move. */
export function IntroCaption() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (root.current) root.current.style.opacity = (1 - smoothstep(4, 40, journey.frame)).toFixed(3);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <section ref={root} className="pointer-events-none fixed inset-x-0 bottom-8 z-10 text-center" aria-label="Intro">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">Claude-powered Modelling for Interactive Web Experiences</p>
      <p className="mt-2 text-xs">Scroll to go in</p>
    </section>
  );
}

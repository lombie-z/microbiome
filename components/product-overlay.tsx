'use client';

import { useEffect, useRef } from 'react';
import { journey, smoothstep } from '@/lib/journey';

// The journey's end: the camera holds on the landing and the product comes in over it. A dark wash on the left (fading
// out to the right, so the scene still reads) carries the copy and actions. The product itself is still to be decided:
// the copy below is placeholder.
const IN = [790, 850] as const;

export function ProductOverlay() {
  const root = useRef<HTMLDivElement>(null);

  // Follows the camera's frame (lib/journey.ts), not the raw scroll, so it lands with the shot.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = root.current;
      if (el) {
        const t = smoothstep(IN[0], IN[1], journey.frame);
        el.style.setProperty('--in', t.toFixed(3));
        el.style.pointerEvents = t > 0.9 ? 'auto' : 'none';
        el.inert = t < 0.9;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={root} className="fixed inset-0 z-10 [--in:0]" style={{ opacity: 'var(--in)' }} inert>
      {/* Warm, and clear of the sun at the top, so it deepens the scene rather than greying it. On phones it rises from
          the bottom instead, where the copy sits. */}
      <div className="absolute inset-0 bg-[linear-gradient(0deg,oklch(0.24_0.05_40/0.78)_0%,oklch(0.24_0.05_40/0.5)_32%,transparent_58%)] sm:bg-[linear-gradient(90deg,oklch(0.24_0.05_40/0.72)_0%,oklch(0.24_0.05_40/0.42)_34%,transparent_62%)] sm:[mask-image:linear-gradient(to_bottom,transparent,rgb(0_0_0/0.3)_26%,black_40%,black_85%,rgb(0_0_0/0.75))]" />
      <section
        className="relative flex h-full max-w-xl flex-col justify-end gap-5 px-6 pb-24 text-plaster sm:justify-center sm:gap-6 sm:px-12 sm:pb-0 lg:px-20"
        style={{ transform: 'translateY(calc((1 - var(--in)) * 16px))' }}
        aria-label="Product"
      >
        <p className="text-xs uppercase tracking-[0.2em] text-plaster/70">Placeholder · product TBC</p>
        <h2 className="font-serif text-5xl leading-[1.05] sm:text-6xl">Product name</h2>
        <p className="max-w-sm text-base text-plaster/80">One or two lines on what it is and why it matters. To be written once the product is decided.</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {/* Buttons until the product (and where these lead) is decided. */}
          <button type="button" className="rounded-full bg-plaster px-6 py-3 text-sm font-medium text-ink transition-colors hover:bg-white">
            Primary action
          </button>
          <button
            type="button"
            className="rounded-full border border-plaster/50 px-6 py-3 text-sm font-medium text-plaster transition-colors hover:border-plaster hover:bg-plaster/10"
          >
            Secondary action
          </button>
        </div>
      </section>
    </div>
  );
}

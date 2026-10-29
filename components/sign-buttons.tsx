'use client';

import { Overpass } from 'next/font/google';
import { useEffect, useRef } from 'react';
import { BUTTONS_BOX, signQuad } from '@/components/three/sign';
import { devFlag, journey, smoothstep } from '@/lib/journey';

const overpass = Overpass({ subsets: ['latin'], weight: ['600'] });

// The landing's two actions, frosted glass, stacked just inside the FogDrog sign's left post in the sign's own plane:
// the canvas reports where that box lands on screen each frame (signQuad, components/three/sign.tsx), and the buttons
// are mapped onto it with a perspective transform, so they take the sign's angle exactly. They come in once the camera
// has settled on the landing.
const IN = [790, 850] as const;
const GLASS =
  'block w-full rounded-full py-3 text-center text-[30px] leading-none text-white backdrop-blur-md transition duration-200 ease-out [text-shadow:0_1px_6px_rgba(60,30,20,0.45)] hover:-translate-y-1 hover:bg-[rgb(46_24_18/0.32)] hover:shadow-[0_6px_14px_rgb(46_24_18/0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white active:translate-y-0';

type M3 = number[];
const adj = (m: M3): M3 => [
  m[4] * m[8] - m[5] * m[7],
  m[2] * m[7] - m[1] * m[8],
  m[1] * m[5] - m[2] * m[4],
  m[5] * m[6] - m[3] * m[8],
  m[0] * m[8] - m[2] * m[6],
  m[2] * m[3] - m[0] * m[5],
  m[3] * m[7] - m[4] * m[6],
  m[1] * m[6] - m[0] * m[7],
  m[0] * m[4] - m[1] * m[3],
];
const mul = (a: M3, b: M3): M3 => {
  const c: M3 = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return c;
};
/** The projective map taking the unit corners to four points (p0..p3, in order round the quad). */
const basis = (p: number[][]): M3 => {
  const m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1];
  const a = adj(m);
  const v = [a[0] * p[3][0] + a[1] * p[3][1] + a[2], a[3] * p[3][0] + a[4] * p[3][1] + a[5], a[6] * p[3][0] + a[7] * p[3][1] + a[8]];
  return mul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
};
/** CSS matrix3d mapping a w x h box (origin top-left) onto the quad. */
function quadTransform(w: number, h: number, quad: number[][]) {
  const t = mul(
    basis(quad),
    adj(
      basis([
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ])
    )
  );
  const k = t.map((x) => x / t[8]);
  return `matrix3d(${[k[0], k[3], 0, k[6], k[1], k[4], 0, k[7], 0, 0, 1, 0, k[2], k[5], 0, k[8]].join(',')})`;
}

export function SignButtons() {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    let raf = 0;
    const tick = () => {
      if (el) {
        const t = signQuad.shown ? smoothstep(IN[0], IN[1], journey.frame) : 0;
        el.style.opacity = t.toFixed(3);
        el.style.pointerEvents = t > 0.9 ? 'auto' : 'none';
        if (t > 0) el.style.transform = quadTransform(BUTTONS_BOX.width, BUTTONS_BOX.height, signQuad.points);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (devFlag('nobuttons')) return null;
  // (Above the scroll track, which would otherwise take the clicks; under the loading cover.)
  return (
    <div className="pointer-events-none fixed inset-0 z-[15] overflow-hidden">
      <div
        ref={box}
        className={`${overpass.className} absolute top-0 left-0 flex origin-top-left flex-col justify-start gap-4 font-semibold opacity-0`}
        style={{ width: BUTTONS_BOX.width, height: BUTTONS_BOX.height }}
      >
        <a href="#waitlist" className={`${GLASS} bg-white/30 ring-1 ring-white/60`}>
          Waitlist
        </a>
        <a href="#trailer" className={`${GLASS} bg-white/12 ring-1 ring-white/40`}>
          Trailer
        </a>
      </div>
    </div>
  );
}

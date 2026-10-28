/** Scroll progress through the journey: 0 at the hero, 1 at the end. Cheap enough to read every frame. */
export function journeyProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}

/**
 * The hero stage: a centred square the biome fills, the same size as the blog's biome section
 * (640 px max, 24 px gutters), so following the link lands on the same picture.
 */
export function heroStageSize(width: number, height: number) {
  return Math.min(Math.min(640, width) - 48, height * 0.72);
}

/** The journey's length in track frames (art/build-journey.py F_END); beats below are in the same frames. */
export const TRACK_FRAMES = 720;
export const BEATS = {
  /** End of the opening dolly zoom, where the fitted hero hands over to the authored path. */
  open: 80,
  /** Below the clouds the sun comes out and the sky warms. */
  sunIn: 275,
  sunFull: 380,
  /** Fog closes in once the camera is among the falls, and lifts for the pool. */
  fogIn: 110,
  fogOut: [560, 640],
  /** The rainbow over the pool. */
  bowIn: 540,
  bowFull: 630,
} as const;

/** Shared per-frame journey state: written once a frame by JourneyCamera, read by everything else. */
export const journey = {
  /** Current track frame (0 to TRACK_FRAMES), smoothed by Lenis. */
  frame: 0,
};

export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Phones and tablets get a lighter render: fewer particles, no light rays, lower resolution. */
export const isLightDevice = () => typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768);

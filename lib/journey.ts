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
export const TRACK_FRAMES = 920;
export const BEATS = {
  /** End of the opening dolly zoom, where the fitted hero hands over to the authored path. */
  open: 80,
  /** Below the clouds the sun comes out and the sky warms. */
  sunIn: 275,
  sunFull: 380,
  /** Fog closes in once the camera is among the falls, and thins to a warm haze over the lake. */
  fogIn: 110,
  fogOut: [600, 700],
  /** The rainbow over the pool. */
  bowIn: 640,
  bowFull: 720,
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

/** 0 until the camera nears the lake, 1 at the landing: the landing's own light, haze and grade blend in on this. */
/**
 * Whether the world below (the canyon, lake and their dressing) is drawn: not for the hero, which sits on the blog's
 * plain plaster, until the fog closes in among the falls.
 */
export const belowVisible = (frame: number) => frame > BEATS.fogIn;

export const landingAt = (frame: number) => smoothstep(BEATS.fogOut[0], BEATS.fogOut[1], frame);

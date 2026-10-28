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

import { wrapEffect } from '@react-three/postprocessing';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Uniform } from 'three';

// The hand-over from the crisp hero to pixel mode: a wipe of pixelation running diagonally up the screen as you
// scroll through the pre-roll (lib/journey.ts PRE_ROLL). Ahead of the wipe the full-resolution render shows through;
// behind it each cell takes one colour, the same cells the low-resolution render then draws once the wipe's done
// (components/three/journey-canvas.tsx), so the switch to it can't be seen. The wipe's edge steps cell by cell, ragged.
const fragmentShader = /* glsl */ `
uniform float progress;
uniform float cell;

float cellHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (progress <= 0.0) {
    outputColor = inputColor;
    return;
  }
  vec2 px = uv * resolution;
  vec2 id = floor(px / cell);
  vec2 centre = (id + 0.5) * cell / resolution;
  // Along the diagonal, bottom-left (0) to top-right (1), measured at the cell, jittered so the edge is ragged.
  float along = (centre.x + centre.y) * 0.5;
  float edge = progress * 1.3 - 0.15 + (cellHash(id) - 0.5) * 0.12;
  outputColor = along < edge ? texture2D(inputBuffer, centre) : inputColor;
}`;

export class PixelSweepEffect extends Effect {
  constructor() {
    super('PixelSweepEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['progress', new Uniform(0)],
        ['cell', new Uniform(4)],
      ]),
    });
  }

  /** Wipe progress (0 to 1) and cell size in buffer pixels. */
  set(progress: number, cell: number) {
    (this.uniforms.get('progress') as Uniform<number>).value = progress;
    (this.uniforms.get('cell') as Uniform<number>).value = cell;
  }
}

export const PixelSweep = wrapEffect(PixelSweepEffect);

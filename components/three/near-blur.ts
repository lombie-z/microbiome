import { wrapEffect } from '@react-three/postprocessing';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Uniform } from 'three';

// The reference's shallow focus, close up only: what's nearer than the frog (the pebbles, the near pads) melts into
// soft discs, glints into bokeh, while the frog and everything beyond stay sharp. (A full depth of field also blurred
// the distant fall and cliffs, which the reference keeps crisp.) `weight` fades it in at the landing.
const fragmentShader = /* glsl */ `
uniform float weight;
uniform float sharpFrom;
uniform float blurAt;
uniform float maxRadius;

float nearness(float depth) {
  // (smoothstep needs its edges in order.)
  return 1.0 - smoothstep(blurAt, sharpFrom, -getViewZ(depth));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float amount = nearness(depth) * weight;
  if (amount < 0.01) {
    outputColor = inputColor;
    return;
  }
  // A golden-angle disc of taps; taps on sharper (farther) surfaces count less, so a near blur doesn't drag the sharp
  // background in over its edges.
  vec2 radius = maxRadius * amount * texelSize;
  vec4 sum = vec4(inputColor.rgb, 1.0);
  for (int i = 1; i < 32; i++) {
    float r = sqrt(float(i) / 32.0);
    float a = float(i) * 2.39996;
    vec2 at = uv + vec2(cos(a), sin(a)) * r * radius;
    float w = 0.25 + 0.75 * nearness(readDepth(at));
    sum += vec4(texture2D(inputBuffer, at).rgb * w, w);
  }
  outputColor = vec4(sum.rgb / sum.a, inputColor.a);
}`;

export class NearBlurEffect extends Effect {
  constructor() {
    super('NearBlurEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['weight', new Uniform(0)],
        // View distances (m): sharp from the frog (about 3.1 away) out, fully soft by the pebbles (2.3).
        ['sharpFrom', new Uniform(3.0)],
        ['blurAt', new Uniform(2.3)],
        ['maxRadius', new Uniform(16)],
      ]),
    });
  }

  set weight(value: number) {
    (this.uniforms.get('weight') as Uniform<number>).value = value;
  }
}

export const NearBlur = wrapEffect(NearBlurEffect);

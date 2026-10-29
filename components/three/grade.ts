import { wrapEffect } from '@react-three/postprocessing';
import { BlendFunction, Effect } from 'postprocessing';
import { Uniform, Vector3 } from 'three';

// A colour grade for the landing, tuned against the reference image: a filmic shoulder, an S-curve for contrast, rose
// in the shadows and gold in the highlights. `weight` blends it in (0 everywhere else, so the hero still
// matches the blog).
const fragmentShader = /* glsl */ `
uniform float weight;
uniform float exposure;
uniform float contrast;
uniform float saturation;
uniform vec3 shadowTint;
uniform vec3 highlightTint;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, vec3(0.0));
  vec3 g = c * exposure;
  // A filmic shoulder (extended Reinhard, white at 3): highlights roll off instead of clipping, so a bright sky keeps
  // its clouds and the sun its halo.
  g = g * (1.0 + g / 9.0) / (1.0 + g);
  // Contrast as an S-curve in perceptual space, so it deepens shadows without blowing highlights.
  vec3 p = pow(min(g, vec3(1.0)), vec3(1.0 / 2.2));
  p = mix(p, p * p * (3.0 - 2.0 * p), contrast - 1.0);
  g = pow(max(p, vec3(0.0)), vec3(2.2));
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
  // Saturating past 1 can push a channel below zero, and the output's sRGB encode turns that into NaN (white).
  g = max(mix(vec3(l), g, saturation), vec3(0.0));
  g *= mix(shadowTint, highlightTint, smoothstep(0.02, 0.5, l));
  outputColor = vec4(mix(c, g, weight), inputColor.a);
}`;

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['weight', new Uniform(0)],
        ['exposure', new Uniform(0.78)],
        ['contrast', new Uniform(1.85)],
        ['saturation', new Uniform(1.4)],
        ['shadowTint', new Uniform(new Vector3(1.1, 0.86, 0.86))],
        ['highlightTint', new Uniform(new Vector3(1.08, 0.96, 0.8))],
      ]),
    });
  }

  set weight(value: number) {
    (this.uniforms.get('weight') as Uniform<number>).value = value;
  }
}

export const Grade = wrapEffect(GradeEffect);

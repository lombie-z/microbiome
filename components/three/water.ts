import { Color, DoubleSide, FrontSide, type Material, MeshPhysicalMaterial } from 'three';

// Water as modelled in Blender (art/build-spill.py water_materials): a deep blue core paling to the edges by facing
// ratio, glossy, slightly see-through. Falling water carries per-vertex '_flow' (0 still, 1 falling), '_foam' (white
// water) and '_fade' (the streams crossfading into the big fall), and its UV v runs along it in metres (glTF stores
// 1 - v), so streaks can flow down it.

const DEEP = new Color().setRGB(0.02, 0.22, 0.8);
const MID = new Color().setRGB(0.1, 0.45, 1.0);
const PALE = new Color().setRGB(0.72, 0.9, 1.0);

const NOISE = /* glsl */ `
float waterHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float waterNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(waterHash(i), waterHash(i + vec2(1, 0)), u.x), mix(waterHash(i + vec2(0, 1)), waterHash(i + vec2(1, 1)), u.x), u.y);
}
`;

export type WaterKind = 'falling' | 'still' | 'pool';

/** Shared clock for every water material; advance it once a frame. */
export const waterTime = { value: 0 };

export function waterMaterial(kind: WaterKind): Material {
  // The pool lies flat under the low sun: a softer sheen there, or the sun's reflection blooms into a glare.
  // Nothing smoother than ~0.1 roughness: a near-mirror highlight overflows the effects' half-float buffer (Inf), and
  // bloom turns that into black specks.
  const pool = kind === 'pool';
  const material = new MeshPhysicalMaterial({
    roughness: pool ? 0.18 : 0.1,
    clearcoat: pool ? 0.35 : 1,
    clearcoatRoughness: pool ? 0.12 : 0.1,
    specularIntensity: pool ? 0.45 : 1,
    transparent: true,
    depthWrite: kind !== 'falling',
    side: kind === 'falling' ? DoubleSide : FrontSide,
  });
  material.defines = { [kind.toUpperCase()]: '' };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterTime;
    shader.uniforms.uDeep = { value: DEEP };
    shader.uniforms.uMid = { value: MID };
    shader.uniforms.uPale = { value: PALE };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
#ifdef FALLING
attribute float _flow;
attribute float _foam;
attribute float _fade;
#endif
varying float vFlow;
varying float vFoam;
varying float vFade;
varying vec2 vFlowUv;
varying vec3 vWorld;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef FALLING
vFlow = _flow; vFoam = _foam; vFade = _fade;
#else
vFlow = 0.0; vFoam = 0.0; vFade = 1.0;
#endif
vFlowUv = uv;
vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uPale;
varying float vFlow;
varying float vFoam;
varying float vFade;
varying vec2 vFlowUv;
varying vec3 vWorld;
${NOISE}`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  float facing = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
  float edge = 1.0 - facing;
  // Still water keeps the deep blue nearly to the rim; falling water pales sooner.
  float midAt = mix(0.9, 0.55, vFlow);
  vec3 water = edge < midAt ? mix(uDeep, uMid, edge / midAt) : mix(uMid, uPale, (edge - midAt) / (1.0 - midAt));
  float white = 0.0;
#ifdef FALLING
  // Streaks flowing down the fall (metres along it = 1 - v), stretched lengthwise.
  float along = 1.0 - vFlowUv.y;
  float streak = waterNoise(vec2(vFlowUv.x * 14.0, (along - uTime * 1.6) * 1.1));
  streak = smoothstep(0.6, 0.78, streak) * 0.65 * vFlow;
  float churn = smoothstep(0.35, 0.65, waterNoise(vec2(vFlowUv.x * 22.0, (along - uTime * 1.2) * 5.0)));
  white = max(streak, vFoam * churn);
#endif
#ifdef POOL
  // Rings spreading out from where the big fall lands.
  float d = length(vWorld.xz);
  float ring = smoothstep(0.82, 1.0, sin(d * 16.0 - uTime * 3.2)) * exp(-d * 1.1) * step(0.42, d);
  white = ring * 0.55;
#endif
  diffuseColor.rgb = mix(water, vec3(0.95, 0.98, 1.0), white);
  diffuseColor.a = mix(mix(0.95, 0.85, vFlow), 1.0, white) * vFade;
  // White water glows a touch past 1 so the bloom catches it.
  totalEmissiveRadiance += vec3(0.95, 0.98, 1.0) * white * 0.18;
}`
      );
  };
  material.customProgramCacheKey = () => `water-${kind}`;
  return material;
}

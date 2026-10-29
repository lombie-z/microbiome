import { DoubleSide, type Material, MeshPhysicalMaterial, type MeshStandardMaterial } from 'three';
import { waterTime } from './water';

// Materials for the landing's foreground (art/build-landing.py): the colour lives in the meshes' vertex colours; these
// add what makes each read as wet, living things in the low sun of the reference image.

const NOISE = /* glsl */ `
float lHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float lNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(lHash(i), lHash(i + vec3(1, 0, 0)), u.x), mix(lHash(i + vec3(0, 1, 0)), lHash(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(lHash(i + vec3(0, 0, 1)), lHash(i + vec3(1, 0, 1)), u.x), mix(lHash(i + vec3(0, 1, 1)), lHash(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
`;

// The reed bed's foot (Blender's REED_BED, in three's x/z): the taller a blade, the further it sways.
const REED_BED = '-23.1, 3.24';

type Patch = { vertex?: string; colour?: string; light?: string };

function physical(source: MeshStandardMaterial, settings: Partial<MeshPhysicalMaterial>, key: string, patch: Patch) {
  const material = new MeshPhysicalMaterial({ vertexColors: true, color: source.color, ...settings });
  material.name = source.name;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterTime;
    const varyings = 'varying vec3 vLandingPos;\nuniform float uTime;';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${varyings}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${patch.vertex ?? ''}`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLandingPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${varyings}\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${patch.colour ?? ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${patch.light ?? ''}`);
  };
  material.customProgramCacheKey = () => `landing-${key}`;
  return material;
}

// Light coming through from behind (the sun is low and ahead of the camera): thin things glow at their edges.
const BACKLIT = (strength: number) => /* glsl */ `
{
  float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.25, 1.0, 0.6) * pow(rim, 2.0) * ${strength.toFixed(2)};
}`;

export function landingMaterial(source: MeshStandardMaterial): Material | null {
  switch (source.name) {
    case 'Reed':
      return physical(source, { roughness: 0.45, sheen: 0.6, sheenColor: source.color.clone().setRGB(1, 0.85, 0.5), side: DoubleSide }, 'reed', {
        vertex: /* glsl */ `
float bed = 1.0 - smoothstep(1.2, 2.2, length(transformed.xz - vec2(${REED_BED})));
float h = max(transformed.y + 11.0, 0.0);
float sway = bed * h * h * 0.03;
transformed.x += sway * sin(uTime * 1.3 + transformed.x * 2.0 + transformed.z * 3.0);
transformed.z += sway * 0.6 * sin(uTime * 0.9 + transformed.x * 3.0);`,
        light: BACKLIT(1.4),
      });
    case 'Pad':
      // Waxy and wet, the low sun glowing through the thin leaf at its edges.
      return physical(source, { roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18 }, 'pad', {
        colour: 'diffuseColor.rgb *= 0.85 + 0.3 * lNoise(vLandingPos * 18.0);',
        light: BACKLIT(0.9),
      });
    case 'Frog':
      // Wet skin: glossy, with fine bumps darkening and lightening the mottling.
      return physical(source, { roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.2 }, 'frog', {
        colour: 'diffuseColor.rgb *= 0.82 + 0.36 * lNoise(vLandingPos * 140.0);',
        light: BACKLIT(0.5),
      });
    case 'Mountains': {
      // A ring of ridges seen from inside it: both faces, matte, left to the fog to fade into layers.
      const material = source.clone();
      material.side = DoubleSide;
      material.roughness = 1;
      return material;
    }
    case 'Shrubs':
    case 'Blossom':
      return foliageMaterial(source);
    case 'FrogEye':
      return physical(source, { roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.12 }, 'eye', {});
    case 'Lily':
      // Petals are thin: they glow in the low light.
      return physical(source, { roughness: 0.5, side: DoubleSide }, 'lily', { light: BACKLIT(0.8) });
    case 'Pebble':
      // Pale granite: dark and rusty specks, a wet sheen the sun sparkles in.
      return physical(source, { roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12 }, 'pebble', {
        colour: /* glsl */ `
{
  vec3 p = vLandingPos * 240.0;
  float speck = smoothstep(0.72, 0.8, lNoise(p));
  float rust = smoothstep(0.65, 0.8, lNoise(p * 0.45 + 13.0));
  float pale = smoothstep(0.7, 0.85, lNoise(p * 1.7 + 5.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.4, 0.28), rust * 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.22, 0.17), speck * 0.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.92), pale * 0.3);
  diffuseColor.rgb *= 0.9 + 0.2 * lNoise(vLandingPos * 9.0);
}`,
      });
    default:
      return null;
  }
}

/** Leafy clumps: dark, mottled leaves with a ragged, see-through silhouette and the low sun glowing through the edges. */
export function foliageMaterial(source?: MeshStandardMaterial) {
  const material = new MeshPhysicalMaterial({ vertexColors: !!source, roughness: 0.85, color: source?.color ?? 0xffffff });
  material.name = source?.name ?? 'Foliage';
  material.onBeforeCompile = (shader) => {
    const varyings = 'varying vec3 vLeafPos;';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${varyings}\n${NOISE}`)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
// Lumpy, irregular crowns rather than balls: each clump pushed in and out by its own noise.
#ifdef USE_INSTANCING
transformed += objectNormal * (lNoise(position * 2.4 + instanceMatrix[3].xyz * 3.0) - 0.45) * 0.75;
#else
transformed += objectNormal * (lNoise(position * 6.0) - 0.45) * 0.12;
#endif`
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `#include <worldpos_vertex>
vec4 leafPos = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
leafPos = instanceMatrix * leafPos;
#endif
vLeafPos = (modelMatrix * leafPos).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${varyings}\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
float leaves = lNoise(vLeafPos * 22.0) * 0.6 + lNoise(vLeafPos * 55.0) * 0.4;
float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
// Ragged edges: toward the silhouette, the gaps between leaves open up.
if (leaves < rim * 0.9 - 0.12) discard;
diffuseColor.rgb *= 0.45 + 0.9 * leaves;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (vec3(0.25, 0.22, 0.12) + vec3(1.2, 0.95, 0.55) * pow(rim, 2.0) * 1.2);`
      );
  };
  material.customProgramCacheKey = () => `foliage-${!!source}`;
  return material;
}

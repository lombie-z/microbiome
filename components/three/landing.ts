import { Color, DoubleSide, type Material, MeshPhysicalMaterial, type MeshStandardMaterial } from 'three';
import { scan, TRIPLANAR } from './scans';
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

type Patch = {
  vertex?: string;
  colour?: string;
  roughness?: string;
  normal?: string;
  light?: string;
  // Extra uniforms, and declarations for the fragment shader.
  uniforms?: Record<string, { value: unknown }>;
  header?: string;
};

function physical(source: MeshStandardMaterial, settings: Partial<MeshPhysicalMaterial>, key: string, patch: Patch) {
  // The studio environment (a white room, for the clay hero) would gloss everything here grey; the sun sheen and the
  // lake stand in for the landing's reflections.
  const material = new MeshPhysicalMaterial({ vertexColors: true, color: source.color, envMapIntensity: 0.15, ...settings });
  material.name = source.name;
  material.userData.envMapIntensity = material.envMapIntensity;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterTime;
    Object.assign(shader.uniforms, patch.uniforms);
    const varyings = 'varying vec3 vLandingPos;\nuniform float uTime;';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${varyings}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${patch.vertex ?? ''}`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLandingPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${varyings}\n${NOISE}\n${patch.header ?? ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${patch.colour ?? ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${patch.roughness ?? ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${patch.normal ?? ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${patch.light ?? ''}`);
  };
  material.customProgramCacheKey = () => `landing-${key}`;
  return material;
}

/** Bumps the shading normal by a height field (screen-space derivatives, as three's bump map does). */
const BUMP = (height: string, strength: number) => /* glsl */ `
{
  float h = (${height}) * ${strength.toFixed(4)};
  vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
  vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  normal = normalize(abs(det) * normal - grad);
}`;

// The low sun's direction at the landing (components/three/sky.tsx SUN_POSITION, seen from the foreground).
const SUN_DIR = 'normalize(vec3(0.7, 0.12, -0.7))';

/** Wet glitter: tiny mirror flecks catching the low sun, past white so they bloom (and become bokeh in the blur). */
const GLINTS = (scale: number, density: number, strength: number) => /* glsl */ `
{
  vec3 nW = normalize(cross(dFdx(vLandingPos), dFdy(vLandingPos)));
  vec3 viewW = normalize(cameraPosition - vLandingPos);
  if (dot(nW, viewW) < 0.0) nW = -nW;
  float facing = pow(max(dot(reflect(-${SUN_DIR}, nW), viewW), 0.0), 6.0);
  float fleck = smoothstep(${density.toFixed(3)}, 1.0, lNoise(vLandingPos * ${scale.toFixed(1)}));
  totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * fleck * facing * ${strength.toFixed(2)};
}`;

/** The low sun's reflection off a wet or waxy surface: a broad warm sheen, past white where it's strongest. */
const SUN_SHEEN = (power: number, strength: number) => /* glsl */ `
{
  vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 viewW = normalize(cameraPosition - vLandingPos);
  float sheen = pow(max(dot(reflect(-${SUN_DIR}, nW), viewW), 0.0), ${power.toFixed(1)});
  totalEmissiveRadiance += vec3(1.0, 0.76, 0.42) * sheen * ${strength.toFixed(2)};
}`;

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
        // Darker, duller greens than the vertex colours: the reference's reeds are mostly in shadow against the sun.
        colour: 'diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), diffuseColor.rgb, 0.7) * 0.8;',
        light: BACKLIT(1.4),
      });
    case 'Pad':
      // Waxy and wet: deep olive, a golden sheen where the low sun reflects off it, glowing through its thin edges.
      return physical(source, { roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 }, 'pad', {
        colour: /* glsl */ `
diffuseColor.rgb *= 0.8 + 0.3 * lNoise(vLandingPos * 18.0);
diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), diffuseColor.rgb, 1.2);`,
        normal: BUMP('lNoise(vLandingPos * 40.0)', 0.002),
        // (No rim glow: the pads lie flat, seen edge-on, so all of them would count as rim.)
        // The low sun shining through the leaf from behind lights it from within, gold-green.
        light: SUN_SHEEN(14.0, 0.9) + 'totalEmissiveRadiance += diffuseColor.rgb * vec3(0.55, 0.5, 0.25);',
      });
    case 'Frog':
      // Wet skin: glossy, with fine bumps darkening and lightening the mottling, rimmed by the low sun behind it.
      return physical(source, { roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.2 }, 'frog', {
        colour: 'diffuseColor.rgb *= (0.82 + 0.36 * lNoise(vLandingPos * 140.0)) * vec3(1.02, 0.98, 0.88);',
        normal: BUMP('lNoise(vLandingPos * 160.0)', 0.0015),
        light: `${SUN_SHEEN(24.0, 1.4)}${BACKLIT(1.4)}\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(0.2, 0.17, 0.1);`,
      });
    case 'Dew':
      // Clear beads of water: you see the pad through them, and each holds a hot point of the sun.
      return physical(
        source,
        { vertexColors: false, color: new Color(0xd8e6c8), roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, opacity: 0.4 },
        'dew',
        { light: SUN_SHEEN(40.0, 12.0) + BACKLIT(2.0) }
      );
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
      return physical(source, { roughness: 0.5, side: DoubleSide }, 'lily', {
        light: `${BACKLIT(0.8)}\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(0.45, 0.38, 0.36);`,
      });
    case 'Pebble': {
      // Wet granite: Poly Haven's scanned rock_boulder_dry, projected from three sides (the stones have no UVs) and
      // recoloured by each stone's own tone; glittering where the sun catches it.
      const granite = scan('rock_boulder_dry');
      const projection = /* glsl */ `
  vec3 nW = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  vec3 w = triWeights(nW);
  vec3 pp = vLandingPos / 0.6;`;
      return physical(source, { roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.25 }, 'pebble', {
        uniforms: {
          uGraniteDiff: { value: granite.diff },
          uGraniteNor: { value: granite.nor },
          uGraniteRough: { value: granite.rough },
          uGraniteMean: { value: granite.mean },
        },
        header: `uniform sampler2D uGraniteDiff, uGraniteNor, uGraniteRough;\nuniform vec3 uGraniteMean;\n${TRIPLANAR}`,
        colour: /* glsl */ `
{
  ${projection}
  vec3 detail = tri(uGraniteDiff, pp, w) / uGraniteMean;
  diffuseColor.rgb *= clamp(mix(vec3(dot(detail, vec3(0.2126, 0.7152, 0.0722))), detail, 0.3), 0.0, 2.5);
  // Greyer and paler than the stones' warm vertex tone: the reference's are cream-grey granite in a gold light.
  diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), diffuseColor.rgb, 0.55) * 1.05;
}`,
        roughness: `{\n${projection}\n  roughnessFactor = clamp(tri(uGraniteRough, pp, w).r * 0.6, 0.15, 0.7);\n}`,
        normal: `{\n${projection}\n  normal = normalize((viewMatrix * vec4(triNormal(uGraniteNor, pp, w, nW, 1.4), 0.0)).xyz);\n}`,
        light: GLINTS(140.0, 0.93, 14.0) + BACKLIT(1.1),
      });
    }
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

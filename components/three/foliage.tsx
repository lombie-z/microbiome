'use client';

import { useMemo } from 'react';
import {
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix3,
  type Mesh,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { isLightDevice } from '@/lib/journey';
import { foliageMaterial } from './landing';

// Trees and bushes clinging to the canyon (art/build-landing.py), as thick on its ledges, faces and skyline as the
// reference's: leafy clumps scattered over the canyon mesh's own vertices, in patches, on the site rather than in the
// glb (thousands of instances of one clump cost almost nothing to download).

function hash(x: number, y: number, z: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Smooth value noise, 0..1: where the clumps gather into patches. */
function patchNoise(p: Vector3) {
  const ix = Math.floor(p.x),
    iy = Math.floor(p.y),
    iz = Math.floor(p.z);
  const fx = p.x - ix,
    fy = p.y - iy,
    fz = p.z - iz;
  const u = (t: number) => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(ix + dx, iy + dy, iz + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u(fx)), lerp(c(0, 1, 0), c(1, 1, 0), u(fx)), u(fy)),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u(fx)), lerp(c(0, 1, 1), c(1, 1, 1), u(fx)), u(fy)),
    u(fz)
  );
}

const LAKE_Y = -11;
const GREENS = ['#5b7a2e', '#6e8a35', '#4a6a2a', '#7f9440', '#3d5a26', '#8a9a48'].map((c) => new Color(c));
const BLOSSOM = ['#e7a3b4', '#d98aa2', '#f2c0c8'].map((c) => new Color(c));

// Scanned trees (Poly Haven's island_tree_01, a pink-blossom variant of it, and island_tree_02), rendered in Blender
// lit as the landing is (art/bake-foliage-sprites.py, packed by art/pack-foliage-atlas.py): 3x3 cells, three views each.
const ATLAS = '/textures/landing/foliage-atlas.png';
const GREEN_CELLS = [0, 1, 2, 6, 7, 8];
const PINK_CELLS = [3, 4, 5];

const treeVertex = /* glsl */ `
attribute vec3 aBase;
attribute float aSize;
attribute float aCell;
attribute float aFlip;
attribute float aShade;
varying vec2 vUv;
varying float vShade;
varying float vPink;
#include <fog_pars_vertex>
void main() {
  // Upright cards turned to the camera round the vertical, standing on their base.
  vec3 toCamera = cameraPosition - aBase;
  toCamera.y = 0.0;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(toCamera)));
  vec3 p = aBase + right * position.x * aSize + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * aSize;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vec2 cellUv = vec2(mix(uv.x, 1.0 - uv.x, aFlip), uv.y);
  vUv = (vec2(mod(aCell, 3.0), 2.0 - floor(aCell / 3.0)) + cellUv) / 3.0;
  vShade = aShade;
  vPink = aCell >= 3.0 && aCell < 6.0 ? 1.0 : 0.0;
  #include <fog_vertex>
}`;

const treeFragment = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying float vShade;
varying float vPink;
#include <fog_pars_fragment>
void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  if (tex.a < 0.45) discard;
  // The renders came out dark (scanned leaves are dark, and the sprites were lit for a dim sky): lift them to the
  // landing's sunlit greens, and turn the blossom variant properly pink, keeping its light and shade.
  vec3 c = tex.rgb * 3.0 * vec3(1.05, 1.0, 0.85);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Greener foliage (the scans' leaves render olive-brown here), lit from within at the bright edges.
  c = mix(c, vec3(0.5, 0.72, 0.28) * (0.25 + 1.4 * l), (1.0 - vPink) * 0.55);
  c = mix(c, vec3(1.0, 0.5, 0.52) * (0.35 + 1.5 * l), vPink * 0.92);
  gl_FragColor = vec4(c * vShade, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;

type Spot = { p: Vector3; n: Vector3; size: number; blossom: boolean };

function pickSpots(canyon: Mesh, max: number) {
  canyon.updateWorldMatrix(true, false);
  const position = canyon.geometry.getAttribute('position');
  const normal = canyon.geometry.getAttribute('normal');
  const p = new Vector3();
  const n = new Vector3();
  const normalMatrix = new Matrix3().getNormalMatrix(canyon.matrixWorld);
  const spots: Spot[] = [];
  for (let i = 0; i < position.count && spots.length < max * 3; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(canyon.matrixWorld);
    n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
    const above = p.y - LAKE_Y;
    if (above < 0.5) continue;
    const patch = patchNoise(p.clone().multiplyScalar(0.35));
    const r = hash(p.x, p.y, p.z);
    // Tops and ledges: well wooded. Faces: in patches, and hanging along the fractures.
    const ledge = n.y > 0.55;
    const chance = ledge ? 0.25 + 0.6 * patch : n.y > -0.3 ? Math.max(0, patch - 0.45) * 1.1 : 0;
    if (r > chance) continue;
    const blossom = hash(p.z, p.x, 3.1) < 0.22 && Math.hypot(p.x + 5, p.z) < 40;
    spots.push({ p: p.clone(), n: n.clone(), size: ledge ? 0.25 + 0.4 * hash(p.y, p.z, p.x) : 0.15 + 0.25 * hash(p.y, p.z, p.x), blossom });
  }
  // Thin to the budget evenly.
  return spots.filter((_, i) => i % Math.max(1, Math.ceil(spots.length / max)) === 0);
}

/** One tree per spot: on ledges and tops full trees, on the faces small ones clinging on. */
function trees(spots: Spot[]) {
  const geometry = new InstancedBufferGeometry();
  const card = new PlaneGeometry(1, 1);
  geometry.index = card.index;
  geometry.setAttribute('position', card.getAttribute('position'));
  geometry.setAttribute('uv', card.getAttribute('uv'));
  const base = new Float32Array(spots.length * 3);
  const size = new Float32Array(spots.length);
  const cell = new Float32Array(spots.length);
  const flip = new Float32Array(spots.length);
  const shade = new Float32Array(spots.length);
  spots.forEach((s, i) => {
    const ledge = s.n.y > 0.55;
    const h = ledge ? 0.7 + 1.2 * hash(i, 3, 1) : 0.35 + 0.45 * hash(i, 3, 1);
    // Sunk a little into the slope, so no tree stands on air.
    base.set([s.p.x, s.p.y - h * 0.08, s.p.z], i * 3);
    size[i] = h;
    const cells = s.blossom ? PINK_CELLS : GREEN_CELLS;
    cell[i] = cells[Math.floor(hash(i, 7, 5) * cells.length)];
    flip[i] = hash(i, 9, 2) < 0.5 ? 0 : 1;
    shade[i] = 1.0 + 0.35 * hash(i, 4, 8);
  });
  geometry.setAttribute('aBase', new InstancedBufferAttribute(base, 3));
  geometry.setAttribute('aSize', new InstancedBufferAttribute(size, 1));
  geometry.setAttribute('aCell', new InstancedBufferAttribute(cell, 1));
  geometry.setAttribute('aFlip', new InstancedBufferAttribute(flip, 1));
  geometry.setAttribute('aShade', new InstancedBufferAttribute(shade, 1));
  geometry.instanceCount = spots.length;
  const atlas = new TextureLoader().load(ATLAS);
  atlas.colorSpace = SRGBColorSpace;
  atlas.anisotropy = 4;
  const material = new ShaderMaterial({
    vertexShader: treeVertex,
    fragmentShader: treeFragment,
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uAtlas: { value: null } }]),
    fog: true,
  });
  material.uniforms.uAtlas.value = atlas;
  return { geometry, material };
}

export function Foliage({ canyon }: { canyon: Mesh }) {
  const spots = useMemo(() => pickSpots(canyon, isLightDevice() ? 700 : 1800), [canyon]);
  const tree = useMemo(() => trees(spots), [spots]);
  const mesh = useMemo(() => {
    const keep = spots;
    // Undergrowth round each tree: a couple of low clumps hugging the rock.
    const PER = 2;
    const instanced = new InstancedMesh(new IcosahedronGeometry(1, 2), foliageMaterial(), keep.length * PER);
    instanced.name = 'LandingFoliage';
    const dummy = new Object3D();
    const colour = new Color();
    const tangent = new Vector3();
    const bitangent = new Vector3();
    keep.forEach((s, i) => {
      tangent.set(0, 1, 0).cross(s.n);
      if (tangent.lengthSq() < 0.01) tangent.set(1, 0, 0);
      tangent.normalize();
      bitangent.crossVectors(s.n, tangent);
      const palette = s.blossom ? BLOSSOM : GREENS;
      for (let k = 0; k < PER; k++) {
        const j = i * PER + k;
        const size = s.size * (0.25 + 0.45 * hash(j, 1, 9));
        dummy.position
          .copy(s.p)
          .addScaledVector(tangent, (hash(j, 4, 1) - 0.5) * s.size * 2.2)
          .addScaledVector(bitangent, (hash(j, 6, 2) - 0.5) * s.size * 2.2)
          .addScaledVector(s.n, size * 0.15);
        dummy.scale.set(size, size * (0.7 + 0.35 * hash(j, 1, 2)), size);
        dummy.rotation.set(0, hash(j, 2, 3) * 6.28, 0);
        dummy.updateMatrix();
        instanced.setMatrixAt(j, dummy.matrix);
        colour.copy(palette[Math.floor(hash(j, 5, 7) * palette.length)]);
        instanced.setColorAt(j, colour);
      }
    });
    instanced.frustumCulled = false;
    return instanced;
  }, [spots]);

  return (
    <>
      <primitive object={mesh} />
      <mesh name="LandingTrees" geometry={tree.geometry} material={tree.material} frustumCulled={false} />
    </>
  );
}

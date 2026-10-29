'use client';

import { useMemo } from 'react';
import { Color, IcosahedronGeometry, InstancedMesh, Matrix3, type Mesh, Object3D, Vector3 } from 'three';
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

export function Foliage({ canyon }: { canyon: Mesh }) {
  const mesh = useMemo(() => {
    canyon.updateWorldMatrix(true, false);
    const position = canyon.geometry.getAttribute('position');
    const normal = canyon.geometry.getAttribute('normal');
    const p = new Vector3();
    const n = new Vector3();
    const normalMatrix = new Matrix3().getNormalMatrix(canyon.matrixWorld);
    const spots: { p: Vector3; n: Vector3; size: number; blossom: boolean }[] = [];
    const max = isLightDevice() ? 700 : 1800;
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
      const blossom = hash(p.z, p.x, 3.1) < 0.14 && Math.hypot(p.x + 5, p.z) < 32;
      spots.push({ p: p.clone(), n: n.clone(), size: ledge ? 0.25 + 0.4 * hash(p.y, p.z, p.x) : 0.15 + 0.25 * hash(p.y, p.z, p.x), blossom });
    }
    // Thin to the budget evenly.
    const keep = spots.filter((_, i) => i % Math.max(1, Math.ceil(spots.length / max)) === 0);
    // Each spot is a little thicket: a few clumps of different sizes, hugging the rock.
    const PER = 4;
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
        const size = s.size * (0.35 + 0.65 * hash(j, 1, 9));
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
  }, [canyon]);

  return <primitive object={mesh} />;
}

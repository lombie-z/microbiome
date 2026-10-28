'use client';

import { MeshReflectorMaterial } from '@react-three/drei';
import { isLightDevice } from '@/lib/journey';

// The lake under the landing (art/build-landing.py LAKE_CENTRE, LAKE_Z; Blender's -y is three's z): a still, glassy
// mirror of the cliffs, the fall and the low sun. drei's reflector wants a plane facing +z, hence the rotation.
const CENTRE: [number, number, number] = [-5, -11, 0];
const RADIUS = 24;

export function Lake() {
  const light = isLightDevice();
  return (
    <mesh name="Lake" position={CENTRE} rotation-x={-Math.PI / 2} renderOrder={1}>
      <circleGeometry args={[RADIUS, 96]} />
      <MeshReflectorMaterial
        resolution={light ? 384 : 1024}
        mirror={0.85}
        mixStrength={2.2}
        mixBlur={0.6}
        blur={[180, 40]}
        depthScale={0}
        color="#93a9c0"
        roughness={0.35}
        metalness={0.4}
      />
    </mesh>
  );
}

'use client';

import { ContactShadows, PerspectiveCamera, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MathUtils, type Mesh, type Object3D, type PerspectiveCamera as PerspectiveCameraImpl, Vector3 } from 'three';
import { heroStageSize } from '@/lib/journey';
import { SilhouetteOutline } from './silhouette-outline';
import { useStudioReflections } from './studio-environment';

export const DRACO_PATH = '/draco/';
const URL = '/models/micro-biome.glb';

// The hero matches the blog's biome view (and the Blender preview camera): three-quarter, 3.7 units across the stage.
// A long lens from far away stands in for the blog's orthographic camera, so the journey can widen it later.
const TARGET = new Vector3(0, 0.92, 0);
const VIEW_DIRECTION = new Vector3(-1, 0.75, 1).normalize();
const FRAME = 3.7;
const HERO_FOV = 6;
// The letter ring orbits this point; the sticker band sits at its depth so the ring weaves in front of and behind it.
const OUTLINE_DEPTH = new Vector3(0, 0.62, 0);

type Animated = { node: Object3D; kind: 'ring' | 'cloud' | 'star' | 'letter' | 'water'; i: number; base: { position: Vector3; scale: Vector3; rotY: number } };

function classify(name: string): Animated['kind'] | null {
  if (name === 'LetterRing') return 'ring';
  if (name === 'LetterRingTilt') return null;
  if (name.startsWith('Cloud')) return 'cloud';
  if (name.startsWith('Star')) return 'star';
  if (name.startsWith('Letter') || name.startsWith('Word')) return 'letter';
  if (name.startsWith('Water')) return 'water';
  return null;
}

// The lettering tumbles free of the sticker outline; contact shadows aren't part of the object.
function isOutsideOutline(o: Object3D) {
  return o.name.startsWith('Letter') || o.name.startsWith('Word') || o.name === 'ContactShadows';
}

export function Biome({ onReady }: { onReady: () => void }) {
  const { scene } = useGLTF(URL, DRACO_PATH);
  const camera = useRef<PerspectiveCameraImpl>(null);

  const animated = useMemo(() => {
    const list: Animated[] = [];
    const counts: Record<string, number> = {};
    scene.traverse((child) => {
      if ((child as Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
      const kind = classify(child.name);
      // Only animate the named object nodes, not glTF's per-primitive children.
      if (kind && child.parent && !classify(child.parent.name)) {
        counts[kind] = (counts[kind] ?? 0) + 1;
        list.push({ node: child, kind, i: counts[kind], base: { position: child.position.clone(), scale: child.scale.clone(), rotY: child.rotation.y } });
      }
    });
    return list;
  }, [scene]);

  useStudioReflections(scene, 0.8);
  useEffect(onReady, [onReady]);

  useFrame((state) => {
    const cam = camera.current;
    if (cam) {
      // Fit FRAME world units across the hero stage at the target's distance.
      const { width, height } = state.size;
      const visibleHeight = (FRAME * height) / heroStageSize(width, height);
      const distance = visibleHeight / (2 * Math.tan(MathUtils.degToRad(HERO_FOV / 2)));
      cam.fov = HERO_FOV;
      cam.near = distance - 6;
      cam.far = distance + 6;
      cam.position.copy(TARGET).addScaledVector(VIEW_DIRECTION, distance);
      cam.lookAt(TARGET);
      cam.updateProjectionMatrix();
    }

    const t = state.clock.elapsedTime;
    for (const a of animated) {
      const { node, base, i } = a;
      switch (a.kind) {
        case 'ring':
          // MICRO • BIOME orbits slowly around the planter.
          node.rotation.y = base.rotY + t * 0.18;
          break;
        case 'cloud':
          node.position.x = base.position.x + Math.sin(t * 0.35 + i * 2.1) * 0.12;
          node.position.z = base.position.z + Math.cos(t * 0.25 + i) * 0.05;
          break;
        case 'star': {
          const s = 1 + Math.sin(t * 2.2 + i * 1.9) * 0.18;
          node.scale.copy(base.scale).multiplyScalar(s);
          node.rotation.y = base.rotY + Math.sin(t * 0.8 + i) * 0.4;
          break;
        }
        case 'letter':
          node.position.y = base.position.y + Math.sin(t * 1.6 - i * 0.7) * 0.035;
          break;
        case 'water':
          node.position.y = base.position.y + Math.sin(t * 0.9) * 0.004;
          break;
      }
    }
  });

  return (
    <>
      <PerspectiveCamera ref={camera} makeDefault />
      <hemisphereLight args={['#fffaf2', '#e3d6c6', 0.9]} />
      <directionalLight
        position={[-3, 6, 4]}
        intensity={1.8}
        color="#fff6ea"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
        shadow-camera-left={-2.5}
        shadow-camera-right={2.5}
        shadow-camera-top={3}
        shadow-camera-bottom={-1.5}
      />
      <primitive object={scene} />
      <SilhouetteOutline target={scene} exclude={isOutsideOutline} depthAt={OUTLINE_DEPTH} />
      <ContactShadows name="ContactShadows" position={[0, -0.01, 0]} scale={3} blur={2.4} opacity={0.32} far={0.35} resolution={512} color="#6b5a48" />
    </>
  );
}

if (typeof window !== 'undefined') useGLTF.preload(URL, DRACO_PATH);

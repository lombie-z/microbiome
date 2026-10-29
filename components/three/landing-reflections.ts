import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import {
  CubeCamera,
  HalfFloatType,
  type Material,
  type Mesh,
  type MeshPhysicalMaterial,
  type Object3D,
  PMREMGenerator,
  type Texture,
  WebGLCubeRenderTarget,
} from 'three';
import { journey, landingAt } from '@/lib/journey';

// Real reflections for the landing's foreground: once the camera has arrived, the world around it (sky, sun, fall,
// cliffs, lake) is captured once from the camera's place into a cube map and prefiltered, and the named materials
// reflect that instead of the white studio room the clay hero uses. Glossy, wet surfaces then show the scene itself.
// The foreground is hidden while capturing, so it doesn't reflect itself.

const FOREGROUND = ['LandingReeds', 'LandingPads', 'LandingFrog', 'LandingLilies', 'LandingPebbles', 'LandingDew'];
const isForeground = (o: Object3D) => FOREGROUND.some((name) => o.name.startsWith(name) || o.parent?.name.startsWith(name));

export function useLandingReflections(root: Object3D, materialNames: string[], intensity = 1) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const env = useRef<Texture | null>(null);

  useFrame((state) => {
    if (env.current || landingAt(journey.frame) < 0.97) return;
    const target = new WebGLCubeRenderTarget(256, { type: HalfFloatType });
    const cube = new CubeCamera(0.1, 1000, target);
    cube.position.copy(state.camera.position);
    const hidden: Object3D[] = [];
    root.traverse((o) => {
      if ((o as Mesh).isMesh && o.visible && isForeground(o)) {
        o.visible = false;
        hidden.push(o);
      }
    });
    cube.update(gl, scene);
    for (const o of hidden) o.visible = true;
    const pmrem = new PMREMGenerator(gl);
    env.current = pmrem.fromCubemap(target.texture).texture;
    pmrem.dispose();
    target.dispose();
    root.traverse((o) => {
      const material = (o as Mesh).material as Material | undefined;
      if (material && materialNames.includes(material.name)) {
        const physical = material as MeshPhysicalMaterial;
        physical.envMap = env.current;
        physical.envMapIntensity = intensity;
        physical.needsUpdate = true;
      }
    });
  });

  useEffect(() => () => env.current?.dispose(), []);
}

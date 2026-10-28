'use client';

import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  Color,
  type DirectionalLight,
  DoubleSide,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
  ShaderMaterial,
  Vector3,
} from 'three';
import { BEATS, journey, smoothstep } from '@/lib/journey';
import { SilhouetteOutline } from './silhouette-outline';
import { bloomAt } from './sky';
import { Spray } from './spray';
import { useStudioReflections } from './studio-environment';
import { waterMaterial, waterTime } from './water';

export const DRACO_PATH = '/draco/';
const URL = '/models/micro-biome.glb';

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

/** A mesh's Blender object name (glTF splits multi-material meshes into children named after their group). */
const ownerName = (o: Object3D) => (o.parent?.name && o.name !== o.parent.name && o.name.startsWith(o.parent.name) ? o.parent.name : o.name);

// Below the planter: none of it casts shadows or takes part in the sticker outline. (three.js drops the dots from
// glTF node names, so Blender's Fall.A arrives as FallA.)
const SKY_PARTS = ['Fall', 'Splash', 'Spray', 'Pool', 'Basin', 'SkyCloud', 'SkyDome', 'Sun', 'Rainbow'];
const isSkyPart = (name: string) => SKY_PARTS.some((p) => name.startsWith(p));

// The lettering tumbles free of the sticker outline, and the water spills off the sticker.
function isOutsideOutline(o: Object3D) {
  return o.name.startsWith('Letter') || o.name.startsWith('Word') || isSkyPart(o.name) || isSkyPart(o.parent?.name ?? '');
}

/** Clouds stay the biome's clay outside; from inside (their back faces) they glow white, for the fly-through. */
function whiteoutCloud(source: Material) {
  const material = source.clone();
  material.side = DoubleSide;
  // Faded in (dithered, so no sorting against the water) as the camera leaves the hero.
  material.alphaHash = true;
  material.opacity = 0;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\nif (!gl_FrontFacing) gl_FragColor = vec4(0.97, 0.95, 0.93, 1.0);'
    );
  };
  material.customProgramCacheKey = () => 'whiteout-cloud';
  return material;
}

/** The rainbow: spectral bands across the arc (u: outer red to inner violet), fading at its edges and feet. */
function rainbowMaterial() {
  return new ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec2 vUv;
      vec3 spectrum(float x) {
        vec3 c[6] = vec3[6](vec3(0.95, 0.25, 0.3), vec3(1.0, 0.55, 0.2), vec3(1.0, 0.86, 0.3), vec3(0.35, 0.78, 0.42), vec3(0.3, 0.55, 0.95), vec3(0.55, 0.38, 0.9));
        float f = clamp(x, 0.0, 0.999) * 5.0;
        int i = int(floor(f));
        return mix(c[i], c[min(i + 1, 5)], fract(f));
      }
      void main() {
        float along = 1.0 - vUv.y;
        // pow() of a negative is NaN (and bloom smears one NaN pixel over the whole screen), so clamp first.
        float a = pow(max(sin(3.14159 * vUv.x), 0.0), 0.6) * pow(max(sin(3.14159 * along), 0.0), 0.8) * uOpacity * 0.7;
        gl_FragColor = vec4(spectrum(vUv.x), a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
}

export function Biome({ onReady, onSun }: { onReady: () => void; onSun: (sun: Mesh) => void }) {
  const { scene } = useGLTF(URL, DRACO_PATH);
  const rainbow = useRef<ShaderMaterial | null>(null);
  const cloudMaterials = useRef(new Map<Material, Material>());
  const key = useRef<DirectionalLight>(null);
  const sun = useRef<Mesh | null>(null);

  // Give the sky parts their web materials (water shaders, whiteout clouds, the rainbow and the sun for the rays).
  useMemo(() => {
    const still = waterMaterial('still');
    const pool = waterMaterial('pool');
    const falling = waterMaterial('falling');
    const clouds = cloudMaterials.current;
    scene.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const name = ownerName(mesh);
      // Blender's cloud material glows white inside (the fly-through); glTF carries that out as an emissive glow on
      // the whole surface. The web does the inside itself (whiteoutCloud), so drop it.
      const own = mesh.material as MeshStandardMaterial;
      if (own.name === 'Cloud' && own.emissive) own.emissive.setRGB(0, 0, 0);
      if (name === 'Water') mesh.material = still;
      else if (name === 'Pool') mesh.material = pool;
      else if (name.startsWith('Fall')) {
        mesh.material = falling;
        mesh.renderOrder = 2;
      } else if (name.startsWith('SkyCloud')) {
        const source = mesh.material as Material;
        if (!clouds.has(source)) clouds.set(source, whiteoutCloud(source));
        mesh.material = clouds.get(source) as Material;
      } else if (name === 'Rainbow') {
        rainbow.current = rainbowMaterial();
        mesh.material = rainbow.current;
        mesh.renderOrder = 3;
      } else if (name === 'Sun') {
        // Brighter than white so the bloom catches it; the light rays need it transparent and not writing depth.
        mesh.material = new MeshBasicMaterial({
          color: new Color(1.0, 0.72, 0.42).multiplyScalar(3),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          fog: false,
          toneMapped: false,
        });
        sun.current = mesh;
      }
    });
  }, [scene]);

  const animated = useMemo(() => {
    const list: Animated[] = [];
    const counts: Record<string, number> = {};
    scene.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const sky = isSkyPart(ownerName(child));
        child.castShadow = !sky;
        child.receiveShadow = !sky;
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
  // Compile every shader up front (with everything shown, so the sun, clouds and rainbow that appear later are
  // included), then report ready once a frame has drawn: no stalls mid-scroll when something first comes into view.
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const threeScene = useThree((s) => s.scene);
  useEffect(() => {
    let live = true;
    const hidden: Object3D[] = [];
    threeScene.traverse((o) => {
      if (!o.visible) {
        o.visible = true;
        hidden.push(o);
      }
    });
    const opacities = [...cloudMaterials.current.values()].map((m) => [m, m.visible] as const);
    for (const [m] of opacities) m.visible = true;
    gl.compileAsync(threeScene, camera)
      .catch(() => {})
      .then(() => {
        for (const o of hidden) o.visible = false;
        for (const [m, visible] of opacities) m.visible = visible;
        requestAnimationFrame(() => requestAnimationFrame(() => live && onReady()));
      });
    return () => {
      live = false;
    };
  }, [gl, camera, threeScene, onReady]);
  useEffect(() => {
    if (sun.current) onSun(sun.current);
  }, [onSun]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    waterTime.value += Math.min(delta, 1 / 20);
    if (rainbow.current) {
      const bow = smoothstep(BEATS.bowIn, BEATS.bowFull, journey.frame);
      rainbow.current.uniforms.uOpacity.value = bow;
      rainbow.current.visible = bow > 0.001;
    }
    // The studio key gives way to the warm sun (components/three/sky.tsx) below the clouds.
    if (key.current) key.current.intensity = 1.8 - 0.7 * bloomAt(journey.frame);
    const clouds = smoothstep(30, 110, journey.frame);
    for (const m of cloudMaterials.current.values()) {
      m.opacity = clouds;
      m.visible = clouds > 0.001;
    }
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
      <hemisphereLight args={['#fffaf2', '#e3d6c6', 0.9]} />
      <directionalLight
        ref={key}
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
      {!(process.env.NODE_ENV === 'development' && window.location.search.includes('nospray')) && <Spray scene={scene} />}
      <SilhouetteOutline target={scene} exclude={isOutsideOutline} depthAt={OUTLINE_DEPTH} fade={outlineFade} />
    </>
  );
}

// The sticker outline belongs to the hero; it lifts away as the camera opens up.
const outlineFade = () => 1 - smoothstep(10, 60, journey.frame);

if (typeof window !== 'undefined') useGLTF.preload(URL, DRACO_PATH);

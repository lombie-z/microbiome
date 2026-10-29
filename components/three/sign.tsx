'use client';

import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { DoubleSide, FrontSide, type Mesh, MeshStandardMaterial, type Object3D, Vector3 } from 'three';
import { journey, landingAt } from '@/lib/journey';
import { DRACO_PATH } from './biome';

// FogDrog's road signs (art/build-sign.py), left over at the landing's water's edge: a green highway guide sign on two
// posts, standing in the shallows on the left and leaning a little, and a small yellow dog-and-frog crossing diamond
// further back. Their colour and weathering live in the vertex colours ('Col'); '_metal' marks the bare metal.
const URL = '/models/sign.glb';

// Where they stand (three's x, z), turned toward the camera (yaw, degrees), leaning (sideways, back) and sunk into the
// water (the lake's surface is at y -11). The guide sign fills the gap between the low sun and the fall, above the
// headline, keeping clear of the sun (its starburst is drawn over whatever's in front of it); the diamond stands
// behind it, between its posts, left of where the dog wades. (Picked with the landing camera at 1440 x 900.)
const WATER_Y = -11;

// Where the landing's buttons hang (components/sign-buttons.tsx): just inside the guide's left post (art/build-sign.py:
// posts at x ±0.95, the panel's foot 2.3 m up), under the panel, in the sign's plane. Its corners are projected to the
// screen each frame (CSS px: top-left, top-right, bottom-right, bottom-left); BUTTONS_BOX is the buttons' box in CSS
// px, the same proportions.
export const BUTTONS_BOX = { width: 220, height: 200 };
const BOX_LEFT = -0.8; // 0.1 m in from the left post's edge (-0.9)
const BOX_TOP = 2.16; // 0.14 m under the panel's foot
const BOX_W = 0.95;
const BOX_H = (BOX_W * BUTTONS_BOX.height) / BUTTONS_BOX.width;
// Tilted up on the right a touch, in line with the panel's bottom edge as it reads on screen.
const BOX_LIFT = 0.025;
const STRIP_CORNERS = [
  new Vector3(BOX_LEFT, BOX_TOP, 0.06),
  new Vector3(BOX_LEFT + BOX_W, BOX_TOP + BOX_LIFT, 0.06),
  new Vector3(BOX_LEFT + BOX_W, BOX_TOP + BOX_LIFT - BOX_H, 0.06),
  new Vector3(BOX_LEFT, BOX_TOP - BOX_H, 0.06),
];
export const signQuad = {
  shown: false,
  points: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
};
const corner = new Vector3();
const PLACES = {
  guide: { at: [-18.5, -1.0], yaw: -57, lean: [-1.5, -3], sink: 0.1, scale: 1 },
  diamond: { at: [-12.5, -2.1], yaw: -62, lean: [6, 2], sink: 0.3, scale: 1.3 },
} as const;

/** Light catching the low sun, as the landing's foreground (components/three/landing.ts): the colour is lifted by a warm
 * fill (the backlit haze lights everything facing the camera), the rims glow where the sun's behind them. */
function signMaterial(name: string, ivy: boolean) {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: ivy ? 0.55 : 0.62, metalness: 0, side: ivy ? DoubleSide : FrontSide });
  material.name = name;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _metal;\nvarying float vMetal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMetal = _metal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMetal;')
      // Bare zinc and steel: a little shinier and more metallic than the chalky paint.
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.42, vMetal);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = 0.3 * vMetal;')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
{
  float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
  totalEmissiveRadiance += diffuseColor.rgb * (vec3(${ivy ? '0.55, 0.5, 0.25' : '0.38, 0.32, 0.26'}) + vec3(1.25, 1.0, 0.6) * pow(rim, 2.0) * ${ivy ? '1.6' : '0.5'});
}`
      );
  };
  material.customProgramCacheKey = () => `sign-${ivy}`;
  return material;
}

export function Sign() {
  const { scene } = useGLTF(URL, DRACO_PATH);

  const parts = useMemo(() => {
    const paint = signMaterial('SignPaint', false);
    const ivy = signMaterial('SignIvy', true);
    scene.traverse((o: Object3D) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.material = (mesh.material as MeshStandardMaterial).name === 'SignIvy' ? ivy : paint;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    const place = (name: string, p: (typeof PLACES)[keyof typeof PLACES]) => {
      const node = scene.getObjectByName(name);
      if (!node) return;
      node.position.set(p.at[0], WATER_Y - p.sink, p.at[1]);
      node.scale.setScalar(p.scale);
      // Turned to face the camera (the model faces +z), then leaning sideways and back.
      node.rotation.set((p.lean[1] * Math.PI) / 180, (p.yaw * Math.PI) / 180, (p.lean[0] * Math.PI) / 180, 'YXZ');
    };
    place('Sign', PLACES.guide);
    place('Diamond', PLACES.diamond);
    return scene;
  }, [scene]);

  const guide = parts.getObjectByName('Sign');
  useFrame(({ camera, size }) => {
    parts.visible = landingAt(journey.frame) > 0.001;
    signQuad.shown = parts.visible && !!guide;
    if (!signQuad.shown || !guide) return;
    guide.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    STRIP_CORNERS.forEach((c, i) => {
      corner.copy(c).applyMatrix4(guide.matrixWorld).project(camera);
      signQuad.points[i] = [((corner.x + 1) / 2) * size.width, ((1 - corner.y) / 2) * size.height];
    });
  });

  return <primitive object={parts} />;
}

useGLTF.preload(URL, DRACO_PATH);

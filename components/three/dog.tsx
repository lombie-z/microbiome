'use client';

import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  AnimationMixer,
  CanvasTexture,
  type Group,
  type Material,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  RingGeometry,
  SkinnedMesh,
  Vector3,
} from 'three';
import { devFlag, journey, landingAt } from '@/lib/journey';
import { DRACO_PATH } from './biome';

// The golden retriever (art/build-dog.py, art/rig-dog.py), wading about the shallows in front of the fall's mist: it
// walks a while, stops to sniff the water, wanders off behind the reeds, comes back up close, sniffs and wanders off
// again. Its coat is shell fur: the skinned body drawn again in SHELLS layers, each a little further along every strand,
// which leaves the skin at a shallow angle and lies back the way the coat is combed, drooping where it's long. How long
// the fur grows comes from the model ('_fur': short on the face and paws, long in the feathering).
const URL = '/models/dog.glb';
const SHELLS = 16;
const FUR = 0.1; // longest fur (the feathering), in the model's metres
// How the coat lies: combed back toward the tail and down (x back, y down, in the model's frame), standing off the skin
// by this share of its length (short fur to long), drooping this much more where it's long, in locks this many times
// longer than wide, CELL locks a metre across, and up to SHORT of them shorter than the rest.
const COMB = [0.55, 1.0];
const LIFT = [0.45, 0.16];
const DROOP = 0.9;
const STRETCH = 7;
const CELL = 230;
const SHORT = 0.45;
const glsl = (x: number) => x.toFixed(4);
const SCALE = 1.95;
// Where it goes, on the lake (three's x, z; art/build-landing.py at() picks them off the landing view's pixels). The
// lake's surface is at y -11 (components/three/lake.tsx): it wades in up to its forearms.
const WATER_Y = -11;
const SINK = 0.3 * SCALE; // in to its forearms; its sniffing nose (0.32 m) just touches the water
const SPOTS = {
  mid: [-3.0, -2.2], // across the middle, in front of the mist (view x 800, row 612)
  left: [-3.6, -5.1], // further left (620, 612)
  reedsEdge: [-1.7, 3.9], // just behind the reeds (1180, 612)
  hidden: [-1.1, 6.6], // well behind them (1350, 612)
  near: [-14.9, 1.4], // up close, between the frog and the reeds (950, 640)
  nearRight: [-16.4, 1.7], // closer still (980, 648)
} as const;
type Spot = keyof typeof SPOTS;
// What it does, over and over: walk to a spot, or stay a few seconds doing something there.
type Step = { to: Spot } | { do: 'Sniff' | 'Idle'; for: [number, number] };
const ROUTINE: Step[] = [
  { to: 'mid' },
  { do: 'Sniff', for: [2.5, 4] },
  { to: 'left' },
  { do: 'Idle', for: [1.5, 2.5] },
  { do: 'Sniff', for: [2, 3] },
  { to: 'reedsEdge' },
  { to: 'hidden' },
  { do: 'Idle', for: [3, 5] },
  { to: 'reedsEdge' },
  { to: 'nearRight' },
  { do: 'Sniff', for: [3, 4.5] },
  { do: 'Idle', for: [1.5, 2.5] },
  { to: 'near' },
  { do: 'Sniff', for: [2, 3] },
];
const SPEED = 0.5 * SCALE; // the walk's own pace (0.5 m a stride, a stride a second: art/rig-dog.py), so paws don't slide
const TURN = 1.4; // radians a second
const FADE = 0.45; // seconds to blend between walking, sniffing and standing
// Ripples spreading from where it wades: a ring every half stride, growing and fading.
const RINGS = 10;
const RING_EVERY = 0.53;
const RING_LIFE = RING_EVERY * RINGS;

function furMaterial(shell: number) {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.name = 'DogFur';
  m.onBeforeCompile = (s) => {
    s.uniforms.uShell = { value: shell / SHELLS };
    s.uniforms.uLen = { value: FUR };
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float _fur;
        uniform float uShell;
        uniform float uLen;
        varying vec3 vRest;
        varying vec3 vRestN;
        varying vec3 vComb;
        varying float vFur;
        // The way the coat is combed, in the skin's plane at rest: back toward the tail and down.
        vec3 furComb(vec3 n) {
          vec3 c = vec3(-${glsl(COMB[0])}, -${glsl(COMB[1])}, 0.0);
          vec3 back = vec3(-1.0, 0.0, 0.0);
          return normalize(c - n * dot(c, n) + 0.3 * (back - n * dot(back, n)));
        }`
      )
      .replace(
        '#include <skinning_vertex>',
        `#include <skinning_vertex>
        vec3 comb = furComb(normal);
        vRest = position;
        vRestN = normal;
        vComb = comb;
        vFur = _fur;
        #ifdef USE_SKINNING
          comb = normalize((skinMatrix * vec4(comb, 0.0)).xyz);
        #endif
        // Each strand leaves the skin at a shallow angle and bends over to lie along the comb; long fur lies flatter
        // and hangs under its own weight. (A negative _fur is bare skin: the mouth, the tongue.)
        float len = max(_fur, 0.0);
        float strand = uLen * (0.03 + len) * step(0.0, _fur);
        float h = uShell;
        float lift = mix(${glsl(LIFT[0])}, ${glsl(LIFT[1])}, len);
        transformed += normalize(objectNormal) * strand * lift * h * (2.0 - h);
        transformed += comb * strand * (1.0 - lift) * h * (0.35 + 0.65 * h);
        transformed.y -= strand * h * h * (0.1 + ${glsl(DROOP)} * len * len);`
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uShell;
        varying vec3 vRest;
        varying vec3 vRestN;
        varying vec3 vComb;
        varying float vFur;
        float furHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float tone = 1.0;
        if (vFur < 0.0) {
          if (uShell > 0.0) discard;
        } else {
          // Strands in locks: cells drawn out along the comb, each strand a thin streak across its cell, most of them
          // the full length (a flat coat), thinning to a point at the tip.
          vec3 c = normalize(vComb);
          vec3 q = (vRest - c * dot(vRest, c) * ${glsl(1 - 1 / STRETCH)}) * ${glsl(CELL)};
          vec3 cell = floor(q);
          float r = furHash(cell);
          float r2 = furHash(cell + 17.3);
          if (uShell > 0.0) {
            // (the long feathering keeps more of its strands to full length, and its locks stay full until near the tip)
            float reach = 1.0 - ${glsl(SHORT)} * (1.0 - 0.6 * vFur) * r * r;
            if (uShell > reach) discard;
            vec3 b = normalize(cross(normalize(vRestN), c));
            float across = abs(dot(fract(q) - 0.5 - (r2 - 0.5) * 0.3, b));
            float h = uShell / reach;
            if (across > mix(0.36 * (1.0 - 0.8 * h), 0.44 * (1.0 - 0.75 * h * h), vFur)) discard;
          }
          // Darker at the roots, sunlit toward the tips (the long feathering most), each lock its own shade.
          tone = mix(0.62, 1.0, sqrt(uShell)) * (0.92 + 0.16 * r2) * (1.0 + 0.22 * uShell * uShell * vFur);
        }
        diffuseColor.rgb *= tone;`
      );
  };
  m.customProgramCacheKey = () => 'dog-fur';
  return m;
}

export function Dog() {
  const { scene, animations } = useGLTF(URL, DRACO_PATH);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);

  // Swap the coat for fur and grow the shells over the same skeleton.
  const shells = useMemo(() => {
    const made: SkinnedMesh[] = [];
    let coat: SkinnedMesh | undefined;
    scene.traverse((o: Object3D) => {
      if ((o as SkinnedMesh).isSkinnedMesh && ((o as SkinnedMesh).material as Material).name === 'DogCoat') coat = o as SkinnedMesh;
    });
    if (!coat) return made;
    coat.material = furMaterial(0);
    for (let i = 1; i <= SHELLS; i++) {
      const shell = new SkinnedMesh(coat.geometry, furMaterial(i));
      shell.bind(coat.skeleton, coat.bindMatrix);
      shell.position.copy(coat.position);
      shell.quaternion.copy(coat.quaternion);
      shell.scale.copy(coat.scale);
      shell.frustumCulled = false;
      coat.parent?.add(shell);
      made.push(shell);
    }
    coat.frustumCulled = false;
    return made;
  }, [scene]);

  // The clips (Walk, Sniff, Idle); until the model has them all, standing still stands in for the missing ones.
  const actions = useMemo(() => {
    const walk = animations.find((a) => a.name === 'Walk') ?? animations[0];
    const get = (name: string) => {
      const clip = animations.find((a) => a.name === name);
      if (clip) return mixer.clipAction(clip);
      const still = mixer.clipAction(walk.clone());
      still.timeScale = 0;
      return still;
    };
    return { Walk: mixer.clipAction(walk), Sniff: get('Sniff'), Idle: get('Idle') };
  }, [animations, mixer]);

  useEffect(() => {
    actions.Walk.play();
    return () => {
      mixer.stopAllAction();
      for (const s of shells) s.removeFromParent();
    };
  }, [actions, mixer, shells]);

  // Where it is in its routine.
  const routine = useRef({
    step: 0,
    until: 0,
    clock: 0,
    playing: 'Walk' as keyof typeof actions,
    at: new Vector3(SPOTS.mid[0], WATER_Y - SINK, SPOTS.mid[1]),
    heading: Math.PI / 2,
  });
  const play = (name: keyof typeof actions) => {
    const st = routine.current;
    if (st.playing === name) return;
    actions[name].reset().play();
    actions[st.playing].crossFadeTo(actions[name], FADE, false);
    st.playing = name;
  };

  const rings = useRef<Group>(null);
  const ringParts = useMemo(() => {
    const geometry = new RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
    return Array.from({ length: RINGS }, () => ({
      material: new MeshBasicMaterial({ color: '#fff6ee', transparent: true, opacity: 0, depthWrite: false }),
      geometry,
      born: -1e9,
      at: new Vector3(),
    }));
  }, []);
  const nextRing = useRef(0);
  // Churned water round its legs, where they go in: a soft pale patch on the surface under the dog, turned with it.
  const foam = useRef<Mesh>(null);
  const foamMaterial = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,248,240,0.85)');
    grad.addColorStop(0.55, 'rgba(255,248,240,0.45)');
    grad.addColorStop(1, 'rgba(255,248,240,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false });
  }, []);

  useFrame((state, delta) => {
    const shown = landingAt(journey.frame) > 0.001 && !devFlag('nodog');
    scene.visible = shown;
    if (rings.current) rings.current.visible = shown;
    if (foam.current) foam.current.visible = shown;
    if (!shown) return;
    const dt = Math.min(delta, 0.1);
    mixer.update(dt);
    const st = routine.current;
    st.clock += dt;
    const step = ROUTINE[st.step];
    let walking = false;
    if ('to' in step) {
      // Walk toward the spot, turning gradually; on to the next step once there.
      const [x, z] = SPOTS[step.to];
      const dx = x - st.at.x;
      const dz = z - st.at.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.35) {
        st.step = (st.step + 1) % ROUTINE.length;
      } else {
        walking = true;
        play('Walk');
        const want = Math.atan2(-dz, dx);
        let turn = Math.atan2(Math.sin(want - st.heading), Math.cos(want - st.heading));
        turn = Math.max(-TURN * dt, Math.min(TURN * dt, turn));
        st.heading += turn;
        // Slower while turning round, as a dog does.
        const pace = SPEED * (0.55 + 0.45 * Math.max(0, Math.cos(want - st.heading)));
        st.at.x += Math.cos(st.heading) * pace * dt;
        st.at.z -= Math.sin(st.heading) * pace * dt;
      }
    } else {
      if (st.until === 0) st.until = st.clock + step.for[0] + Math.random() * (step.for[1] - step.for[0]);
      play(step.do);
      if (st.clock >= st.until) {
        st.until = 0;
        st.step = (st.step + 1) % ROUTINE.length;
      }
    }
    scene.position.copy(st.at);
    scene.rotation.y = st.heading;
    if (foam.current) {
      foam.current.position.set(scene.position.x, WATER_Y + 0.005, scene.position.z);
      foam.current.rotation.y = scene.rotation.y;
      foam.current.scale.set(1.05 * SCALE * (1 + 0.04 * Math.sin(state.clock.elapsedTime * 7)), 1, 0.42 * SCALE);
    }
    // Ripples: a new ring at its chest every half stride, each spreading and fading where it was made.
    const t = state.clock.elapsedTime;
    if (walking && t >= nextRing.current) {
      nextRing.current = t + RING_EVERY;
      const r = ringParts.reduce((oldest, p) => (p.born < oldest.born ? p : oldest));
      r.born = t;
      r.at.set(scene.position.x, WATER_Y + 0.01, scene.position.z);
    }
    rings.current?.children.forEach((child, i) => {
      const r = ringParts[i];
      const age = (t - r.born) / RING_LIFE;
      const ring = child as Mesh;
      ring.position.copy(r.at);
      ring.scale.setScalar(0.35 + 1.4 * Math.sqrt(Math.max(age, 0)));
      r.material.opacity = age < 0 || age > 1 ? 0 : 0.6 * (1 - age) * Math.min(1, age * 12);
    });
  });

  return (
    <>
      <primitive object={scene} scale={SCALE} />
      <mesh ref={foam} material={foamMaterial} renderOrder={2}>
        <planeGeometry args={[1, 1]} onUpdate={(g) => g.rotateX(-Math.PI / 2)} />
      </mesh>
      <group ref={rings}>
        {ringParts.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pool
          <mesh key={i} geometry={r.geometry} material={r.material} renderOrder={2} />
        ))}
      </group>
    </>
  );
}

useGLTF.preload(URL, DRACO_PATH);

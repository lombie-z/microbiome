import type { MeshStandardMaterial } from 'three';

// Detail for the landing's canyon (art/build-landing.py), drawn per pixel so the low-poly cliffs read like the reference's
// rock: vertical fractures, horizontal strata, colour drifting through peach, rose and cream, a bump from the same height
// field so the low sun rakes across it, and moss creeping onto the ledges. The mesh's vertex colour stays the base.
const NOISE = /* glsl */ `
float rHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float rNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(rHash(i), rHash(i + vec3(1, 0, 0)), u.x), mix(rHash(i + vec3(0, 1, 0)), rHash(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(rHash(i + vec3(0, 0, 1)), rHash(i + vec3(1, 0, 1)), u.x), mix(rHash(i + vec3(0, 1, 1)), rHash(i + vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
float rFbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * rNoise(p); p = p * 2.1 + 3.7; a *= 0.5; }
  return v;
}
// Rock height: tall fracture columns (noise stretched up the face), strata bands, and fine grain.
float rockHeight(vec3 p) {
  float fractures = 1.0 - abs(rNoise(vec3(p.x * 1.8, p.y * 0.22, p.z * 1.8)) * 2.0 - 1.0);
  fractures = pow(fractures, 6.0);
  float strata = sin(p.y * 5.0 + rNoise(p * 0.6) * 4.0) * 0.5 + 0.5;
  return rFbm(p * 2.4) * 0.6 + strata * 0.25 - fractures * 0.7;
}
`;

export function rockMaterial(source: MeshStandardMaterial) {
  const material = source.clone();
  material.roughness = 0.9;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;\nvarying vec3 vRockNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRockNormal = normalize(mat3(modelMatrix) * objectNormal);'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRockPos;\nvarying vec3 vRockNormal;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 p = vRockPos;
  float h = rockHeight(p);
  float steep = 1.0 - abs(vRockNormal.y);
  // Colour drift through peach, rose and cream, darker down in the fractures.
  float hue = rFbm(p * 0.35 + 7.0);
  // Pinker and creamier than the base, less orange (as the reference's rock).
  vec3 tint = mix(vec3(1.02, 0.88, 0.92), vec3(1.06, 0.98, 0.92), smoothstep(0.35, 0.65, hue));
  tint = mix(tint, vec3(0.94, 0.8, 0.9), smoothstep(0.55, 0.8, rFbm(p * 1.1 + 2.0)) * 0.6);
  diffuseColor.rgb *= tint * mix(0.62, 1.08, smoothstep(-0.4, 0.5, h));
  // Paler and less orange than the vertex colours: the reference's rock is a sunlit pink-cream.
  float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(vec3(luma), diffuseColor.rgb, 0.62) * vec3(1.08, 1.0, 1.02) + 0.04;
  // Moss and small plants on ledges and the gentler slopes, in patches, and hanging down the faces in streaks.
  float ledge = smoothstep(0.55, 0.85, vRockNormal.y) * smoothstep(0.35, 0.6, rFbm(p * 1.6 + 11.0));
  float hanging = steep * smoothstep(0.58, 0.72, rFbm(vec3(p.x * 0.9, p.y * 0.35, p.z * 0.9) + 31.0));
  ledge = max(ledge, hanging * 0.9);
  vec3 moss = mix(vec3(0.2, 0.32, 0.12), vec3(0.42, 0.5, 0.2), rNoise(p * 6.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, moss, ledge * 0.85 * step(-10.7, p.y));
}`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // Bump from the rock height (screen-space derivatives, as three's bump map does), strongest on steep faces.
  float h = rockHeight(vRockPos) * mix(0.15, 0.6, 1.0 - abs(vRockNormal.y));
  vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
  float dhdx = dFdx(h), dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  normal = normalize(abs(det) * normal - grad);
  // Crisp facets: lean toward the face's true (flat) normal, so the blocks' planes and edges read as rock, not clay.
  vec3 facet = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
  if (dot(facet, normal) < 0.0) facet = -facet;
  normal = normalize(mix(normal, facet, 0.55 * (1.0 - abs(vRockNormal.y))));
}`
      );
  };
  material.customProgramCacheKey = () => 'canyon-rock';
  return material;
}

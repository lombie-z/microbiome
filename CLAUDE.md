@AGENTS.md

# Microbiome

A scroll journey into the clay micro biome from the blog (../blog). Next 16, React 19, react-three-fiber 9, drei 10, three 0.186, Tailwind 4, Lenis, Biome. No CMS: copy lives in the code.

`pnpm dev --port 3003` (or the "microbiome" launch config), `pnpm lint`, `pnpm build`.

## File map

```
app/layout.tsx                    # Fonts (Instrument Sans, Newsreader), Lenis, metadata
app/page.tsx                      # Scroll track and the DOM beats over the canvas
app/globals.css                   # Plaster tokens (same as the blog)
components/journey.tsx            # Hero still + lazy canvas
components/smooth-scroll.tsx      # Lenis root (off for reduced motion)
components/three/journey-canvas.tsx  # The one fixed canvas; renders last (priority 1)
components/three/biome.tsx        # Biome glb, hero camera, idle animation
components/three/silhouette-outline.tsx, studio-environment.tsx  # Copied from the blog
lib/journey.ts                    # Scroll progress, hero stage size
art/                              # Blender sources and export scripts
public/models/                    # Draco glb; decoder in public/draco/
public/images/3d/                 # Blender stills (fallbacks)
```

## 3D

One fixed, pointer-transparent canvas behind the page. Scroll progress (lib/journey.ts) drives the camera each frame. The hero must match the blog's biome section: same model, lighting, sticker outline and framing (3.7 units across the stage).

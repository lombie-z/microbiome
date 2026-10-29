"""The landing: a pink rock canyon round a still lake, where the big fall comes down out of the sky in front of the cliffs.
Replaces the giant clay planter (art/build-macro.py): the clay biome stays a toy floating far above, and below it is
the real world. Re-runnable (rebuilds everything named Landing.*, and the lake as Pool).
Run inside Blender with art/micro-biome.blend open, after build-spill.py:
    exec(open('<repo>/art/build-landing.py').read())

World layout (Blender, z up): the falls land at the origin on the lake (z -11). The camera lands at eye level to the
west (-x), looking east at the fall; the cliffs wrap round the far side, tallest behind the fall and to the right
(south), lower to the left (north) with a gap toward the low sun and distant mountains.
"""
import math
import random

import bmesh
import bpy
from mathutils import Color, Vector, noise

scene = bpy.context.scene
root = bpy.data.objects['MicroBiome']
LAKE_Z = -11.0
LAKE_CENTRE = Vector((-5.0, 0.0))
rnd = random.Random(8)

# Clear the giant planter copy and its garden, and any earlier landing.
for name in [o.name for o in bpy.data.objects if o.name.startswith(('Macro.', 'Garden.', 'Landing.')) or o.name in ('Macro', 'Pool')]:
    if name in bpy.data.objects:
        o = bpy.data.objects[name]
        for c in list(o.children_recursive):
            bpy.data.objects.remove(c)
        bpy.data.objects.remove(o)


def link(name, me, parent=None):
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    o.parent = parent or root
    return o


def material(name, roughness=0.85):
    """Vertex-coloured, matte: the colour lives in the 'Col' attribute."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = roughness
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# --- Canyon terrain ---------------------------------------------------------------------------------------------------


def shore_radius(theta):
    """Distance from the lake centre to the foot of the cliffs, by direction (theta 0 = east, behind the fall)."""
    # 7.6 behind the fall, opening out westward into a long lake the camera looks up from far down.
    base = 7.6 + 22 * ((1 - math.cos(theta)) * 0.5) ** 1.6
    base += 2.5 * max(0.0, math.sin(theta)) - 0.5 * max(0.0, -math.sin(theta))  # roomier to the north, tighter south
    return base + noise.noise(Vector((math.cos(theta) * 2, math.sin(theta) * 2, 3.3))) * 0.9


def cliff_height(theta):
    """How high the cliffs rise above the lake, by direction."""
    behind = math.exp(-((theta / 0.7) ** 2))
    south = math.exp(-(((theta + 1.2) / 0.9) ** 2))
    north = math.exp(-(((theta - 1.6) / 0.9) ** 2))
    gap = math.exp(-(((theta - 0.62) / 0.3) ** 2))  # a low saddle toward the sun and the mountains
    h = 2.5 + 10.5 * behind + 8.5 * south + 4.0 * north
    # Pinnacles along the skyline.
    h += max(0.0, noise.noise(Vector((math.cos(theta) * 6, math.sin(theta) * 6, 9.1)))) * 3.5 * (behind + south + north)
    return h * (1 - 0.8 * gap)


def fbm(p, octaves=4):
    total, amp, freq = 0.0, 1.0, 1.0
    for _ in range(octaves):
        total += noise.noise(p * freq) * amp
        amp *= 0.5
        freq *= 2.1
    return total


def height(x, y):
    d = Vector((x, y)) - LAKE_CENTRE
    theta = math.atan2(d.y, d.x)
    beyond = d.length - shore_radius(theta)
    if beyond < 0:
        return LAKE_Z - 0.6 - 0.02 * min(-beyond, 10)  # lake bed
    rise = cliff_height(theta)
    # A steep wall in a few terraces, levelling into a rolling top.
    t = 1 - math.exp(-beyond / 0.9)
    h = rise * t
    step = 1.8
    terraced = math.floor(h / step) * step + step * smoothstep(0.55, 1.0, (h / step) % 1.0)
    h = 0.55 * h + 0.45 * terraced
    h += fbm(Vector((x * 0.08, y * 0.08, 1.7)), 3) * 1.4 * t + max(0.0, beyond - 4) * 0.08
    return LAKE_Z - 0.15 + h


SIZE, N = 84.0, 230
step = SIZE / N
bm = bmesh.new()
grid = []
for i in range(N + 1):
    row = []
    for j in range(N + 1):
        x = -SIZE / 2 + i * step - 2
        y = -SIZE / 2 + j * step
        row.append(bm.verts.new((x, y, height(x, y))))
    grid.append(row)
for i in range(N):
    for j in range(N):
        bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
bm.normal_update()
# Rock: push the steep faces in and out along their normals (heights alone can't make a craggy wall): tall vertical
# columns and fractures (noise stretched up the face), horizontal strata, and finer crags on top.
for v in bm.verts:
    steep = 1 - abs(v.normal.z)
    if steep > 0.2:
        p = v.co
        columns = noise.noise(Vector((p.x * 0.7, p.y * 0.7, p.z * 0.12))) * 1.1
        fractures = -abs(noise.noise(Vector((p.x * 1.6, p.y * 1.6, p.z * 0.25)))) * 0.7
        strata = noise.noise(Vector((p.x * 0.1, p.y * 0.1, p.z * 1.4))) * 0.35
        crags = fbm(p * 0.9, 3) * 0.3
        v.co += v.normal * (columns + fractures + strata + crags) * smoothstep(0.2, 0.6, steep)
bm.normal_update()

# Colour: pink rock, peachy where the light catches the upper faces, darker in the cracks; green on ledges and tops;
# pale sand at the waterline.
col = bm.loops.layers.color.new('Col')
ROCK = Color((0.86, 0.55, 0.5))
ROCK_LIGHT = Color((0.97, 0.76, 0.63))
ROCK_DARK = Color((0.6, 0.36, 0.37))
GRASS = Color((0.36, 0.52, 0.26))
GRASS_DARK = Color((0.22, 0.38, 0.2))
SAND = Color((0.92, 0.8, 0.68))


def mix(a, b, t):
    return Color((a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t))


for f in bm.faces:
    for loop in f.loops:
        v = loop.vert
        above = v.co.z - LAKE_Z
        n = noise.noise(v.co * 0.5)
        c = mix(ROCK, ROCK_LIGHT, smoothstep(1, 9, above) * 0.7 + 0.2 * n)
        c = mix(c, ROCK_DARK, smoothstep(0.1, 0.6, -n) * 0.6)
        flat = smoothstep(0.72, 0.9, v.normal.z)
        if above > 0.4:
            c = mix(c, mix(GRASS, GRASS_DARK, 0.5 + 0.5 * noise.noise(v.co * 0.9)), flat * 0.85)
        c = mix(c, SAND, smoothstep(0.5, 0.0, abs(above - 0.1)) * 0.8)
        loop[col] = (c.r, c.g, c.b, 1.0)

me = bpy.data.meshes.new('Landing.Canyon')
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True
me.materials.append(material('Canyon'))
canyon = link('Landing.Canyon', me)

# --- Greenery on the ledges and tops ----------------------------------------------------------------------------------

dg = bpy.context.evaluated_depsgraph_get()
spots = [(v.co.copy(), v.normal.copy()) for v in me.vertices if v.normal.z > 0.6 and v.co.z > LAKE_Z + 0.6]
rnd.shuffle(spots)


def blob_cluster(bm, centre, radius, colour, col_layer, parts=4, squash=0.8):
    for _ in range(parts):
        r = radius * rnd.uniform(0.55, 1.0)
        off = Vector((rnd.gauss(0, radius * 0.5), rnd.gauss(0, radius * 0.5), rnd.uniform(0, radius * 0.6)))
        geom = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
        for v in geom['verts']:
            v.co.z *= squash
            v.co += v.co.normalized() * noise.noise(v.co * 3 + centre) * r * 0.18
            v.co += centre + off
        shade = rnd.uniform(0.85, 1.1)
        for f in {f for v in geom['verts'] for f in v.link_faces}:
            for loop in f.loops:
                loop[col_layer] = (colour.r * shade, colour.g * shade, colour.b * shade, 1.0)


bm = bmesh.new()
col = bm.loops.layers.color.new('Col')
SHRUB = Color((0.27, 0.45, 0.22))
for co, n in spots[:700]:
    blob_cluster(bm, co, rnd.uniform(0.15, 0.45), SHRUB if rnd.random() < 0.75 else Color((0.4, 0.55, 0.28)), col, parts=rnd.randint(2, 4))
me = bpy.data.meshes.new('Landing.Shrubs')
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True
me.materials.append(material('Shrubs'))
link('Landing.Shrubs', me)

# Blossom: low flowering bushes scattered over the slopes and ledges (not lollipop trees), thickest near the lake.
bm = bmesh.new()
col = bm.loops.layers.color.new('Col')
BLOSSOM = Color((0.97, 0.66, 0.74))
BLOSSOM_DEEP = Color((0.9, 0.5, 0.62))
bushes = 0
for co, n in spots[700:]:
    d = (co.xy - LAKE_CENTRE).length
    if d > 30 or bushes >= 220:
        continue
    blob_cluster(bm, co + Vector((0, 0, 0.1)), rnd.uniform(0.2, 0.5), BLOSSOM if rnd.random() < 0.6 else BLOSSOM_DEEP, col, parts=rnd.randint(3, 5), squash=0.7)
    bushes += 1
me = bpy.data.meshes.new('Landing.Blossom')
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True
me.materials.append(material('Blossom'))
link('Landing.Blossom', me)

# --- Distant mountains ------------------------------------------------------------------------------------------------

# A ring of soft ridges far out, highest toward the sun, that the haze turns into layered silhouettes.
bm = bmesh.new()
col = bm.loops.layers.color.new('Col')
FAR = Color((0.78, 0.6, 0.62))
for layer, (radius, top) in enumerate(((70, 9), (95, 15))):
    segs = 160
    rows = []
    for k in range(segs + 1):
        a = 2 * math.pi * k / segs
        toward_sun = max(0.0, math.cos(a - math.radians(27)))
        ridge = top * (0.35 + 0.65 * toward_sun) * (0.6 + 0.4 * (fbm(Vector((math.cos(a) * 3, math.sin(a) * 3, layer * 5.0)), 4) + 0.5))
        r = radius + layer * 4
        base = Vector((math.cos(a) * r, math.sin(a) * r, LAKE_Z - 2))
        rows.append((bm.verts.new(base), bm.verts.new(base + Vector((0, 0, max(ridge, 1.0) + 2)))))
    for k in range(segs):
        f = bm.faces.new((rows[k][0], rows[k + 1][0], rows[k + 1][1], rows[k][1]))
        for loop in f.loops:
            loop[col] = (FAR.r, FAR.g, FAR.b, 1.0)
me = bpy.data.meshes.new('Landing.Mountains')
bm.to_mesh(me)
bm.free()
me.materials.append(material('Mountains', 1.0))
link('Landing.Mountains', me)

# --- The lake ---------------------------------------------------------------------------------------------------------

bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=True, segments=128, radius=24)
bmesh.ops.triangulate(bm, faces=bm.faces)
bmesh.ops.translate(bm, vec=(LAKE_CENTRE.x, LAKE_CENTRE.y, LAKE_Z), verts=bm.verts)
me = bpy.data.meshes.new('Pool')
bm.to_mesh(me)
bm.free()
me.materials.append(bpy.data.materials['Water'])
link('Pool', me)

# --- Foreground garden ------------------------------------------------------------------------------------------------
# Laid out from the reference image (art/reference/landing-pov): each piece is placed by its pixel position in that
# 1536x1024 frame, cast back from the landing camera (JourneyCam at frame 770, art/build-journey.py) onto the water.

scene.frame_set(770)
VIEW = bpy.data.objects['JourneyCam'].matrix_world.copy()
EYE = VIEW.translation.copy()
FORWARD = (VIEW.to_3x3() @ Vector((0, 0, -1))).normalized()
FOV = math.radians(38.0)
REF_W, REF_H = 1536, 1024


def ray(px, py):
    t = math.tan(FOV / 2)
    return (VIEW.to_3x3() @ Vector(((px / REF_W * 2 - 1) * t * REF_W / REF_H, (1 - py / REF_H * 2) * t, -1))).normalized()


def at(px, py, z=LAKE_Z):
    """The point on the plane at height z seen at pixel (px, py) of the reference."""
    d = ray(px, py)
    return EYE + d * ((z - EYE.z) / d.z)


def px_size(point, pixels):
    """How many metres `pixels` spans at `point`'s depth."""
    depth = (point - EYE).dot(FORWARD)
    return pixels * 2 * depth * math.tan(FOV / 2) / REF_H


def height_at(base, py):
    """How high above `base` a point must stand to appear at row py (for the reeds' tips and the cattail heads)."""
    lo, hi = 0.0, 6.0
    for _ in range(40):
        mid = (lo + hi) / 2
        p = base + Vector((0, 0, mid))
        v = VIEW.inverted() @ p
        row = (1 - (v.y / -v.z) / math.tan(FOV / 2)) * REF_H / 2
        lo, hi = (mid, hi) if row > py else (lo, mid)
    return lo


def rotate_z(v, a):
    c, s = math.cos(a), math.sin(a)
    return Vector((v.x * c - v.y * s, v.x * s + v.y * c, v.z))


def colour_faces(bm, geom_verts, layer, colour_fn):
    for f in {f for v in geom_verts for f in v.link_faces}:
        for loop in f.loops:
            c = colour_fn(loop.vert.co)
            loop[layer] = (c.r, c.g, c.b, 1.0)


def finish(name, bm, mat, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(mat)
    return link(name, me)


# Lily pads: broad, notched, the rim lifting a little; yellow-green where the low sun comes through, a gold rim.
PAD = Color((0.16, 0.33, 0.05))
PAD_LIT = Color((0.42, 0.56, 0.12))
PAD_VEIN = Color((0.55, 0.66, 0.24))
PAD_EDGE = Color((0.78, 0.55, 0.14))
# (px, py, half-width in px) in the reference.
PADS = [(520, 852, 330), (130, 765, 130), (150, 722, 95), (385, 722, 115), (80, 838, 120), (300, 674, 135), (430, 646, 60),
        (545, 641, 40), (205, 652, 55), (1150, 738, 95), (1235, 746, 55), (1245, 653, 40), (90, 965, 210), (330, 925, 110),
        (640, 650, 45), (40, 700, 60)]
bm = bmesh.new()
col = bm.loops.layers.color.new('Col')
pad_centres = []
for k, (px, py, half) in enumerate(PADS):
    centre = at(px, py) + Vector((0, 0, 0.012))
    r = px_size(centre, half)
    spin = rnd.uniform(0, 6.28)
    pad_centres.append((centre, r))
    # Concentric rings of quads round a centre vertex, so the rim can curl up and carry its gold edge; the notch is a
    # wedge pinched in to the centre.
    SEGS, RINGS = 72, 7
    hub = bm.verts.new((0, 0, 0))
    rings = []
    for k in range(1, RINGS + 1):
        rr = (k / RINGS) ** 0.8
        ring = []
        for j in range(SEGS):
            a = 2 * math.pi * j / SEGS
            notch = smoothstep(0.2, 0.08, min(a, 2 * math.pi - a))
            ring.append(bm.verts.new((math.cos(a) * rr * (1 - 0.94 * notch), math.sin(a) * rr * (1 - 0.94 * notch), 0)))
        rings.append(ring)
    for j in range(SEGS):
        bm.faces.new((hub, rings[0][j], rings[0][(j + 1) % SEGS]))
        for k in range(RINGS - 1):
            bm.faces.new((rings[k][j], rings[k + 1][j], rings[k + 1][(j + 1) % SEGS], rings[k][(j + 1) % SEGS]))
    verts = [hub] + [v for ring in rings for v in ring]
    for v in verts:
        d = v.co.xy.length
        v.co.z = smoothstep(0.82, 1.0, d) * 0.05 + noise.noise(v.co * 2.5 + centre) * 0.025
        v.co = rotate_z(v.co * r, spin) + centre

    def pad_colour(co, centre=centre, r=r, spin=spin):
        d = (co - centre).xy
        t = d.length / r
        vein = abs(math.sin(math.atan2(d.y, d.x) * 11 - spin * 11)) ** 30
        lit = smoothstep(-0.3, 0.6, noise.noise(co * 1.7 + centre)) * 0.6 + 0.4 * smoothstep(0.3, 1.0, -d.y / r)
        c = mix(PAD, PAD_LIT, lit)
        c = mix(c, PAD_VEIN, vein * 0.6 * smoothstep(0.1, 0.4, t))
        return mix(c, PAD_EDGE, smoothstep(0.88, 1.0, t) * 0.85)

    colour_faces(bm, verts, col, pad_colour)
finish('Landing.Pads', bm, material('Pad', 0.4))

# Water lilies: pointed petals in three rings, white flushing pink, cupped up round a yellow heart.
PETAL = Color((0.99, 0.95, 0.95))
PETAL_TIP = Color((0.97, 0.66, 0.78))
HEART = Color((1.0, 0.78, 0.25))
bm = bmesh.new()
col = bm.loops.layers.color.new('Col')
for px, py, half in ((85, 690, 70), (365, 637, 22), (462, 641, 20), (528, 637, 16), (700, 645, 14)):
    centre = at(px, py) + Vector((0, 0, 0.02))
    size = px_size(centre, half)
    for ring, (count, length, tilt) in enumerate(((10, 1.0, 0.35), (9, 0.85, 0.8), (7, 0.65, 1.2))):
        for k in range(count):
            a = 2 * math.pi * (k + 0.5 * ring) / count + rnd.uniform(-0.1, 0.1)
            L = length * size * rnd.uniform(0.9, 1.05)
            geom = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1)
            for v in geom['verts']:
                # A pointed, cupped petal: long, narrow at the tip, curling up at its edges.
                x = v.co.x * 0.5 + 0.5
                w = math.sin(math.pi * min(x, 0.999) ** 0.8) * 0.2
                local = Vector((x * L, v.co.y * L * w, v.co.z * L * 0.03 + (v.co.y * w) ** 2 * L * 1.2))
                c, s = math.cos(tilt), math.sin(tilt)
                local = Vector((local.x * c - local.z * s, local.y, local.x * s + local.z * c))
                v.co = rotate_z(local, a) + centre
            colour_faces(bm, geom['verts'], col, lambda co, c=centre, L=L: mix(PETAL, PETAL_TIP, smoothstep(0.55, 1.0, (co - c).length / L) * 0.8))
    geom = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=size * 0.18)
    for v in geom['verts']:
        v.co.z *= 0.7
        v.co += centre + Vector((0, 0, size * 0.15))
    colour_faces(bm, geom['verts'], col, lambda co: HEART)
finish('Landing.Lilies', bm, material('Lily', 0.5))

# The frog: one smooth body, sitting up on the big pad side-on, looking right toward the fall. Built as a skeleton of
# tapering limbs (chains of spheres), fused into one skin by a voxel remesh and smoothed so the joins flow.
FROG_BACK = Color((0.36, 0.33, 0.14))
FROG_SIDE = Color((0.56, 0.5, 0.26))
FROG_SPOT = Color((0.2, 0.18, 0.08))
FROG_BELLY = Color((0.9, 0.84, 0.62))
FROG_BASE = at(530, 828) + Vector((0, 0, 0.018))
FROG_FACING = math.radians(-62)  # nose toward the fall, a little away from the camera
FROG_SIZE = px_size(FROG_BASE, 170) / 0.36  # the reference's frog is about 170 px long; the model is 0.36 m

# (start, start radius, end, end radius) in the frog's frame: x forward (nose), y left, z up.
FROG_LIMBS = [
    ((-0.11, 0, 0.065), 0.07, (0.03, 0, 0.115), 0.085),  # body, rising to the shoulders
    ((-0.06, 0, 0.05), 0.06, (0.05, 0, 0.07), 0.065),  # belly
    ((0.03, 0, 0.115), 0.085, (0.11, 0, 0.152), 0.066),  # shoulders into the head
    ((0.11, 0, 0.152), 0.066, (0.185, 0, 0.142), 0.034),  # the broad head narrowing to the snout
    ((0.1, 0, 0.115), 0.06, (0.16, 0, 0.118), 0.035),  # throat and jaw
]
for side in (-1, 1):
    FROG_LIMBS += [
        ((0.115, 0.045 * side, 0.185), 0.032, (0.125, 0.05 * side, 0.195), 0.03),  # eye bulge
        ((-0.1, 0.055 * side, 0.06), 0.05, (0.0, 0.095 * side, 0.065), 0.034),  # thigh, forward to the knee
        ((0.0, 0.095 * side, 0.065), 0.032, (-0.075, 0.105 * side, 0.025), 0.022),  # shin, back to the ankle
        ((-0.075, 0.105 * side, 0.02), 0.02, (0.03, 0.14 * side, 0.01), 0.011),  # long hind foot, splayed forward
        ((0.03, 0.14 * side, 0.01), 0.011, (0.06, 0.16 * side, 0.008), 0.007),  # toes
        ((0.1, 0.05 * side, 0.105), 0.026, (0.15, 0.06 * side, 0.015), 0.017),  # front leg
        ((0.15, 0.06 * side, 0.012), 0.016, (0.185, 0.075 * side, 0.008), 0.008),  # hand
    ]
bm = bmesh.new()
for a, ra, b, rb in FROG_LIMBS:
    a, b = Vector(a), Vector(b)
    steps = max(2, int((b - a).length / (min(ra, rb) * 0.35)) + 1)
    for k in range(steps + 1):
        t = k / steps
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=ra + (rb - ra) * t,
                                  matrix=__import__('mathutils').Matrix.Translation(a.lerp(b, t)))
me = bpy.data.meshes.new('FrogParts')
bm.to_mesh(me)
bm.free()
parts = bpy.data.objects.new('FrogParts', me)
scene.collection.objects.link(parts)
remesh = parts.modifiers.new('Remesh', 'REMESH')
remesh.mode = 'VOXEL'
remesh.voxel_size = 0.004
smooth = parts.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH')
smooth.iterations = 12
smooth.use_only_smooth = True
smooth.smooth_type = 'LENGTH_WEIGHTED'
bpy.context.view_layer.update()
frog_me = bpy.data.meshes.new_from_object(parts.evaluated_get(bpy.context.evaluated_depsgraph_get()))
bpy.data.objects.remove(parts)
bpy.data.meshes.remove(me)

bm = bmesh.new()
bm.from_mesh(frog_me)
bpy.data.meshes.remove(frog_me)
col = bm.loops.layers.color.new('Col')


def frog_colour(co):
    # co is in the frog's local frame (before placing it).
    belly = smoothstep(0.1, 0.03, co.z - 0.25 * max(co.x, 0)) * smoothstep(0.03, 0.0, abs(co.y) - 0.05)
    throat = smoothstep(0.03, -0.01, co.z - 0.1 - 0.4 * (co.x - 0.12)) * smoothstep(0.08, 0.16, co.x)
    top = smoothstep(0.03, 0.08, abs(co.y)) * 0.0 + smoothstep(0.06, 0.16, co.z)
    c = mix(FROG_SIDE, FROG_BACK, top * 0.8)
    spots = smoothstep(0.25, 0.45, noise.noise(co * 32 + Vector((3, 1, 7))))
    c = mix(c, FROG_SPOT, spots * 0.75 * smoothstep(0.03, 0.1, co.z))
    # The dark band from the eye back over the eardrum, and a pale lip line.
    band = smoothstep(0.02, 0.0, abs(co.z - 0.165 + 0.3 * (co.x - 0.1))) * smoothstep(0.0, 0.05, 0.16 - abs(co.x - 0.05)) * smoothstep(0.04, 0.07, abs(co.y))
    c = mix(c, FROG_SPOT, band * 0.6)
    return mix(c, FROG_BELLY, max(belly, throat) * 0.85)


for f in bm.faces:
    for loop in f.loops:
        c = frog_colour(loop.vert.co)
        loop[col] = (c.r, c.g, c.b, 1.0)
for v in bm.verts:
    v.co = rotate_z(v.co * FROG_SIZE, FROG_FACING) + FROG_BASE
finish('Landing.Frog', bm, material('Frog', 0.3))

# Its eyes: gold, glossy, with a black horizontal pupil looking out to the side.
EYE_GOLD = Color((0.95, 0.66, 0.18))
EYE_RIM = Color((0.35, 0.22, 0.06))
PUPIL = Color((0.02, 0.015, 0.01))
bm = bmesh.new()
col = bm.loops.layers.color.new('Col')
for side in (-1, 1):
    centre_local = Vector((0.124, 0.054 * side, 0.2))
    r = 0.026
    geom = bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=1)
    out = Vector((0.35, side * 1.0, 0.25)).normalized()
    for v in geom['verts']:
        n = v.co.normalized()
        facing = n.dot(out)
        v.co = rotate_z((centre_local + n * r) * FROG_SIZE, FROG_FACING) + FROG_BASE
        v.normal = n
    for f in {f for v in geom['verts'] for f in v.link_faces}:
        for loop in f.loops:
            n = rotate_z(loop.vert.co - FROG_BASE, -FROG_FACING) / FROG_SIZE - centre_local
            n.normalize()
            facing = n.dot(out)
            # The pupil: a horizontal slot round the outward axis.
            up = Vector((0, 0, 1))
            vert = abs(n.dot(up) - out.dot(up) * facing)
            pupil = smoothstep(0.86, 0.9, facing) * smoothstep(0.2, 0.12, vert) + smoothstep(0.94, 0.97, facing)
            c = mix(EYE_GOLD, EYE_RIM, smoothstep(0.55, 0.2, facing))
            c = mix(c, PUPIL, min(1.0, pupil))
            loop[col] = (c.r, c.g, c.b, 1.0)
finish('Landing.FrogEyes', bm, material('FrogEye', 0.08))

# Reeds and cattails, towering up the right of the frame from a bed at the water's edge.
REED = Color((0.13, 0.27, 0.07))
REED_TIP = Color((0.5, 0.52, 0.18))
CATTAIL = Color((0.42, 0.24, 0.1))
CATTAIL_LIT = Color((0.68, 0.42, 0.16))
bm = bmesh.new()
col = bm.loops.layers.color.new('Col')
REED_BED = at(1420, 770)


def blade(base, height, width, lean, bend_dir):
    segs = 14
    a = math.atan2(bend_dir.y, bend_dir.x) + math.pi / 2 + rnd.uniform(-0.6, 0.6)
    side = Vector((math.cos(a), math.sin(a), 0))
    prev = None
    for k in range(segs + 1):
        t = k / segs
        w = width * (1 - t) ** 0.6 * (0.6 + 0.4 * math.sin(math.pi * min(t * 1.6, 1.0)))
        # Arching over toward bend_dir, more and more toward the tip.
        centre = base + Vector((0, 0, height * t * (1 - 0.18 * lean * t))) + bend_dir * lean * height * t ** 2.2
        left, right = bm.verts.new(centre - side * w), bm.verts.new(centre + side * w)
        if prev:
            f = bm.faces.new((prev[0], prev[1], right, left))
            for loop in f.loops:
                c = mix(REED, REED_TIP, smoothstep(0.3, 1.0, t) * 0.7)
                loop[col] = (c.r, c.g, c.b, 1.0)
        prev = (left, right)


for i in range(150):
    base = REED_BED + Vector((rnd.gauss(0.15, 0.3), rnd.gauss(-0.1, 0.35), -0.05))
    top = height_at(base, rnd.uniform(-60, 420))
    lean = rnd.uniform(0.0, 0.5) ** 1.5
    bend = Vector((rnd.uniform(-1, 0.6), rnd.uniform(-0.4, 1.0), 0)).normalized()
    blade(base, top, rnd.uniform(0.008, 0.02), lean, bend)
# Cattails: tall stems with a brown velvet head and a thin spike above (heads as in the reference).
for hx, head_top, head_bottom in ((1462, 105, 195), (1425, 210, 300), (1420, 318, 420), (1500, 260, 335), (1385, 420, 480)):
    base = at(hx, 775) + Vector((rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), -0.05))
    z0, z1 = height_at(base, head_bottom), height_at(base, head_top)
    stem_top = z1 + (z1 - z0) * 0.6
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.006, radius2=0.002, depth=stem_top)
    for v in geom['verts']:
        v.co += base + Vector((0, 0, stem_top / 2))
    colour_faces(bm, geom['verts'], col, lambda co: REED)
    radius = px_size(base, 16)
    geom = bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=12, radius=1)
    for v in geom['verts']:
        v.co = Vector((v.co.x * radius, v.co.y * radius, v.co.z * (z1 - z0) / 2)) + base + Vector((0, 0, (z0 + z1) / 2))
    colour_faces(bm, geom['verts'], col, lambda co, b=base: mix(CATTAIL, CATTAIL_LIT, smoothstep(-0.2, 0.6, noise.noise(co * 60)) * 0.6))
finish('Landing.Reeds', bm, material('Reed', 0.45))

# Pebbles: pale, speckled and wet, heaped in the bottom right (out of focus, close to the camera) and one or two by
# the reeds.
STONE = Color((0.86, 0.76, 0.66))
STONE_WARM = Color((0.78, 0.6, 0.48))
bm = bmesh.new()
col = bm.loops.layers.color.new('Col')
for px, py, half in ((1300, 745, 55), (1490, 788, 70), (1080, 1005, 115), (1235, 965, 95), (1405, 905, 90), (1525, 880, 60),
                     (930, 1015, 95), (1355, 1015, 105), (1180, 885, 55), (1050, 905, 42), (1530, 985, 75), (1280, 880, 40)):
    contact = at(px, py)
    r = px_size(contact, half)
    centre = contact + Vector((0, 0, r * 0.25))
    tone = rnd.uniform(0, 1)
    geom = bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=1)
    squash = rnd.uniform(0.55, 0.75)
    for v in geom['verts']:
        v.co = Vector((v.co.x * r * rnd.uniform(1.0, 1.0), v.co.y * r * 0.85, v.co.z * r * squash))
        v.co += v.co.normalized() * noise.noise(v.co * 4 / r + centre) * r * 0.06
        v.co += centre
    colour_faces(bm, geom['verts'], col, lambda co, t=tone: mix(STONE, STONE_WARM, t * 0.6))
finish('Landing.Pebbles', bm, material('Pebble', 0.35))

# Dew: beads on the pads, a few big ones as in the reference, glinting in the low sun ('Dew' on the site).
bm = bmesh.new()
for centre, r in pad_centres:
    for i in range(int(10 + 70 * min(r, 1.0))):
        a = rnd.uniform(0, 6.28)
        d = r * math.sqrt(rnd.uniform(0.02, 0.85))
        spot = centre + Vector((math.cos(a) * d, math.sin(a) * d, 0.0))
        if (spot.xy - FROG_BASE.xy).length < 0.12 * FROG_SIZE * 1.4:
            continue
        size = r * rnd.choice((0.005, 0.007, 0.01, 0.014, 0.02, 0.035))
        geom = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=size)
        for v in geom['verts']:
            v.co.z *= 0.55
            v.co += spot + Vector((0, 0, size * 0.35 + 0.005))
me = bpy.data.meshes.new('Landing.Dew')
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True
dew = bpy.data.materials.get('Dew') or bpy.data.materials.new('Dew')
me.materials.append(dew)
link('Landing.Dew', me)

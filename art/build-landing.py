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

# --- Foreground garden (the landing shot looks east from CAMERA, at eye level just above the water) --------------------

CAMERA = Vector((-27.0, -2.5))
FG = material('Foreground', 0.55)


def colour_faces(geom_verts, layer, colour_fn):
    for f in {f for v in geom_verts for f in v.link_faces}:
        for loop in f.loops:
            c = colour_fn(loop.vert.co)
            loop[layer] = (c.r, c.g, c.b, 1.0)


def solid(c):
    return lambda co: c


bm = bmesh.new()
col = bm.loops.layers.color.new('Col')

# Lily pads: a field reaching away on the left, the frog's pad big and close.
PAD = Color((0.33, 0.48, 0.2))
PAD_EDGE = Color((0.55, 0.5, 0.22))


def lily_pad(centre, r, spin):
    geom = bmesh.ops.create_circle(bm, cap_ends=True, segments=36, radius=r)
    for v in geom['verts']:
        a = math.atan2(v.co.y, v.co.x)
        if abs(a) < 0.18:
            v.co *= 0.08
        v.co.z += noise.noise(v.co * 3 + centre) * r * 0.06
        x, y = v.co.x, v.co.y
        v.co.x, v.co.y = x * math.cos(spin) - y * math.sin(spin), x * math.sin(spin) + y * math.cos(spin)
        v.co += centre
    colour_faces(geom['verts'], col, lambda co: mix(PAD, PAD_EDGE, smoothstep(0.6, 1.0, (co.xy - centre.xy).length / r) * 0.6))


FROG_PAD = Vector((-25.0, -2.05, LAKE_Z + 0.015))
lily_pad(FROG_PAD, 0.42, 1.1)
for i in range(26):
    p = Vector((rnd.uniform(-26.3, -18), rnd.uniform(-2.6, 2.4), LAKE_Z + 0.012))
    if (p.xy - FROG_PAD.xy).length < 0.6 or (p.xy - CAMERA).length < 0.9:
        continue
    lily_pad(p, rnd.uniform(0.15, 0.38) * (1 + 0.04 * (p.x + 26)), rnd.uniform(0, 6.28))

# Water lilies: two rings of pointed petals, white flushing pink at the tips, a yellow heart.
PETAL = Color((0.98, 0.95, 0.94))
PETAL_TIP = Color((0.96, 0.7, 0.78))
HEART = Color((0.98, 0.8, 0.3))
for centre in (Vector((-25.9, -0.9, LAKE_Z + 0.03)), Vector((-22.5, 0.6, LAKE_Z + 0.03)), Vector((-20.4, -1.4, LAKE_Z + 0.03))):
    for ring, (count, length, tilt) in enumerate(((9, 0.13, 0.9), (8, 0.1, 0.45))):
        for k in range(count):
            a = 2 * math.pi * (k + 0.5 * ring) / count
            geom = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1)
            for v in geom['verts']:
                v.co = Vector((v.co.x * length * 0.5 + length * 0.5, v.co.y * length * 0.18, v.co.z * 0.012))
                x, z = v.co.x, v.co.z
                v.co.x, v.co.z = x * math.cos(tilt) - z * math.sin(tilt), x * math.sin(tilt) + z * math.cos(tilt)
                x, y = v.co.x, v.co.y
                v.co.x, v.co.y = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
                v.co += centre
            colour_faces(geom['verts'], col, lambda co, c=centre, L=length: mix(PETAL, PETAL_TIP, smoothstep(0.4, 1.0, (co - c).length / L)))
    geom = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.035)
    for v in geom['verts']:
        v.co += centre + Vector((0, 0, 0.03))
    colour_faces(geom['verts'], col, solid(HEART))

# The frog on its pad, side-on to the camera, looking right toward the fall.
FROG = Color((0.5, 0.52, 0.26))
FROG_DARK = Color((0.32, 0.34, 0.16))
FROG_BELLY = Color((0.88, 0.85, 0.62))
EYE_GOLD = Color((0.85, 0.6, 0.2))
frog_at = FROG_PAD + Vector((0.05, 0.0, 0.005))


FROG_SCALE = 0.75
FROG_FACING = math.radians(-80)  # nose toward -y: side-on to the camera, looking right toward the fall


def frog_part(offset, radii, colour_fn, segments=(20, 12)):
    geom = bmesh.ops.create_uvsphere(bm, u_segments=segments[0], v_segments=segments[1], radius=1)
    c, s_ = math.cos(FROG_FACING), math.sin(FROG_FACING)
    for v in geom['verts']:
        local = (Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2])) + Vector(offset)) * FROG_SCALE
        v.co = frog_at + Vector((local.x * c - local.y * s_, local.x * s_ + local.y * c, local.z))
    colour_faces(geom['verts'], col, colour_fn)


def mottled(co):
    m = noise.noise(co * 40)
    c = mix(FROG, FROG_DARK, smoothstep(0.1, 0.5, m))
    return mix(c, FROG_BELLY, smoothstep(0.05, 0.0, co.z - frog_at.z - 0.05) * 0.8)


frog_part((0.0, 0.0, 0.085), (0.15, 0.1, 0.085), mottled)  # body, nose toward +x
frog_part((0.12, 0.0, 0.12), (0.085, 0.08, 0.06), mottled)  # head
for side in (-1, 1):
    frog_part((0.15, 0.05 * side, 0.165), (0.03, 0.03, 0.03), solid(EYE_GOLD), (12, 8))
    frog_part((0.172, 0.055 * side, 0.168), (0.012, 0.016, 0.018), solid(Color((0.05, 0.04, 0.03))), (10, 6))
    frog_part((-0.07, 0.09 * side, 0.05), (0.09, 0.04, 0.05), mottled)  # folded back leg
    frog_part((0.0, 0.12 * side, 0.015), (0.08, 0.03, 0.02), mottled)  # foot
    frog_part((0.13, 0.07 * side, 0.03), (0.025, 0.02, 0.05), mottled)  # front leg

# Cattails and tall grass, towering up the right of the frame.
REED = Color((0.36, 0.52, 0.2))
REED_DRY = Color((0.62, 0.58, 0.28))
CATTAIL = Color((0.5, 0.3, 0.14))


def blade(base, height, width, bend, colour):
    """A tapering, curving grass blade (two-sided ribbon)."""
    segs = 10
    a = rnd.uniform(0, 6.28)
    side = Vector((math.cos(a), math.sin(a), 0))
    out = Vector((-side.y, side.x, 0))
    prev = None
    for k in range(segs + 1):
        t = k / segs
        w = width * (1 - t) ** 0.8
        centre = base + Vector((0, 0, height * t)) + out * bend * t * t
        left, right = bm.verts.new(centre - side * w), bm.verts.new(centre + side * w)
        if prev:
            f = bm.faces.new((prev[0], prev[1], right, left))
            for loop in f.loops:
                c = mix(colour, REED_DRY, t * 0.5)
                loop[col] = (c.r, c.g, c.b, 1.0)
        prev = (left, right)


for i in range(90):
    base = Vector((rnd.gauss(-24.4, 0.6), rnd.gauss(-4.0, 0.35), LAKE_Z - 0.05))
    blade(base, rnd.uniform(0.9, 2.4), rnd.uniform(0.035, 0.085), rnd.uniform(-0.8, 0.8), REED)
for i in range(7):
    base = Vector((rnd.uniform(-25.4, -23.4), rnd.uniform(-4.4, -3.5), LAKE_Z - 0.05))
    h = rnd.uniform(1.4, 2.4)
    lean = Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), 0))
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.014, radius2=0.008, depth=h)
    for v in geom['verts']:
        v.co += base + Vector((0, 0, h / 2)) + lean * ((v.co.z + h / 2) / h)
    colour_faces(geom['verts'], col, solid(REED))
    geom = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1)
    for v in geom['verts']:
        v.co = Vector((v.co.x * 0.06, v.co.y * 0.06, v.co.z * 0.22)) + base + Vector((0, 0, h * 0.8)) + lean * 0.8
    colour_faces(geom['verts'], col, solid(CATTAIL))

# Big smooth pebbles in the bottom right, glistening wet (on the site).
STONE = Color((0.8, 0.68, 0.6))
STONE_DARK = Color((0.55, 0.45, 0.4))
for i in range(26):
    r = rnd.uniform(0.07, 0.2)
    centre = Vector((rnd.uniform(-26.2, -24.2), rnd.uniform(-3.6, -2.75), LAKE_Z + r * 0.1))
    geom = bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1)
    for v in geom['verts']:
        v.co = Vector((v.co.x * r * 1.2, v.co.y * r, v.co.z * r * 0.7))
        v.co += v.co.normalized() * noise.noise(v.co * 5 + centre) * r * 0.08
        v.co += centre
    colour_faces(geom['verts'], col, lambda co: mix(STONE, STONE_DARK, smoothstep(-0.2, 0.5, noise.noise(co * 8))))

me = bpy.data.meshes.new('Landing.Foreground')
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True
me.materials.append(FG)
link('Landing.Foreground', me)

"""Chip the planter rim, cut three spill gaps, and build the waterfalls and the pool basin they land in.
Re-runnable: it rebuilds the cutters, falls and basin each time; the planter keeps its modifier stack.
Run inside Blender with art/micro-biome.blend open:  exec(open('<repo>/art/build-spill.py').read())"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

scene = bpy.context.scene
root = bpy.data.objects['MicroBiome']
planter = bpy.data.objects['Planter']

WATER_Z = 0.522  # surface of the water in the planter
WATER_HALF = 0.43  # the surface runs just into the inner walls (at 0.422) so no wall shows below the waterline
POOL_Z = -5.5  # surface of the pool the falls land in
# (name, outward face normal, position along the face, half-width, gap floor z). A and B face the hero camera; C is
# on the back and turns up while the camera circles.
GAPS = [
    ('A', Vector((0, -1, 0)), 0.17, 0.12, 0.497),
    ('B', Vector((-1, 0, 0)), -0.14, 0.095, 0.502),
    ('C', Vector((1, 0, 0)), -0.24, 0.085, 0.505),
]


def along_axis(n):
    return Vector((-n.y, n.x, 0))


def gap_centre(n, along):
    return n * 0.46 + along_axis(n) * along


def fresh_object(name, me, collection=None):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old)
    o = bpy.data.objects.new(name, me)
    (collection or scene.collection).objects.link(o)
    return o


# --- Planter cuts -----------------------------------------------------------------------------------------------------

cutters = bpy.data.collections.get('Cutters') or bpy.data.collections.new('Cutters')
if cutters.name not in scene.collection.children:
    scene.collection.children.link(cutters)
for o in list(cutters.objects):
    bpy.data.objects.remove(o)


def cutter(name, bm, matrix=Matrix()):
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = fresh_object(name, me, cutters)
    o.display_type = 'WIRE'
    o.hide_render = True
    return o


def cone(name, centre, axis, r, length, tilt=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=r, radius2=r * 1.25, depth=length)
    rot = Vector((0, 0, 1)).rotation_difference(axis).to_matrix().to_4x4()
    return cutter(name, bm, Matrix.Translation(centre) @ Matrix.Rotation(tilt, 4, axis) @ rot)


def box(name, centre, size, rot=Matrix()):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    return cutter(name, bm, Matrix.Translation(centre) @ rot)


def ball(name, centre, r, squash=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=14, radius=r)
    bmesh.ops.scale(bm, vec=squash, verts=bm.verts)
    return cutter(name, bm, Matrix.Translation(centre))


random.seed(11)
for name, n, along, hw, zb in GAPS:
    t = along_axis(n)
    c = gap_centre(n, along)
    # Uneven U: the round bottom flares outward (worn wider on the outside) with a slight tilt.
    cone(f'Cut.{name}.Round', Vector((c.x, c.y, zb + hw)), n, hw, 0.36, tilt=random.uniform(-0.25, 0.25))
    slot_size = (abs(n.x) * 0.4 + abs(t.x) * 2 * hw, abs(n.y) * 0.4 + abs(t.y) * 2 * hw, 0.5)
    box(f'Cut.{name}.Slot', Vector((c.x, c.y, zb + hw + 0.25)), slot_size, Matrix.Rotation(random.uniform(-0.08, 0.08), 4, n))
    # Broken shoulders, one bigger than the other.
    for side, r in ((-1, random.uniform(0.045, 0.07)), (1, random.uniform(0.03, 0.05))):
        ball(f'Cut.{name}.Chip{side}', Vector((c.x, c.y, 0.62)) + t * side * (hw + r * 0.45) + n * 0.03, r, (1, 1, random.uniform(0.8, 1.2)))
    # Water-worn scoop on the outer lip where it pours over.
    ball(f'Cut.{name}.Lip', Vector((c.x, c.y, zb + 0.005)) + n * 0.07, hw * 0.9, (1.3 if n.y else 0.6, 0.6 if n.y else 1.3, 0.55))


def near_gap(p):
    return any((p - gap_centre(n, along)).length < hw + 0.11 for _, n, along, hw, _ in GAPS)


# Irregular rim: shallow chips along the top, clear of the gaps.
for i in range(40):
    side = random.choice([(1, 0), (-1, 0), (0, 1), (0, -1)])
    s = random.uniform(-0.44, 0.44)
    p = Vector((side[0] * 0.46 + (s if side[0] == 0 else 0), side[1] * 0.46 + (s if side[1] == 0 else 0), 0))
    r = random.uniform(0.025, 0.06)
    out = random.uniform(0.0, 0.05)
    lift = random.uniform(0.25, 0.7)
    if near_gap(p):
        continue
    ball(f'Cut.Rim.{i}', Vector((p.x + side[0] * out, p.y + side[1] * out, 0.62 + r * lift)), r, (1.8 if side[1] else 1, 1.8 if side[0] else 1, 1))

# Bevelled box -> boolean the cutters -> voxel remesh + smooth, so every cut reads as soft clay.
if 'Cuts' not in planter.modifiers:
    cuts = planter.modifiers.new('Cuts', 'BOOLEAN')
    cuts.operation = 'DIFFERENCE'
    cuts.operand_type = 'COLLECTION'
    cuts.solver = 'EXACT'
    remesh = planter.modifiers.new('Remesh', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = 0.006
    remesh.use_smooth_shade = True
    soften = planter.modifiers.new('Soften', 'CORRECTIVE_SMOOTH')
    soften.factor = 0.5
    soften.iterations = 6
    soften.smooth_type = 'SIMPLE'
    soften.use_only_smooth = True
planter.modifiers['Cuts'].collection = cutters

# Box water: widen the surface to the walls (it was 0.792 across, leaving a strip of wall visible under the waterline).
box_water = bpy.data.objects['Water'].data
half = max(abs(v.co.x) for v in box_water.vertices)
for v in box_water.vertices:
    v.co.x *= WATER_HALF / half
    v.co.y *= WATER_HALF / half

# --- Waterfalls -------------------------------------------------------------------------------------------------------


def water_materials():
    """Stylised water that ports straight to a web shader: a deep blue core paling to the edges (facing ratio), glossy,
    slightly see-through, with lengthwise ridges in the normals. The falls mix in broken white water from their 'foam'
    attribute (the lip and the splash) and thin streaks running down them. One look for planter, falls and pool."""

    def setup(mat, cull=True):
        mat.use_nodes = True
        mat.surface_render_method = 'BLENDED'
        mat.use_backface_culling = cull
        mat.node_tree.nodes.clear()
        return mat.node_tree

    def glossy(nt, alpha):
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        bsdf.inputs['Roughness'].default_value = 0.04
        bsdf.inputs['Coat Weight'].default_value = 1.0
        bsdf.inputs['Coat Roughness'].default_value = 0.02
        bsdf.inputs['Specular IOR Level'].default_value = 0.7
        bsdf.inputs['Alpha'].default_value = alpha
        return bsdf

    def edge_ramp(nt, stops, blend):
        facing = nt.nodes.new('ShaderNodeLayerWeight')
        facing.inputs['Blend'].default_value = blend
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = stops[0][0], (*stops[0][1], 1)
        ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
        for pos, rgb in stops[1:-1]:
            ramp.color_ramp.elements.new(pos).color = (*rgb, 1)
        nt.links.new(facing.outputs['Facing'], ramp.inputs['Fac'])
        return ramp

    def noise(nt, scale, uv_stretch=None, detail=2.0):
        tex = nt.nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value = scale
        tex.inputs['Detail'].default_value = detail
        if uv_stretch:
            uv = nt.nodes.new('ShaderNodeUVMap')
            mapping = nt.nodes.new('ShaderNodeMapping')
            mapping.inputs['Scale'].default_value = uv_stretch
            nt.links.new(uv.outputs['UV'], mapping.inputs['Vector'])
            nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
        return tex

    def bump(nt, tex, strength, bsdf):
        node = nt.nodes.new('ShaderNodeBump')
        node.inputs['Strength'].default_value = strength
        nt.links.new(tex.outputs['Fac'], node.inputs['Height'])
        nt.links.new(node.outputs['Normal'], bsdf.inputs['Normal'])
        nt.links.new(node.outputs['Normal'], bsdf.inputs['Coat Normal'])

    deep, mid, pale = (0.02, 0.22, 0.8), (0.1, 0.45, 1.0), (0.72, 0.9, 1.0)

    # Still water: planter and pool.
    still = bpy.data.materials['Water']
    nt = setup(still)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = glossy(nt, 0.95)
    ramp = edge_ramp(nt, [(0.0, deep), (0.9, mid), (1.0, pale)], 0.15)
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bump(nt, noise(nt, 9.0), 0.15, bsdf)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # Falling water. In the channel ('flow' 0) it matches the still water exactly; ridges, streaks and the paler
    # falling-water edges come in with 'flow'.
    falling = bpy.data.materials.get('Waterfall') or bpy.data.materials.new('Waterfall')
    nt = setup(falling)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = glossy(nt, 0.9)
    flow = nt.nodes.new('ShaderNodeAttribute')
    flow.attribute_name = 'flow'
    still_ramp = edge_ramp(nt, [(0.0, deep), (0.9, mid), (1.0, pale)], 0.15)
    fall_ramp = edge_ramp(nt, [(0.0, deep), (0.55, mid), (1.0, pale)], 0.3)
    blend = nt.nodes.new('ShaderNodeMix')
    blend.data_type = 'RGBA'
    nt.links.new(flow.outputs['Fac'], blend.inputs['Factor'])
    nt.links.new(still_ramp.outputs['Color'], blend.inputs['A'])
    nt.links.new(fall_ramp.outputs['Color'], blend.inputs['B'])
    still_ripples = noise(nt, 9.0)
    ridges = noise(nt, 2.5, uv_stretch=(10, 0.7, 1))
    height = nt.nodes.new('ShaderNodeMix')
    height.data_type = 'FLOAT'
    nt.links.new(flow.outputs['Fac'], height.inputs['Factor'])
    nt.links.new(still_ripples.outputs['Fac'], height.inputs['A'])
    nt.links.new(ridges.outputs['Fac'], height.inputs['B'])
    strength = nt.nodes.new('ShaderNodeMapRange')
    strength.inputs['To Min'].default_value = 0.15
    strength.inputs['To Max'].default_value = 0.45
    nt.links.new(flow.outputs['Fac'], strength.inputs['Value'])
    bump_node = nt.nodes.new('ShaderNodeBump')
    nt.links.new(strength.outputs['Result'], bump_node.inputs['Strength'])
    nt.links.new(height.outputs['Result'], bump_node.inputs['Height'])
    nt.links.new(bump_node.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bump_node.outputs['Normal'], bsdf.inputs['Coat Normal'])
    alpha = nt.nodes.new('ShaderNodeMapRange')
    alpha.inputs['To Min'].default_value = 0.95
    alpha.inputs['To Max'].default_value = 0.85
    nt.links.new(flow.outputs['Fac'], alpha.inputs['Value'])
    nt.links.new(alpha.outputs['Result'], bsdf.inputs['Alpha'])
    # White: the brightest ridges once falling, and the foam attribute broken up by finer noise.
    streak = nt.nodes.new('ShaderNodeMapRange')
    streak.inputs['From Min'].default_value = 0.58
    streak.inputs['From Max'].default_value = 0.72
    streak.inputs['To Max'].default_value = 0.6
    nt.links.new(ridges.outputs['Fac'], streak.inputs['Value'])
    streak_flow = nt.nodes.new('ShaderNodeMath')
    streak_flow.operation = 'MULTIPLY'
    nt.links.new(streak.outputs['Result'], streak_flow.inputs[0])
    nt.links.new(flow.outputs['Fac'], streak_flow.inputs[1])
    foam = nt.nodes.new('ShaderNodeAttribute')
    foam.attribute_name = 'foam'
    breakup = nt.nodes.new('ShaderNodeMapRange')
    breakup.inputs['From Min'].default_value = 0.4
    breakup.inputs['From Max'].default_value = 0.6
    nt.links.new(noise(nt, 6.0, uv_stretch=(8, 3, 1)).outputs['Fac'], breakup.inputs['Value'])
    broken = nt.nodes.new('ShaderNodeMath')
    broken.operation = 'MULTIPLY'
    nt.links.new(foam.outputs['Fac'], broken.inputs[0])
    nt.links.new(breakup.outputs['Result'], broken.inputs[1])
    white = nt.nodes.new('ShaderNodeMath')
    white.operation = 'MAXIMUM'
    nt.links.new(streak_flow.outputs['Value'], white.inputs[0])
    nt.links.new(broken.outputs['Value'], white.inputs[1])
    tint = nt.nodes.new('ShaderNodeMix')
    tint.data_type = 'RGBA'
    tint.inputs['B'].default_value = (0.95, 0.98, 1.0, 1)
    nt.links.new(white.outputs['Value'], tint.inputs['Factor'])
    nt.links.new(blend.outputs['Result'], tint.inputs['A'])
    nt.links.new(tint.outputs['Result'], bsdf.inputs['Base Color'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # White water for the splash crowns.
    spray = bpy.data.materials.get('Foam') or bpy.data.materials.new('Foam')
    nt = setup(spray, cull=False)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = glossy(nt, 0.92)
    bsdf.inputs['Base Color'].default_value = (0.92, 0.97, 1.0, 1)
    bsdf.inputs['Roughness'].default_value = 0.25
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return falling, spray


def channel_radius(hw, d):
    """Radius of a gap's round bottom at distance d from the centre (the cutter cone flares from hw at 0.28 to 1.25 hw
    at 0.64), inset a little so the water stays clear of the softened clay."""
    return hw * (1 + 0.25 * (d - 0.28) / 0.36) * 0.92


def channel_section(hw, zb, d, h, ring):
    """Cross-section of the water in a gap at distance d, surface at height h: a flat top across the round-bottomed
    channel, as (across, height) pairs. Ordered like the falling ring: the top from +across to -across, then the
    bottom arc back round to +across."""
    r = channel_radius(hw, d)
    zc = zb + hw
    h = max(h, zc - r + 0.006)
    half = math.sqrt(max(r * r - (zc - h) ** 2, 1e-6))
    top = [(half - 2 * half * k / (ring // 2), h) for k in range(ring // 2)]
    left, right = math.atan2(h - zc, -half), math.atan2(h - zc, half)
    if left > 0:
        left -= 2 * math.pi
    arc = []
    for k in range(ring - ring // 2):
        theta = left + (right - left) * k / (ring - ring // 2)
        arc.append((r * math.cos(theta), zc + r * math.sin(theta)))
    return top + arc


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def waterfall(name, n, along, hw, zb, seed, material, ring=24):
    """One spill: water level with the box's water, running out through the gap's channel, curling over the lip, then a
    falling column down to the pool, rippled lengthwise. UV u runs around it, v is metres along it (for the scrolling
    flow on the web). Point attributes: 'flow' (0 in the still channel, 1 once falling; ridges and streaks follow it)
    and 'foam' (white water at the lip and the splash)."""
    t = along_axis(n)
    c = t * along
    rings, centres = [], []

    # Through the gap: starting where the box's water surface ends so the two see-through layers never stack, level
    # with it, then dropping toward the lip.
    start = WATER_HALF - 0.002
    channel = [start + (0.5 - start) * i / 14 for i in range(15)]
    lip_floor = zb + hw - channel_radius(hw, 0.5)
    for d in channel:
        h = WATER_Z - 0.0015 - (WATER_Z - 0.0015 - (lip_floor + 0.016)) * ease((d - 0.42) / 0.08)
        section = channel_section(hw, zb, d, h, ring)
        rings.append([c + n * d + t * x + Vector((0, 0, z)) for x, z in section])
        centres.append(c + n * d + Vector((0, 0, sum(z for _, z in section) / ring)))
    lip_section = [(x, z - centres[-1].z) for x, z in channel_section(hw, zb, 0.5, lip_floor + 0.016, ring)]
    lip = centres[-1]

    # Over the lip and down.
    k = 34.0  # outward reach: x = sqrt(drop / k)
    path = []
    x = 0.0
    while x < 0.06:
        x += 0.006
        path.append(c + n * (0.5 + x) + Vector((0, 0, lip.z - k * x * x)))
    z = path[-1].z
    while z > POOL_Z - 0.15:
        z = max(z - 0.04, POOL_Z - 0.15)
        drop = lip.z - z
        wander = noise.noise(Vector((drop * 0.9, seed, 0))) * 0.06 * min(1, drop)
        path.append(c + n * (0.5 + math.sqrt(drop / k)) + t * wander + Vector((0, 0, z)))
    full = [*centres, *path]
    lengths = [0.0]
    for i in range(1, len(full)):
        lengths.append(lengths[-1] + (full[i] - full[i - 1]).length)
    total = lengths[-1]
    lip_length = lengths[len(centres) - 1]

    flow = [0.0] * len(centres)
    for i, p in enumerate(path, start=len(centres)):
        tangent = (full[min(i + 1, len(full) - 1)] - full[i - 1]).normalized()
        side = (t - tangent * t.dot(tangent)).normalized()
        up = tangent.cross(side).normalized()
        after = lengths[i] - lip_length
        f = after / (total - lip_length)
        width = hw * 0.8 * (1 + 0.45 * f) * (1 + 0.08 * noise.noise(Vector((lengths[i] * 1.5, seed, 1))))
        thick = 0.022 + 0.05 * min(1, f * 3)
        # The channel's shape morphs into the falling column over the first 25 cm.
        morph = ease(after / 0.25)
        fl = ease(after / 0.3)
        ring_verts = []
        for j in range(ring):
            a = 2 * math.pi * j / ring
            ridge = 1 + 0.3 * fl * noise.noise(Vector((math.cos(a) * 1.6, math.sin(a) * 1.6, lengths[i] * 0.7 + seed)))
            ex, ez = math.cos(a) * width * (0.92 + 0.08 * ridge), math.sin(a) * thick * ridge
            sx, sz = lip_section[j]
            ring_verts.append(p + side * (sx + (ex - sx) * morph) + up * (sz + (ez - sz) * morph))
        rings.append(ring_verts)
        flow.append(fl)

    foam = []
    for i in range(len(full)):
        after = lengths[i] - lip_length
        # White water just past the lip, where it breaks over the curl, rather than a line on the edge itself.
        white = max(0.75 * max(0.0, 1 - abs(after - 0.08) / 0.12), max(0.0, 1 - (total - lengths[i]) / 0.3))
        foam.append(min(1.0, white))

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new('UVMap')
    verts = [[bm.verts.new(v) for v in r] for r in rings]
    for i in range(len(verts) - 1):
        for j in range(ring):
            quad = (verts[i][j], verts[i][(j + 1) % ring], verts[i + 1][(j + 1) % ring], verts[i + 1][j])
            face = bm.faces.new(quad)
            uvs = ((j / ring, lengths[i]), ((j + 1) / ring, lengths[i]), ((j + 1) / ring, lengths[i + 1]), (j / ring, lengths[i + 1]))
            for loop, uv in zip(face.loops, uvs, strict=True):
                loop[uv_layer].uv = uv
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    for attr_name, values in (('flow', flow), ('foam', foam)):
        attr = me.attributes.new(attr_name, 'FLOAT', 'POINT')
        attr.data.foreach_set('value', [values[i // ring] for i in range(len(me.vertices))])
    me.materials.append(material)
    o = fresh_object(name, me)
    o.parent = root
    return o, full[-1]


def splash(name, at, seed, material):
    """Where a fall lands: a crown of white-water beads and rings spreading on the pool."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    for k in range(22):
        a = k / 14 * 2 * math.pi + rnd.uniform(-0.2, 0.2)
        r = rnd.uniform(0.08, 0.24)
        size = rnd.uniform(0.03, 0.075)
        geom = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=size)
        bmesh.ops.translate(bm, vec=at + Vector((math.cos(a) * r, math.sin(a) * r, rnd.uniform(0.0, 0.12))), verts=geom['verts'])
    for radius in (0.26, 0.42, 0.6):
        geom = bmesh.ops.create_circle(bm, segments=64, radius=radius)
        ring_edges = [e for e in bm.edges if all(v in geom['verts'] for v in e.verts)]
        tube = bmesh.ops.extrude_edge_only(bm, edges=ring_edges)
        new = [v for v in tube['geom'] if isinstance(v, bmesh.types.BMVert)]
        bmesh.ops.scale(bm, vec=(1 + 0.03 / radius, 1 + 0.03 / radius, 1), verts=new)
        bmesh.ops.translate(bm, vec=at + Vector((0, 0, 0.004)), verts=geom['verts'] + new)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    me.materials.append(material)
    o = fresh_object(name, me)
    o.parent = root
    return o


water_fall, foam_material = water_materials()
for i, (name, n, along, hw, zb) in enumerate(GAPS):
    _, end = waterfall(f'Fall.{name}', n, along, hw, zb, i * 7.3, water_fall)
    splash(f'Splash.{name}', Vector((end.x, end.y, POOL_Z)), i, foam_material)


# --- Pool basin -------------------------------------------------------------------------------------------------------


def clay_material(name, rgb, roughness=0.3):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Coat Weight'].default_value = 1.0
    return mat


def basin():
    """A soft clay island under the planter, hollowed into a pool wide enough to catch all three falls."""
    # Overlapping clay lumps; the first voxel remesh fuses them into one soft body.
    rnd = random.Random(5)
    bm = bmesh.new()

    def lump(centre, scale):
        geom = bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=1)
        verts = geom['verts']
        bmesh.ops.scale(bm, vec=scale, verts=verts)
        bmesh.ops.translate(bm, vec=centre, verts=verts)

    lump((0, 0, POOL_Z - 0.35), (1.95, 1.8, 0.62))
    for i in range(9):
        a = i / 9 * 2 * math.pi + rnd.uniform(-0.2, 0.2)
        r = rnd.uniform(0.42, 0.6)
        lump((math.cos(a) * 1.6, math.sin(a) * 1.45, POOL_Z - 0.12 + rnd.uniform(-0.05, 0.08)), (r, r, r * 0.8))
    me = bpy.data.meshes.new('Basin')
    bm.to_mesh(me)
    bm.free()
    island = fresh_object('Basin', me)
    island.parent = root
    fuse = island.modifiers.new('Fuse', 'REMESH')
    fuse.mode = 'VOXEL'
    fuse.voxel_size = 0.03
    hollow_me = bpy.data.meshes.new('Basin.Hollow')
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1)
    bmesh.ops.scale(bm, vec=(1.35, 1.25, 0.32), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, POOL_Z + 0.08), verts=bm.verts)
    bm.to_mesh(hollow_me)
    bm.free()
    hollow = fresh_object('Basin.Hollow', hollow_me, cutters)
    hollow.hide_render = True
    hollow.display_type = 'WIRE'
    cut = island.modifiers.new('Hollow', 'BOOLEAN')
    cut.operation = 'DIFFERENCE'
    cut.object = hollow
    cut.solver = 'EXACT'
    remesh = island.modifiers.new('Remesh', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = 0.02
    remesh.use_smooth_shade = True
    soften = island.modifiers.new('Soften', 'CORRECTIVE_SMOOTH')
    soften.factor = 0.5
    soften.iterations = 8
    soften.smooth_type = 'SIMPLE'
    soften.use_only_smooth = True
    me.materials.append(clay_material('Basin', (0.86, 0.42, 0.26), 0.25))

    # Pool surface: a disc at the waterline, dense enough to ripple on the web.
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=96, radius=1)
    bmesh.ops.scale(bm, vec=(1.3, 1.2, 1), verts=bm.verts)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=3, use_grid_fill=True)
    bmesh.ops.translate(bm, vec=(0, 0, POOL_Z), verts=bm.verts)
    pool_me = bpy.data.meshes.new('Pool')
    bm.to_mesh(pool_me)
    bm.free()
    pool_me.materials.append(bpy.data.materials['Water'])
    for poly in pool_me.polygons:
        poly.use_smooth = True
    pool = fresh_object('Pool', pool_me)
    pool.parent = root


basin()

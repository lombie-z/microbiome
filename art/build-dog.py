"""Build the golden retriever's body: metaball blockout (organic blends at the joints), meshed and remeshed into one
smooth skin, at real scale, facing +X, paws on z=0. The coat (feathering, colour) and the rig come after (rig-dog.py).
Proportions follow the breed standard and photos (art reference in the round notes): withers 0.60 m, body (prosternum to
point of buttocks) 1.1x that, brisket down to the elbow at half the height, level topline, moderate tuck-up, broad skull
with a deep square muzzle a little shorter than the skull, short ears set at eye level, well-bent stifles, short
upright hocks, round compact feet, and a tail that hangs to the hock.
The skin is lean under the coat (the site grows shell fur up to ~6 cm on it), like a groomer's base mesh.
Run: blender --background --factory-startup --python art/build-dog.py -- art/dog.blend"""
import math
import sys

import bmesh
import bpy
from mathutils import Vector

OUT = sys.argv[-1]
scene = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)

mb_data = bpy.data.metaballs.new('DogBlock')
mb_data.resolution = 0.007
mb_data.render_resolution = 0.007
mb_data.threshold = 0.5
mb = bpy.data.objects.new('DogBlock', mb_data)
scene.collection.objects.link(mb)

# A lone metaball element of radius r (stiffness 2, threshold 0.5) has its surface at 0.608 r; everything below is
# given as the surface size wanted, so the numbers read as centimetres of dog. Neighbours blend and swell a little.
K = 1 / 0.608


def ball(c, half, rot=None, stiff=2.0):
    """An ellipsoid with surface half-sizes `half` (x, y, z) at c."""
    hx, hy, hz = half
    r = max(hx, hy, hz)
    e = mb_data.elements.new(type='ELLIPSOID')
    e.co = Vector(c)
    e.radius = r * K
    e.stiffness = stiff
    e.size_x, e.size_y, e.size_z = hx / r, hy / r, hz / r
    if rot:
        e.rotation = rot
    return e


def capsule(a, b, r, stiff=2.0):
    """A capsule from a to b with surface radius r."""
    a, b = Vector(a), Vector(b)
    d = b - a
    e = mb_data.elements.new(type='CAPSULE')
    e.co = (a + b) / 2
    e.radius = r * K
    e.stiffness = stiff
    e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())
    e.size_x = d.length / 2
    return e


def tapered(a, b, r0, r1, n=3):
    """A limb segment tapering from r0 to r1: a few short capsules."""
    a, b = Vector(a), Vector(b)
    for i in range(n):
        capsule(a.lerp(b, i / n), a.lerp(b, (i + 1) / n), r0 + (r1 - r0) * (i + 0.5) / n)


# Torso: level topline at ~0.59, ribcage deep to the elbow (~0.29) and broad, a moderate tuck-up at the loin, a broad
# rounded croup falling gently to the tail set.
capsule((-0.25, 0, 0.505), (0.12, 0, 0.515), 0.08)              # back
ball((0.05, 0, 0.455), (0.19, 0.115, 0.14))                        # ribcage, deep to the elbow and well sprung
ball((0.17, 0, 0.415), (0.10, 0.088, 0.105))                      # forechest / brisket, prosternum in front
ball((0.13, 0, 0.515), (0.09, 0.075, 0.07))                       # withers
ball((-0.11, 0, 0.48), (0.11, 0.072, 0.075))                      # loin and flank (tuck-up under it)
ball((-0.25, 0, 0.475), (0.1, 0.095, 0.1))                        # croup / hindquarters
ball((-0.3, 0, 0.47), (0.055, 0.075, 0.07))                       # point of buttocks
# The head and everything on it sit at HEAD from where they were first blocked in: carried naturally, the top of the
# skull ~0.15 m above the withers, the muzzle about level.
HEAD = Vector((-0.005, 0, -0.03))


def hd(x, y, z):
    return tuple(Vector((x, y, z)) + HEAD)


# Neck: medium length, muscular, set into well laid back shoulders at ~40 degrees.
capsule((0.16, 0, 0.5), hd(0.31, 0, 0.655), 0.06)
ball((0.26, 0, 0.54), (0.055, 0.055, 0.07))                       # throat / front of neck into the chest
# Head: broad, flat-topped skull, broad at the cheeks, a defined stop, a deep straight muzzle a little shorter than the
# skull with flews at its sides. The lower jaw is its own piece (below) so the mouth can open.
ball(hd(0.34, 0, 0.705), (0.08, 0.07, 0.058))                      # skull
for s in (-1, 1):
    ball(hd(0.335, 0.032 * s, 0.722), (0.066, 0.046, 0.04))         # crown: broad and flat across the top
    ball(hd(0.372, 0.05 * s, 0.686), (0.048, 0.034, 0.034))         # cheeks (zygomatic arch)
    ball(hd(0.335, 0.05 * s, 0.668), (0.04, 0.03, 0.034))           # jaw muscle behind the cheek
    ball(hd(0.392, 0.024 * s, 0.737), (0.032, 0.03, 0.026))         # brows over the stop
capsule(hd(0.42, 0, 0.693), hd(0.462, 0, 0.686), 0.032)                 # muzzle bridge
capsule(hd(0.405, 0, 0.67), hd(0.458, 0, 0.664), 0.031)                  # muzzle, deep
for s in (-1, 1):
    capsule(hd(0.412, 0.022 * s, 0.665), hd(0.456, 0.017 * s, 0.66), 0.023)   # flews
# Forelegs: shoulder and upper arm, straight forearm with good bone, short sloping pastern, round compact foot.
for s in (-1, 1):
    y = 0.068 * s
    capsule((0.14, 0.055 * s, 0.5), (0.215, 0.07 * s, 0.4), 0.05)       # shoulder blade / point of shoulder
    capsule((0.215, 0.07 * s, 0.4), (0.145, y, 0.31), 0.043)            # upper arm to elbow
    tapered((0.145, y, 0.3), (0.151, y, 0.115), 0.03, 0.022)             # forearm, slimming to the wrist
    ball((0.153, y, 0.098), (0.024, 0.025, 0.021))                       # carpus (wrist): a knob
    ball((0.137, y, 0.09), (0.011, 0.012, 0.012))                        # accessory carpal pad behind it
    tapered((0.155, y, 0.085), (0.17, y, 0.04), 0.018, 0.02)             # pastern, slim, sloping
    ball((0.178, y, 0.022), (0.026, 0.022, 0.018))                       # (the foot's core: the foot itself is below)
    # Hindlegs: broad muscular thigh, well-bent stifle, second thigh, hock well let down, short upright rear pastern.
    y = 0.075 * s
    ball((-0.215, y, 0.39), (0.075, 0.045, 0.115), rot=Vector((0, 0, -1)).rotation_difference(Vector((0.36, 0, -1)).normalized()))
    capsule((-0.22, y, 0.45), (-0.165, y, 0.29), 0.052)                # femur
    capsule((-0.165, y, 0.29), (-0.295, y, 0.135), 0.033)              # second thigh down to the hock
    capsule((-0.225, y, 0.33), (-0.3, y, 0.155), 0.028)                # its back: hamstring and Achilles to the hock
    ball((-0.312, y, 0.142), (0.016, 0.016, 0.021))                     # point of the hock, standing out behind
    tapered((-0.298, y, 0.125), (-0.288, y, 0.04), 0.019, 0.018)        # rear pastern, short and lean
    ball((-0.275, y, 0.022), (0.026, 0.022, 0.018))                     # (the foot's core)
    # The skin web from the front of the stifle to the belly (the flank fold), so the thigh doesn't crease into the
    # flank when it swings forward.
    ball((-0.125, 0.07 * s, 0.355), (0.045, 0.04, 0.05))
# Tail: set on as an extension of the croup, hanging in a gentle curve to about the hock.
capsule((-0.32, 0, 0.51), (-0.38, 0, 0.45), 0.029)
capsule((-0.38, 0, 0.45), (-0.41, 0, 0.36), 0.023)
capsule((-0.41, 0, 0.36), (-0.42, 0, 0.26), 0.018)
capsule((-0.42, 0, 0.26), (-0.405, 0, 0.17), 0.013)

# Mesh it, one smooth skin.
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
me = bpy.data.meshes.new_from_object(mb.evaluated_get(dg))
body = bpy.data.objects.new('Dog', me)
scene.collection.objects.link(body)
bpy.data.objects.remove(mb)
rem = body.modifiers.new('Remesh', 'REMESH')
rem.mode = 'VOXEL'
rem.voxel_size = 0.0085
sm = body.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH')
sm.iterations = 8
sm.smooth_type = 'LENGTH_WEIGHTED'
sm.use_only_smooth = True
for m in list(body.modifiers):
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=m.name)
for f in body.data.polygons:
    f.use_smooth = True



def skin(name, build, voxel=0.0085, smooth=8):
    """A separate metaball piece (its own family, so it doesn't melt into the body), meshed and remeshed."""
    d = bpy.data.metaballs.new(name + 'Block')
    d.resolution = d.render_resolution = 0.005
    d.threshold = 0.5
    o = bpy.data.objects.new(name + 'Block', d)
    scene.collection.objects.link(o)
    global mb_data
    keep, mb_data = mb_data, d
    build()
    mb_data = keep
    bpy.context.view_layer.update()
    m = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    ob = bpy.data.objects.new(name, m)
    scene.collection.objects.link(ob)
    bpy.data.objects.remove(o)
    r = ob.modifiers.new('Remesh', 'REMESH')
    r.mode, r.voxel_size = 'VOXEL', voxel
    c = ob.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH')
    c.iterations, c.smooth_type, c.use_only_smooth = smooth, 'LENGTH_WEIGHTED', True
    for mod in list(ob.modifiers):
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for f in m.polygons:
        f.use_smooth = True
    return ob


# The lower lip's margin (head-relative, before HEAD): from the corner of the mouth to the chin along the top outer edge
# of each side of the jaw. rig-dog.py paints along it (black lip, the gum inside it).
LOWER_LIP = ((0.38, 0.039, 0.653), (0.418, 0.032, 0.648), (0.452, 0.017, 0.642))
LIP_R = 0.0068


def jaw():
    # Lower jaw: each side of the mandible from the hinge under the cheek to the chin, deep at the back and slimming to
    # the chin, its underside rounded; the lower lip rolled along its top outer edge, standing a little proud of the
    # side so there's a fold under it; the floor of the mouth between, low enough for the tongue to lie in. Its top
    # sits up inside the upper muzzle while the mouth is shut.
    for s in (-1, 1):
        tapered(hd(0.352, 0.025 * s, 0.643), hd(0.442, 0.012 * s, 0.632), 0.0125, 0.0095, n=4)
        ball(hd(0.37, 0.024 * s, 0.635), (0.03, 0.011, 0.012))             # the mandible's rounded lower border
        for a, b in zip(LOWER_LIP, LOWER_LIP[1:]):
            capsule(hd(a[0], a[1] * s, a[2]), hd(b[0], b[1] * s, b[2]), LIP_R, stiff=2.6)
    capsule(hd(0.385, 0, 0.632), hd(0.446, 0, 0.63), 0.013)              # the floor of the mouth
    ball(hd(0.452, 0, 0.632), (0.015, 0.019, 0.013))                  # chin


def tongue():
    ball(hd(0.415, 0, 0.651), (0.045, 0.021, 0.007))
    ball(hd(0.452, 0, 0.649), (0.014, 0.018, 0.006))


skin('Jaw', jaw, voxel=0.0045, smooth=3)
skin('Tongue', tongue, voxel=0.004, smooth=4)


def foot(cx, y, toes):
    """A round, compact foot: the mass of the pads behind, four toes in an arc in front, each its own lobe with a
    groove between it and the next (finer than the body's remesh can hold, so a piece of its own)."""
    def build():
        ball((cx - 0.012, y, 0.018), (0.024, 0.025, 0.018))           # the heel pad's mass, low behind the toes
        for dx, dy in toes:
            for s in (-1, 1):
                ball((cx + dx, y + dy * s, 0.0165), (0.0155, 0.0096, 0.0165))   # a toe: its knuckle stands up
    return build


for s, side in ((1, 'L'), (-1, 'R')):
    skin(f'Foot.F{side}', foot(0.188, 0.068 * s, ((0.017, 0.0085), (0.009, 0.0245))), voxel=0.0035, smooth=2)
    skin(f'Foot.H{side}', foot(-0.272, 0.075 * s, ((0.016, 0.008), (0.008, 0.023))), voxel=0.0035, smooth=2)


# Ears: drop ears set level with the top of the eye and a little behind it, hanging flat against the cheek to just below
# the jaw line: a rounded triangle, thick with feathering, laid over the side of the head (each point of it is pressed
# onto the skin under it, and hangs straight down below the cheek's widest point). Separate meshes so they can swing.
from mathutils.bvhtree import BVHTree


def ear(s, under):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=1)
    top, length, back, front = 0.75, 0.13, 0.298, 0.372     # (head-relative, before HEAD)
    for v in bm.verts:
        x, y, z = v.co
        t = (1 - z) / 2                       # 0 at the set (top), 1 at the tip
        half = 0.5 * (front - back) * (1 - 0.62 * t ** 1.6)          # wide at the set, rounding to the tip
        mid = 0.5 * (front + back) + 0.012 * t                      # the tip comes forward a little
        X, Z = mid + x * half, top - length * t
        hx, hz = hd(X, 0, Z)[0], hd(X, 0, Z)[2]
        # the skin under this point (or the widest of it above, where the head falls away under the jaw)
        y_skin = 0.0
        for k in range(8):
            hit = under.ray_cast(Vector((hx, 0.3 * s, hz + 0.012 * k)), Vector((0, -s, 0)))
            if hit[0] is not None:
                y_skin = max(y_skin, abs(hit[0].y) - 0.007 * k)
        for k in range(1, 6):                 # (over the top of the skull, nothing above: take the side below)
            hit = under.ray_cast(Vector((hx, 0.3 * s, hz - 0.01 * k)), Vector((0, -s, 0)))
            if y_skin == 0.0 and hit[0] is not None:
                y_skin = abs(hit[0].y) - 0.006 * k
        thick = 0.026 * (1 - 0.3 * t) * (1 - x * x) ** 0.3
        v.co = Vector((hx, s * (y_skin + 0.003 + thick * (1 + y * s) / 2), hz))
    me = bpy.data.meshes.new(f'Ear.{"L" if s > 0 else "R"}')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(me.name, me)
    scene.collection.objects.link(o)
    for f in me.polygons:
        f.use_smooth = True
    return o


bpy.context.view_layer.update()
pieces = [bpy.data.objects[n] for n in ('Dog', 'Jaw')]
bm_all = bmesh.new()
for o in pieces:
    tmp = o.data.copy()
    tmp.transform(o.matrix_world)
    bm_all.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)
under = BVHTree.FromBMesh(bm_all)
for s in (-1, 1):
    ear(s, under)

# Eyes (dark, almond, set well apart at the stop, a little oblique: lenses sunk into the head) and the nose (broad,
# black, standing a little proud of the end of the muzzle).
for s in (-1, 1):
    look = Vector((0.5, 0.86 * s, 0.06)).normalized()
    c = Vector(hd(0.405, 0, 0.717))
    hit = under.ray_cast(c + look * 0.2, -look)[0]
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.012, segments=16, ring_count=8, location=hit - look * 0.0035)
    e = bpy.context.object
    e.name = f'Eye.{"L" if s > 0 else "R"}'
    e.scale = (0.62, 1.0, 0.68)               # an almond lens: thin along the way it looks
    e.rotation_euler = (0, 0, math.atan2(look.y, look.x) - math.pi / 2)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.018, segments=20, ring_count=10, location=hd(0.493, 0, 0.689))
nose = bpy.context.object
nose.name = 'Nose'
nose.scale = (0.72, 1.1, 0.76)

# Paws on z=0.
bpy.context.view_layer.update()
low = min(v.co.z for o in scene.objects if o.name == 'Dog' or o.name.startswith('Foot') for v in o.data.vertices)
for o in scene.objects:
    o.location.z -= low
for o in scene.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

print('DOG', len(body.data.polygons), 'faces, lifted', round(-low, 4))
bpy.ops.wm.save_as_mainfile(filepath=OUT)

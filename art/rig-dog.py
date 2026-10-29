"""Rig the retriever (art/build-dog.py), paint its coat, animate it, then export public/models/dog.glb.
The coat on the site is shell fur combed back toward the tail and down: each vertex carries its colour ('Col') and how
long its fur is ('_fur', 0 to 1: short and sleek on the face, the fronts of the legs and the feet; long feathering on
the neck ruff and chest, under the body, on the backs of the forelegs, the trousers, the ears' fringes and the tail;
below 0 for bare skin, the inside of the mouth and the tongue).
Animations, all in place (the site moves the dog) and looping: Walk (two strides, one a second, feet planted while
they bear weight, a little different each stride), Sniff (reaching forward and down to the ground or the water, nose
leading, working in bursts) and Idle (breathing, panting a little with the mouth open, looking about, tail wagging).
Legs are posed by a small planar IK solve per frame: where each foot is and how its pastern and paw are angled, the
rest follows.
Run: blender --background art/dog.blend --python art/rig-dog.py"""
import math
import os

import bpy
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), '..'))
GLB = os.path.join(ROOT_DIR, 'public', 'models', 'dog.glb')
scene = bpy.context.scene
FPS = 30
STRIDE_FRAMES = 30     # one stride a second
WALK_FRAMES, SNIFF_FRAMES, IDLE_FRAMES = 2 * STRIDE_FRAMES, 75, 90   # 2 s (two strides), 2.5 s sniff, 3 s idle
STRIDE = 0.5           # metres the dog travels per stride (the site should move it at STRIDE * FPS / STRIDE_FRAMES)
DUTY = 0.63             # share of the cycle each foot is on the ground (a walk: three feet down most of the time)
PHASE = {'L.hind': 0.0, 'L.fore': 0.25, 'R.hind': 0.5, 'R.fore': 0.75}   # lateral sequence: LH, LF, RH, RF
HEAD = Vector((-0.005, 0, -0.03))      # build-dog.py's head offset


def hd(x, y, z):
    return tuple(Vector((x, y, z)) + HEAD)


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# Materials, then the body decimated on its own (so the painted attributes are made on the final mesh).
coat = bpy.data.materials.new('DogCoat')
dark = bpy.data.materials.new('DogDark')
meshes = [o for o in scene.objects if o.type == 'MESH']
for o in meshes:
    o.data.materials.clear()
    o.data.materials.append(dark if o.name.startswith(('Eye', 'Nose')) else coat)
body = bpy.data.objects['Dog']
bpy.context.view_layer.objects.active = body
dec = body.modifiers.new('Decimate', 'DECIMATE')
dec.ratio = 0.52
bpy.ops.object.modifier_apply(modifier='Decimate')

# Before joining: which piece each vertex is on, and where the mouth is: the skin of the upper muzzle hidden inside the
# shut lower jaw is the roof of the mouth, the top of the jaw hidden inside the muzzle its floor; bare, shown only when
# the mouth opens.
PART = {'Dog': 0, 'Jaw': 1, 'Tongue': 2, 'Ear.L': 3, 'Ear.R': 4}


def bvh(o):
    me = o.data.copy()
    me.transform(o.matrix_world)
    t = BVHTree.FromPolygons([v.co.copy() for v in me.vertices], [tuple(p.vertices) for p in me.polygons])
    bpy.data.meshes.remove(me)
    return t


def inside(tree, p):
    loc, nrm, _, _ = tree.find_nearest(p)
    return loc is not None and (p - loc).dot(nrm) < 0


trees = {n: bvh(bpy.data.objects[n]) for n in ('Dog', 'Jaw')}
for o in meshes:
    part = o.data.attributes.new('part', 'INT', 'POINT')
    mouth = o.data.attributes.new('mouth', 'FLOAT', 'POINT')
    for v in o.data.vertices:
        part.data[v.index].value = PART.get(o.name, 5)
        p = o.matrix_world @ v.co
        m = 0.0
        if o.name == 'Dog' and p.x > 0.3 and p.z > 0.55 and inside(trees['Jaw'], p):
            m = 1.0
        elif o.name == 'Jaw' and inside(trees['Dog'], p):
            m = 1.0
        mouth.data[v.index].value = m

bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
me = body.data
me.validate()
me.update()


# Armature.
arm_data = bpy.data.armatures.new('DogRig')
rig = bpy.data.objects.new('DogRig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')


def bone(name, head, tail, parent=None):
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.roll = 0
    if parent:
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = (b.parent.tail - b.head).length < 1e-4
    return b


# Joint positions match build-dog.py.
bone('hips', (-0.24, 0, 0.49), (-0.06, 0, 0.5))
bone('spine', (-0.06, 0, 0.5), (0.1, 0, 0.51), 'hips')
bone('chest', (0.1, 0, 0.51), (0.2, 0, 0.53), 'spine')
bone('neck', (0.2, 0, 0.53), (0.305, 0, 0.63), 'chest')
bone('head', (0.305, 0, 0.63), (0.474, 0, 0.657), 'neck')
bone('jaw', hd(0.345, 0, 0.66), hd(0.452, 0, 0.636), 'head')            # hinged under the cheek
bone('tongue', hd(0.37, 0, 0.651), hd(0.462, 0, 0.649), 'jaw')
for side, s in (('L', 1), ('R', -1)):
    bone(f'ear.{side}', hd(0.335, 0.078 * s, 0.745), hd(0.345, 0.082 * s, 0.6), 'head')
TAIL = [(-0.32, 0, 0.51), (-0.38, 0, 0.45), (-0.41, 0, 0.36), (-0.42, 0, 0.26), (-0.405, 0, 0.17)]
for i in range(4):
    bone(f'tail{i + 1}', TAIL[i], TAIL[i + 1], 'hips' if i == 0 else f'tail{i}')
for side, s in (('L', 1), ('R', -1)):
    y = 0.068 * s
    bone(f'scapula.{side}', (0.12, 0.055 * s, 0.53), (0.215, y, 0.4), 'chest')
    bone(f'upperarm.{side}', (0.215, y, 0.4), (0.145, y, 0.3), f'scapula.{side}')
    bone(f'forearm.{side}', (0.145, y, 0.3), (0.152, y, 0.1), f'upperarm.{side}')
    bone(f'pastern.{side}', (0.152, y, 0.1), (0.17, y, 0.04), f'forearm.{side}')
    bone(f'fpaw.{side}', (0.17, y, 0.04), (0.215, y, 0.012), f'pastern.{side}')
    y = 0.075 * s
    bone(f'thigh.{side}', (-0.22, y, 0.45), (-0.165, y, 0.29), 'hips')
    bone(f'shin.{side}', (-0.165, y, 0.29), (-0.295, y, 0.135), f'thigh.{side}')
    bone(f'hock.{side}', (-0.295, y, 0.135), (-0.29, y, 0.04), f'shin.{side}')
    bone(f'hpaw.{side}', (-0.29, y, 0.04), (-0.245, y, 0.012), f'hock.{side}')
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# Weights. Heat weighting does the body; the loose pieces are set outright (the jaw and tongue ride their bones, the
# ears hang from the head and swing more toward the tip, eyes and nose go with the head), and none of those bones
# reach into the body. Over the flank, the thigh's pull is eased into the hips' so the skin in front of the stifle
# stretches smoothly as the leg swings forward instead of folding.
VG = {g.name: g for g in body.vertex_groups}
for n in [b.name for b in arm_data.bones]:
    if n not in VG:
        VG[n] = body.vertex_groups.new(name=n)
part = me.attributes['part']
EAR_BONE = {3: 'ear.L', 4: 'ear.R'}
ear_top = {k: max(v.co.z for v in me.vertices if part.data[v.index].value == k) for k in EAR_BONE}
LOOSE = ('jaw', 'tongue', 'ear.L', 'ear.R')


def set_weights(v, ws):
    for g in list(v.groups):
        body.vertex_groups[g.group].remove([v.index])
    for n, w in ws.items():
        if w > 0:
            VG[n].add([v.index], w, 'REPLACE')


groups = {g.index: g.name for g in body.vertex_groups}
for v in me.vertices:
    k = part.data[v.index].value
    if k == 1:
        set_weights(v, {'jaw': 1.0})
    elif k == 2:
        set_weights(v, {'tongue': 1.0})
    elif k in EAR_BONE:
        w = 0.25 + 0.75 * smooth(0.0, 0.07, ear_top[k] - v.co.z)
        set_weights(v, {EAR_BONE[k]: w, 'head': 1 - w})
    elif k == 5:
        set_weights(v, {'head': 1.0})
    else:
        ws = {groups[g.group]: g.weight for g in v.groups if groups[g.group] not in LOOSE}
        if v.co.x > 0.3 and v.co.z > 0.55:          # the head itself: the loose pieces' share goes to the head
            lost = sum(g.weight for g in v.groups if groups[g.group] in LOOSE)
            ws['head'] = ws.get('head', 0) + lost
        set_weights(v, ws)

# Flank: where the skin runs from the front of the thigh to the belly (the flank fold), the weights of the hips,
# spine and thigh are relaxed into their neighbours' so the swing stretches that skin over a hand's breadth instead of
# folding it along one line.
nbr = [[] for _ in me.vertices]
for e in me.edges:
    a, b = e.vertices
    nbr[a].append(b)
    nbr[b].append(a)
SOFT = ['hips', 'spine', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R']
soft_idx = {VG[n].index: n for n in SOFT}
region = {}
for v in me.vertices:
    if part.data[v.index].value != 0:
        continue
    for s in (-1, 1):
        d = (v.co - Vector((-0.145, 0.07 * s, 0.38))).length
        f = 1 - smooth(0.05, 0.12, d)
        if f > 0:
            region[v.index] = max(region.get(v.index, 0), f)
W = {i: {n: 0.0 for n in SOFT} for i in range(len(me.vertices))}
for v in me.vertices:
    for g in v.groups:
        if g.group in soft_idx:
            W[v.index][soft_idx[g.group]] = g.weight
for _ in range(24):
    NW = {}
    for i, f in region.items():
        avg = {n: sum(W[j][n] for j in nbr[i]) / max(1, len(nbr[i])) for n in SOFT}
        NW[i] = {n: (1 - 0.6 * f) * W[i][n] + 0.6 * f * avg[n] for n in SOFT}
    for i in NW:
        W[i] = NW[i]
for i in region:
    for n in SOFT:
        if W[i][n] > 1e-3:
            VG[n].add([i], W[i][n], 'REPLACE')
        else:
            VG[n].remove([i])

for v in me.vertices:                  # normalised, and capped at 1 (heat weighting can overshoot a hair)
    tot = sum(g.weight for g in v.groups)
    for g in v.groups:
        g.weight = min(1.0, g.weight / tot) if tot > 0 else 0


# Coat: fur length and colour from where each vertex sits (and which bones carry it).
groups = {g.index: g.name for g in body.vertex_groups}
fur = me.attributes.new('_fur', 'FLOAT', 'POINT')
col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
me.color_attributes.active_color = col
me.color_attributes.render_color_index = me.color_attributes.find('Col')
GOLD = Vector((0.6, 0.3, 0.075))      # the body's gold (linear)
DEEP = Vector((0.42, 0.18, 0.04))     # richer along the back
LEATHER = Vector((0.33, 0.135, 0.03))  # ear leather, darker still
CREAM = Vector((0.84, 0.62, 0.34))    # feathering, lighter
PALE = Vector((0.8, 0.56, 0.28))      # the muzzle, lighter
MOUTH = Vector((0.1, 0.03, 0.028))    # roof of the mouth, in shadow
GUM = Vector((0.32, 0.07, 0.06))
TONGUE = Vector((0.62, 0.16, 0.16))
DARK_MAT = [i for i, m in enumerate(me.materials) if m.name == 'DogDark']
dark_verts = set()
for p in me.polygons:
    if p.material_index in DARK_MAT:
        dark_verts.update(p.vertices)
mouth = me.attributes['mouth']
ear_x = {k: (min(v.co.x for v in me.vertices if part.data[v.index].value == k),
             max(v.co.x for v in me.vertices if part.data[v.index].value == k)) for k in EAR_BONE}

for v in me.vertices:
    p, n = v.co, v.normal
    k = part.data[v.index].value
    w = {}
    for g in v.groups:
        key = groups[g.group].split('.')[0].rstrip('1234')
        w[key] = w.get(key, 0) + g.weight
    if v.index in dark_verts:
        fur.data[v.index].value = 0
        col.data[v.index].color = (0.02, 0.015, 0.012, 1)
        continue
    if k == 2 or mouth.data[v.index].value > 0.5:      # bare: tongue, gums, the roof of the mouth
        fur.data[v.index].value = -1
        c = TONGUE if k == 2 else (GUM if k == 1 else MOUTH)
        col.data[v.index].color = (*c, 1)
        continue
    head, tail = w.get('head', 0), w.get('tail', 0)
    feet = w.get('fpaw', 0) + w.get('hpaw', 0) + w.get('pastern', 0) * 0.6 + w.get('hock', 0) * 0.5
    up, down, back = n.z, -n.z, -n.x
    length = 0.4                                                          # body coat: lying flat
    # The back of the head and neck run into a fuller coat over the neck and shoulders.
    length = max(length, 0.5 * smooth(0.2, 0.3, p.x) * smooth(0.45, 0.55, p.z) * (1 - head))
    # Neck ruff and chest: the front and underside of the neck down over the forechest (soft-edged).
    front = smooth(-0.5, 0.4, n.x - n.z * 0.5)
    ruff = smooth(0.08, 0.26, p.x) * smooth(0.26, 0.42, p.z) * (1 - smooth(0.58, 0.66, p.z)) * front
    length = max(length, 0.95 * ruff)
    # Under the body, from the brisket back to the tuck-up: long and hanging.
    belly = smooth(0.1, 0.75, down) * (1 - smooth(0.36, 0.46, p.z)) * smooth(-0.22, -0.08, p.x) * (1 - smooth(0.24, 0.32, p.x))
    length = max(length, 1.0 * belly)
    # Backs of the forelegs, elbow to just above the pastern.
    flimb = w.get('upperarm', 0) + w.get('forearm', 0) + w.get('pastern', 0) * 0.5
    length = max(length, 0.8 * smooth(-0.1, 0.6, back) * flimb * smooth(0.1, 0.18, p.z) * (1 - smooth(0.34, 0.4, p.z)))
    # Trousers: the backs of the thighs down to the hock.
    trousers = smooth(-0.2, 0.45, back) * (1 - smooth(-0.24, -0.16, p.x)) * smooth(0.14, 0.22, p.z) * (1 - smooth(0.46, 0.52, p.z))
    length = max(length, 1.0 * trousers)
    # Tail: a flag, long underneath, shorter on top.
    length = length * (1 - tail) + tail * (0.6 + 0.4 * smooth(-0.4, 0.4, down - n.x * 0.3))
    # Short and sleek on the fronts of the legs below the elbow and stifle, and the feet.
    lower_leg = (1 - smooth(0.2, 0.3, p.z)) * (1 - tail)
    sleek = 0.1 + (length - 0.1) * smooth(0.2, 0.7, back) * smooth(0.1, 0.2, p.z)
    length = length * (1 - lower_leg) + lower_leg * min(length, sleek)
    length = length * (1 - min(1, feet)) + 0.05 * min(1, feet)
    # Head: short and sleek on the face, a little longer over the skull, cheeks and throat.
    if k in EAR_BONE:
        x0, x1 = ear_x[k]
        u = (p.x - x0) / (x1 - x0)                        # 0 at the back edge, 1 at the front
        drop = ear_top[k] - p.z
        outer = smooth(-0.3, 0.6, abs(n.y))
        length = 0.32 + 0.3 * smooth(0.02, 0.12, drop) + 0.35 * smooth(0.55, 0.0, u) * smooth(0.02, 0.1, drop)
        length *= 0.75 + 0.25 * outer
    elif k == 1:
        length = 0.06 + 0.2 * smooth(0.4, 0.95, down) * (1 - smooth(0.42, 0.46, p.x))
    else:
        face = head * smooth(0.36, 0.42, p.x)
        skull = head * (1 - face)
        throat = head * smooth(0.3, 0.8, down) * (1 - smooth(0.38, 0.42, p.x))
        hl = face * (0.045 - 0.03 * smooth(0.45, 0.48, p.x)) + 0.1 * skull + 0.35 * throat
        hl += 0.18 * skull * smooth(0.36, 0.3, p.x) * smooth(0.6, 0.0, up)        # cheeks into the neck
        length = length * (1 - head) + hl
    fur.data[v.index].value = max(0.0, min(1.0, length))

    c = GOLD.copy()
    saddle = smooth(0.3, 0.9, up) * smooth(0.42, 0.56, p.z) * (1 - head)
    c = c.lerp(DEEP, 0.42 * saddle)
    neck_front = ruff * smooth(0.44, 0.54, p.z)
    feather = smooth(0.35, 1.0, length) * (1 - 0.6 * neck_front)
    c = c.lerp(CREAM, 0.5 * feather if k not in EAR_BONE else 0)              # feathering lighter
    c = c.lerp(CREAM, 0.12 * lower_leg + 0.2 * min(1, feet))               # legs and feet a shade lighter
    c = c.lerp(PALE, 0.55 * head * smooth(0.385, 0.45, p.x))               # muzzle
    if k in EAR_BONE:
        c = c.lerp(LEATHER, 0.3 * (1 - smooth(0.4, 0.75, length)))        # leather darker, its fringe lighter
        c = c.lerp(CREAM, 0.3 * smooth(0.5, 0.85, length))
    col.data[v.index].color = (*c, 1)

me.attributes.remove(me.attributes['part'])
me.attributes.remove(me.attributes['mouth'])


# Posing.
pose = rig.pose.bones
for pb in pose:
    pb.rotation_mode = 'QUATERNION'
SIDE, UP, FWD = Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))


def turn(name, axis, degrees, q=None):
    """Rotate a bone about a world axis (as it stands at rest), composed onto q if given."""
    b = rig.data.bones[name]
    local = (b.matrix_local.to_3x3().inverted() @ Vector(axis)).normalized()
    r = Quaternion(local, math.radians(degrees))
    pose[name].rotation_quaternion = (q @ r) if q is not None else r


def ang(v):
    """Direction of a vector in the side plane: 0 straight down, positive forward (degrees)."""
    return math.degrees(math.atan2(v.x, -v.z))


def unit(a):
    a = math.radians(a)
    return Vector((math.sin(a), 0, -math.cos(a)))


def rest_vec(name):
    b = rig.data.bones[name]
    return b.tail_local - b.head_local


def posed_delta(name):
    pb = pose[name]
    return ang(pb.tail - pb.head) - ang(rest_vec(name))


def aim(name, target, yaw=0.0):
    """Pitch a bone so it points at side-plane angle `target` (as ang()), then turn it `yaw` degrees about the vertical."""
    bpy.context.view_layer.update()
    parent = rig.data.bones[name].parent
    local = target - ang(rest_vec(name)) - (posed_delta(parent.name) if parent else 0)
    turn(name, UP, yaw)
    turn(name, SIDE, -local, pose[name].rotation_quaternion)


def elev(e):
    """ang() of a direction pointing back with elevation e degrees (for the tail)."""
    return -90 - e


def curve(pts, u):
    """Smooth interpolation through (u, value) points; u in [0, 1]."""
    for (u0, v0), (u1, v1) in zip(pts, pts[1:]):
        if u <= u1:
            t = 0.0 if u1 == u0 else (u - u0) / (u1 - u0)
            t = t * t * (3 - 2 * t)
            return v0 + (v1 - v0) * t
    return pts[-1][1]


LEGS = {
    'fore': dict(chain=('upperarm', 'forearm', 'pastern', 'paw'), bones=('upperarm', 'forearm', 'pastern', 'fpaw'), root='scapula', bend=-1),
    'hind': dict(chain=('thigh', 'shin', 'hock', 'paw'), bones=('thigh', 'shin', 'hock', 'hpaw'), root=None, bend=1),
}


def toe_rest(kind, side):
    return rig.data.bones[f'{LEGS[kind]["bones"][3]}.{side}'].tail_local.copy()


def place_leg(kind, side, toe, a_pastern, a_paw):
    """Pose a leg so its toe is at `toe` (armature space) with the pastern and paw at these side-plane angles; then
    swing the whole leg in or out a touch so the paw stays on its track when the body shifts its weight sideways."""
    A, B, C, D = (f'{n}.{side}' for n in LEGS[kind]['bones'])
    for n in (A, B, C, D):
        pose[n].rotation_quaternion = Quaternion()
    bpy.context.view_layer.update()
    lA, lB, lC, lD = (rest_vec(n).length for n in (A, B, C, D))
    P0 = pose[A].head.copy()
    P3 = toe - unit(a_paw) * lD
    P2 = P3 - unit(a_pastern) * lC
    d = P2 - P0
    d.y = 0
    dist = max(abs(lA - lB) + 1e-3, min(lA + lB - 1e-4, d.length))
    base = ang(d)
    alpha = math.degrees(math.acos(max(-1, min(1, (lA * lA + dist * dist - lB * lB) / (2 * lA * dist)))))
    aA = base + LEGS[kind]['bend'] * alpha
    P1 = P0 + unit(aA) * lA
    aB = ang(P2 - P1)
    parent = posed_delta(rig.data.bones[A].parent.name)
    acc = parent
    for n, target in ((A, aA), (B, aB), (C, a_pastern), (D, a_paw)):
        local = target - ang(rest_vec(n)) - acc
        turn(n, SIDE, -local)
        acc += local
    planar = pose[A].rotation_quaternion.copy()
    roll = 0.0
    for _ in range(2):
        bpy.context.view_layer.update()
        dy = pose[D].tail.y - toe.y
        h = max(0.1, pose[A].head.z - pose[D].tail.z)
        roll -= math.degrees(math.atan2(dy, h))
        pose[A].rotation_quaternion = planar
        turn(A, FWD, roll, planar)


def rest_angles(kind, side):
    _, _, C, D = (f'{n}.{side}' for n in LEGS[kind]['bones'])
    return ang(rest_vec(C)), ang(rest_vec(D))


def stand_legs():
    for side in ('L', 'R'):
        for kind in ('fore', 'hind'):
            aC, aD = rest_angles(kind, side)
            place_leg(kind, side, toe_rest(kind, side), aC, aD)


# The walk's foot cycle, from touchdown (t = 0) through stance (t < DUTY) and swing.
FOOT = {
    # pastern angle through stance, then through swing; paw flex (curl) through swing; lift of the toe in swing
    # All angles are offsets from the rest pose. The carpus folds right up early in the swing (the pastern swings back
    # to near horizontal) and opens just before the foot reaches forward; the hock flexes less. The shoulder blade
    # rocks with the leg (forward at touchdown, back at toe-off).
    'fore': dict(stance=[(0, 0), (0.5, 4), (0.8, -6), (1, -30)], swing=[(0, -30), (0.35, -95), (0.7, -12), (0.9, 8), (1, 0)],
                 curl=[(0, 8), (0.35, 40), (0.8, 5), (1, 0)], lift=0.075, reach=0.01, scapula=(-9, 9)),
    'hind': dict(stance=[(0, 5), (0.5, -8), (0.85, -25), (1, -45)], swing=[(0, -45), (0.3, -48), (0.7, 2), (1, 5)],
                 curl=[(0, -7), (0.3, 30), (0.8, 0), (1, 0)], lift=0.045, reach=0.02, scapula=None),
}


def walk_leg(kind, side, t, vary=1.0):
    """t: this foot's place in its stride (0 touchdown); vary scales how high it steps this stride."""
    f = FOOT[kind]
    if f['scapula']:
        a0, a1 = f['scapula']
        k = t / DUTY if t < DUTY else 1 - (0.5 - 0.5 * math.cos(math.pi * (t - DUTY) / (1 - DUTY)))
        turn(f'scapula.{side}', SIDE, a0 + (a1 - a0) * k)
    rest = toe_rest(kind, side)
    aC0, aD0 = rest_angles(kind, side)
    sweep = STRIDE * DUTY
    front, back = rest.x + f['reach'] + sweep / 2, rest.x + f['reach'] - sweep / 2
    if t < DUTY:
        s = t / DUTY
        toe = Vector((front - sweep * s, rest.y, rest.z))
        aC = aC0 + curve(f['stance'], s)
        heel = smooth(0.62, 1.0, s)                    # heel lifts at the end of stance, rolling over the toes
        aD = aD0 - 38 * heel
    else:
        u = (t - DUTY) / (1 - DUTY)
        x = back + (front - back) * (0.5 - 0.5 * math.cos(math.pi * smooth(0.0, 0.92, u)))
        z = rest.z + f['lift'] * vary * math.sin(math.pi * min(1.0, u ** 0.85))
        toe = Vector((x, rest.y, z))
        aC = aC0 + curve(f['swing'], u) * (0.85 + 0.15 * vary)
        aD = aC + (aD0 - aC0) - curve(f['curl'], u)
    place_leg(kind, side, toe, aC, aD)


def key_all(frame):
    for pb in pose:
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.keyframe_insert('location', frame=frame)


def reset():
    for pb in pose:
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)


def hips_shift(v):
    """Move the whole dog (hips are the root) by a world vector."""
    b = rig.data.bones['hips']
    pose['hips'].location = b.matrix_local.to_3x3().inverted() @ Vector(v)


def slide(name, v):
    """Move a bone by a vector given in the armature's rest frame."""
    b = rig.data.bones[name]
    pose[name].location = b.matrix_local.to_3x3().inverted() @ Vector(v)


def new_action(name):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    return act


def tail_pose(carriage, wag):
    """carriage: each segment's elevation (degrees above horizontal, pointing back), a relaxed curve with the tip
    sagging; wag(i): each segment's sideways angle (degrees), lagging toward the tip."""
    for i in range(4):
        aim(f'tail{i + 1}', elev(carriage[i]), wag(i))


def ears(pitch, flap=0.0):
    """Ears hang: `pitch` is how far they swing from hanging straight down (forward positive), flap a sideways lift."""
    for side, s in (('L', 1), ('R', -1)):
        aim(f'ear.{side}', pitch)
        turn(f'ear.{side}', FWD, s * flap, pose[f'ear.{side}'].rotation_quaternion)


def mouth(open_deg, tongue_out=0.0):
    turn('jaw', SIDE, open_deg)
    turn('tongue', SIDE, 0.5 * open_deg * tongue_out)
    slide('tongue', (0.022 * tongue_out, 0, -0.004 * tongue_out))


rig.animation_data_create()
TAU = 2 * math.pi
body.modifiers['Armature'].show_viewport = False     # only the bones need evaluating while posing

# Walk: two strides, alike in their footfalls (so the paws stay planted at the same pace) but not identical: the head
# looks a little one way then the other, one stride steps a touch higher, the tail and ears swing a little more. The
# weight moves over each supporting pair: the body sways and rolls toward the side whose hind foot is down.
new_action('Walk')
for frame in range(WALK_FRAMES + 1):
    ph = (frame % STRIDE_FRAMES) / STRIDE_FRAMES      # place in this stride
    ph2 = frame / WALK_FRAMES                          # place in the two-stride loop
    var = math.sin(TAU * ph2)
    reset()
    hips_shift((0, 0.007 * math.sin(TAU * ph), -0.006 + 0.006 * math.cos(2 * TAU * (ph - 0.12))))
    turn('hips', FWD, 2.6 * math.sin(TAU * ph))                      # pelvis rolls with the hind stance
    turn('hips', UP, -3.0 * math.cos(TAU * ph), pose['hips'].rotation_quaternion)
    turn('spine', UP, 2.0 * math.cos(TAU * ph) + 0.8 * var)
    turn('spine', FWD, -1.0 * math.sin(TAU * (ph - 0.1)), pose['spine'].rotation_quaternion)
    turn('chest', UP, 2.0 * math.cos(TAU * (ph - 0.25)))            # shoulders swing a quarter after the hips
    turn('chest', FWD, -1.8 * math.sin(TAU * (ph - 0.25)), pose['chest'].rotation_quaternion)
    bpy.context.view_layer.update()
    nod = math.cos(2 * TAU * (ph - 0.3))
    aim('neck', 118 - 2.5 * nod, -1.5 * math.cos(TAU * (ph - 0.25)) + 4 * var)   # head carried a little lower, nodding
    aim('head', 96 + 1.5 * nod + 1.5 * math.sin(TAU * ph2 + 1), -1.5 * math.cos(TAU * (ph - 0.25)) + 3 * var)
    mouth(0)
    ears(4 + 6 * math.cos(2 * TAU * (ph - 0.42)) * (1 + 0.25 * var), 3 * math.cos(2 * TAU * (ph - 0.45)))
    sway = 1 + 0.2 * math.sin(TAU * ph2 + 0.7)
    bob = math.cos(2 * TAU * (ph - 0.12))
    tail_pose([2 + 2 * bob, -12 + 3 * math.cos(2 * TAU * (ph - 0.2)), -28 + 4 * math.cos(2 * TAU * (ph - 0.3)), -46 + 5 * math.cos(2 * TAU * (ph - 0.4))],
              lambda i: sway * (7 + 2 * i) * math.sin(TAU * ph + math.pi - 0.75 * i))
    for side in ('L', 'R'):
        for kind in ('fore', 'hind'):
            t = (ph - PHASE[f'{side}.{kind}']) % 1.0
            vary = 1 + 0.12 * math.sin(TAU * ph2 + (0.0 if side == 'L' else 2.0) + (0.0 if kind == 'fore' else 1.0))
            walk_leg(kind, side, t, vary)
    key_all(frame)

# Sniff: reaching forward and down to the ground (or the water's edge) with the nose leading, the front end dropping a
# little as the elbows give, searching slowly side to side; the nose works in two bursts of quick sniffs a loop, the
# head pushing in a touch for each burst and lifting a little between them.
new_action('Sniff')
for frame in range(SNIFF_FRAMES + 1):
    ph = frame / SNIFF_FRAMES
    reset()
    burst = smooth(0.0, 0.08, ph % 0.5) * (1 - smooth(0.3, 0.4, ph % 0.5))
    sniffs = burst * math.sin(15 * TAU * ph)
    search = math.sin(TAU * ph)
    hips_shift((0, 0, -0.006))
    turn('spine', SIDE, 3)
    turn('chest', SIDE, 7 + 1.0 * burst)
    bpy.context.view_layer.update()
    aim('neck', 76 - 4 * burst, 9 * search)
    aim('head', 45 + 1.6 * sniffs - 3 * burst, 5 * math.sin(TAU * ph - 0.8))
    mouth(0)
    ears(-4 + 2 * sniffs, 2 * search)
    tail_pose([4, -12, -28, -44], lambda i: (6 + 2 * i) * math.sin(2 * TAU * ph - 0.8 * i))
    stand_legs()
    key_all(frame)

# Idle: standing easy, breathing, panting a little with the mouth open and the tongue showing, looking one way then the
# other, the tail held low and wagging gently.
new_action('Idle')
for frame in range(IDLE_FRAMES + 1):
    ph = frame / IDLE_FRAMES
    reset()
    breath = math.sin(2 * TAU * ph)
    pant = math.sin(9 * TAU * ph)                      # three pants a second
    hips_shift((0, 0, 0.0015 * breath))
    turn('hips', FWD, 0.8 * math.sin(TAU * ph))
    turn('chest', SIDE, -0.7 * breath - 0.3 * pant)
    look = 13 * math.sin(TAU * ph) + 4 * math.sin(2 * TAU * ph)
    bpy.context.view_layer.update()
    aim('neck', 128 + 1.2 * breath, 0.6 * look)
    aim('head', 99 - 1.0 * breath + 4 * math.sin(TAU * ph + 1.3), 0.5 * look)
    turn('head', FWD, 0.15 * look, pose['head'].rotation_quaternion)
    mouth(14 + 3 * pant, 1.0)
    ears(2 + 3 * math.sin(2 * TAU * ph + 0.5), 0)
    tail_pose([-30, -48, -62, -72], lambda i: (9 + 3 * i) * math.sin(6 * TAU * ph - 0.8 * i))
    stand_legs()
    key_all(frame)


def fcurves(act):
    if hasattr(act, 'layers'):
        for layer in act.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    yield from bag.fcurves
    else:
        yield from act.fcurves


body.modifiers['Armature'].show_viewport = True

# Each action on its own NLA track so each exports as its own glTF animation; Walk left active.
for act in bpy.data.actions:
    act.use_frame_range = True
    n = act.name
    act.frame_start, act.frame_end = 0, {'Walk': WALK_FRAMES, 'Sniff': SNIFF_FRAMES, 'Idle': IDLE_FRAMES}[n]
    for fc in fcurves(act):
        for k in fc.keyframe_points:
            k.interpolation = 'LINEAR'
rig.animation_data.action = None
for n in ('Idle', 'Sniff', 'Walk'):
    tr = rig.animation_data.nla_tracks.new()
    tr.name = n
    st = tr.strips.new(n, 0, bpy.data.actions[n])
    tr.mute = True
rig.animation_data.action = bpy.data.actions['Walk']
rig['walk_speed'] = STRIDE * FPS / STRIDE_FRAMES     # metres a second, at the model's scale, for paws that don't slide
scene.frame_start, scene.frame_end = 0, WALK_FRAMES - 1
scene.render.fps = FPS
bpy.ops.wm.save_mainfile()

# Export: the skinned dog and its three animations.
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
os.makedirs(os.path.dirname(GLB), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', use_selection=True, export_apply=False,
                          export_skins=True, export_animations=True, export_animation_mode='ACTIONS',
                          export_attributes=True, export_vertex_color='ACTIVE', export_extras=True,
                          export_draco_mesh_compression_enable=True, export_yup=True,
                          export_cameras=False, export_lights=False)
print('exported', GLB, os.path.getsize(GLB), len(me.polygons), 'faces')

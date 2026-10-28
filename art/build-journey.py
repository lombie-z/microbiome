"""Key the journey camera (JourneyCam) the scroll runs along: frame 0 is the hero, the last frame is the pool.
Re-runnable; it replaces the keys. Shape it by moving the SHOTS below (or nudge keys in Blender), then re-export.
Run inside Blender with art/micro-biome.blend open:  exec(open('<repo>/art/build-journey.py').read())

The path is a few composed shots joined by one smooth curve (Catmull-Rom through the eye points and, separately,
through the look-at points), so the camera never lurches. After the opening it falls with the falls: right up
against the water, at its pace, looking up at it and down along it (the site hides what's far below in fog).
  0-80     Open up: from the blog's near-orthographic hero, a dolly zoom (lens widens as the camera closes in, so the
           biome holds its size).
  80-215   Tuck in beside fall A under the lip, looking up at the planter; tip over and fall with it, looking down.
  215-265  Past the cloud layer; below it the sun is out.
  265-460  Spiral down with the streams as they braid, then look up at the braid winding overhead into the light.
  460-670  Keep looking up while drifting down and away from the fall, levelling out at the water: eye level in the
           shoreline garden (art/build-macro.py), the frog in front of the splash.
  670-820  Rise over the garden and pull right back: the giant biome below, the small one floating above it, its
           falls pouring down into the big one (micro to macro).
"""
import math

import bpy
from mathutils import Vector

scene = bpy.context.scene
F_OPEN, F_END = 80, 820
HERO_TARGET = Vector((0, 0, 0.92))
HERO_DIRECTION = Vector((-1, -1, 0.75)).normalized()  # the blog's view (PreviewCam)
HERO_FOV, OPEN_FOV = 6.0, 38.0
# Height of the view at the target, in metres: the hero shows the biome about as big as the blog does.
HERO_VIEW, OPEN_VIEW = 4.6, 3.2
OPEN_TARGET = Vector((0, 0, 0.45))

# (frame, eye, look-at, vertical FOV) for each composed shot after the opening beat. Pool surface is at z -11; the
# main falls leave the planter at A (0.17, -0.5), B (-0.5, 0.14), C (0.5, -0.24) and braid from z -2.1 to -7.
SHOTS = [
    (150, Vector((0.45, -0.95, -0.35)), Vector((0.17, -0.55, 0.75)), 50.0),  # tucked beside fall A, looking up at the lip
    (215, Vector((0.42, -1.0, -0.9)), Vector((0.15, -0.75, -3.0)), 50.0),  # falling with it, looking down along it
    (265, Vector((0.45, -1.4, -1.65)), Vector((0.15, -0.7, -3.4)), 48.0),  # through the cloud layer
    (340, Vector((0.69, -1.31, -3.0)), Vector((0.0, 0.0, -5.5)), 48.0),  # beside the gathering streams, looking down the braid
    (400, Vector((0.95, 0.74, -4.6)), Vector((0.0, 0.0, -6.5)), 50.0),  # spiralling round with the twist
    (460, Vector((-0.37, 0.65, -6.4)), Vector((0.0, 0.0, -3.5)), 55.0),  # looking up the braid winding overhead into the light
    # Still looking up, drifting down and away from the fall, levelling out to eye height as it reaches the water.
    (530, Vector((-1.39, 0.8, -8.0)), Vector((0.0, 0.0, -5.6)), 52.0),
    (600, Vector((-2.27, 0.4, -9.9)), Vector((0.0, 0.0, -8.2)), 52.0),
    (670, Vector((-2.4, -0.35, -10.72)), Vector((0.0, 0.15, -10.3)), 52.0),  # eye level in the garden: the frog, the fall
    (710, Vector((-2.7, -0.55, -9.5)), Vector((-0.3, 0.3, -10.4)), 48.0),  # rising over the garden
    (765, Vector((-7.0, -6.0, -5.0)), Vector((-0.8, 0.8, -8.5)), 40.0),  # pulling back over the giant planter's wall
    (820, Vector((-18.5, -16.7, 7.2)), Vector((-0.9, 0.9, -6.0)), 34.0),  # the final frame: micro over macro
]
# Sun, warm light and rainbow come in below the clouds.
F_SUN_IN, F_SUN_FULL = 275, 380
F_BOW_IN, F_BOW_FULL = 560, 640


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return a + (b - a) * t


def dwell(t):
    """Nearly even travel (it's a fall, not a tour), easing only slightly through each shot."""
    return lerp(t, ease(t), 0.15)


def opening(f):
    u = dwell(f / F_OPEN)
    fov = lerp(HERO_FOV, OPEN_FOV, u)
    distance = lerp(HERO_VIEW, OPEN_VIEW, u) / (2 * math.tan(math.radians(fov / 2)))
    elevation = lerp(math.asin(HERO_DIRECTION.z), math.radians(14), u)
    target = HERO_TARGET.lerp(OPEN_TARGET, u)
    az = math.radians(-135)
    direction = Vector((math.cos(az) * math.cos(elevation), math.sin(az) * math.cos(elevation), math.sin(elevation)))
    return target + direction * distance, target, fov


def catmull_rom(p0, p1, p2, p3, t):
    """Centripetal Catmull-Rom between p1 and p2 (no loops or overshoot at tight corners)."""

    def knot(a, b, k):
        return k + max((b - a).length, 1e-4) ** 0.5

    t0 = 0.0
    t1 = knot(p0, p1, t0)
    t2 = knot(p1, p2, t1)
    t3 = knot(p2, p3, t2)
    u = lerp(t1, t2, t)
    a1 = p0 * ((t1 - u) / (t1 - t0)) + p1 * ((u - t0) / (t1 - t0))
    a2 = p1 * ((t2 - u) / (t2 - t1)) + p2 * ((u - t1) / (t2 - t1))
    a3 = p2 * ((t3 - u) / (t3 - t2)) + p3 * ((u - t2) / (t3 - t2))
    b1 = a1 * ((t2 - u) / (t2 - t0)) + a2 * ((u - t0) / (t2 - t0))
    b2 = a2 * ((t3 - u) / (t3 - t1)) + a3 * ((u - t1) / (t3 - t1))
    return b1 * ((t2 - u) / (t2 - t1)) + b2 * ((u - t1) / (t2 - t1))


open_eye, open_target, _ = opening(F_OPEN)
before_eye, before_target, _ = opening(F_OPEN * 0.6)
KEYS = [(F_OPEN, open_eye, open_target, OPEN_FOV), *SHOTS]
EYES = [before_eye, *[k[1] for k in KEYS]]
TARGETS = [before_target, *[k[2] for k in KEYS]]
# Phantom end points continue the last segment's direction.
EYES.append(EYES[-1] * 2 - EYES[-2])
TARGETS.append(TARGETS[-1] * 2 - TARGETS[-2])


def shot(f):
    """Camera position, look-at point and vertical FOV (degrees) at frame f."""
    if f <= F_OPEN:
        return opening(f)
    for i in range(len(KEYS) - 1):
        f0, _, _, fov0 = KEYS[i]
        f1, _, _, fov1 = KEYS[i + 1]
        if f <= f1:
            t = dwell((f - f0) / (f1 - f0))
            eye = catmull_rom(EYES[i], EYES[i + 1], EYES[i + 2], EYES[i + 3], t)
            target = catmull_rom(TARGETS[i], TARGETS[i + 1], TARGETS[i + 2], TARGETS[i + 3], t)
            return eye, target, lerp(fov0, fov1, ease(t))
    return KEYS[-1][1], KEYS[-1][2], KEYS[-1][3]


cam = bpy.data.objects.get('JourneyCam')
if not cam:
    cam = bpy.data.objects.new('JourneyCam', bpy.data.cameras.new('JourneyCam'))
    scene.collection.objects.link(cam)
cam.animation_data_clear()
cam.data.animation_data_clear()
cam.rotation_mode = 'QUATERNION'
cam.data.type = 'PERSP'
cam.data.sensor_fit = 'VERTICAL'
cam.data.sensor_height = 24
cam.data.clip_start = 0.05
cam.data.clip_end = 200
scene.frame_start, scene.frame_end = 0, F_END

previous = None
for f in range(F_END + 1):
    eye, target, fov = shot(f)
    q = (target - eye).to_track_quat('-Z', 'Y')
    # Keep neighbouring keys on the same side of the quaternion double cover so it never spins the long way.
    if previous is not None and previous.dot(q) < 0:
        q.negate()
    previous = q
    cam.location = eye
    cam.rotation_quaternion = q
    cam.data.lens = 12 / math.tan(math.radians(fov / 2))
    cam.keyframe_insert('location', frame=f)
    cam.keyframe_insert('rotation_quaternion', frame=f)
    cam.data.keyframe_insert('lens', frame=f)


# --- What changes along the way ---------------------------------------------------------------------------------------


def key_value(socket, frames_values):
    for frame, value in frames_values:
        socket.default_value = value
        socket.keyframe_insert('default_value', frame=frame)


def key_hidden(obj, first_visible):
    obj.animation_data_clear()
    for frame, hidden in ((0, True), (first_visible - 1, True), (first_visible, False)):
        obj.hide_render = hidden
        obj.keyframe_insert('hide_render', frame=frame)


sun = bpy.data.objects['Sun']
key_hidden(sun, F_SUN_IN)
sun_mat = bpy.data.materials['Sun']
sun_mat.node_tree.animation_data_clear()
key_value(sun_mat.node_tree.nodes['Emission'].inputs['Strength'], ((F_SUN_IN, 0.0), (F_SUN_FULL, 8.0)))

bow = bpy.data.objects['Rainbow']
key_hidden(bow, F_BOW_IN)
bow_mat = bpy.data.materials['Rainbow']
bow_mat.node_tree.animation_data_clear()
# The 0.8 multiplier on the bow's opacity (build-sky.py), labelled the first time so re-runs find it.
strength = next((n for n in bow_mat.node_tree.nodes if n.label == 'bow'), None)
if strength is None:
    strength = next(n for n in bow_mat.node_tree.nodes if n.type == 'MATH' and abs(n.inputs[1].default_value - 0.8) < 1e-6)
    strength.label = 'bow'
key_value(strength.inputs[1], ((F_BOW_IN, 0.0), (F_BOW_FULL, 0.8)))

# The studio key light warms as the sun comes out.
key = bpy.data.objects['StudioKey'].data
key.animation_data_clear()
for frame, colour in ((F_SUN_IN, (1.0, 1.0, 1.0)), (F_SUN_FULL, (1.0, 0.84, 0.66))):
    key.color = colour
    key.keyframe_insert('color', frame=frame)

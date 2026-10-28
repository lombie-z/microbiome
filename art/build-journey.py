"""Key the journey camera (JourneyCam) the scroll runs along: frame 0 is the hero, the last frame is the pool.
Re-runnable; it replaces JourneyCam's keys. Tweak the shape here (or nudge keys in Blender), then re-run export.
Run inside Blender with art/micro-biome.blend open:  exec(open('<repo>/art/build-journey.py').read())

Beats (frames):
  0-80     Open up: from the blog's near-orthographic hero, a dolly zoom (lens widens while the camera closes in, so the
           biome holds its size) and the view drops toward the rim.
  80-480   Kite: one descending turn around the falls, swinging in close past each main fall (A, then C, then B) and
           looking along it, down to the pool.
  480-600  Land: settle low over the pool, looking across it into the basin (where the close-up expansion goes).
"""
import math

import bpy
from mathutils import Vector

scene = bpy.context.scene
F_OPEN, F_KITE, F_END = 80, 480, 600
POOL_Z = -5.5
HERO_TARGET = Vector((0, 0, 0.92))
HERO_DIRECTION = Vector((-1, -1, 0.75)).normalized()  # the blog's view (PreviewCam)
HERO_FOV, OPEN_FOV, KITE_FOV, LAND_FOV = 6.0, 38.0, 40.0, 46.0
# Height of the view at the target, in metres: the hero shows the biome about as big as the blog does.
HERO_VIEW, OPEN_VIEW = 4.6, 3.2
# Main falls (as in build-spill.py): azimuth (degrees) of each column, where it leaves the outer face, and that face's
# normal. The kite swings close as it passes them.
FALLS = {
    'A': (-79.0, Vector((0.17, -0.5, 0)), Vector((0, -1, 0))),
    'C': (-15.0, Vector((0.5, -0.24, 0)), Vector((1, 0, 0))),
    'B': (171.0, Vector((-0.5, 0.14, 0)), Vector((-1, 0, 0))),
}


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return a + (b - a) * t


def fall_point(base, normal, z):
    """Where a main fall's column is at height z (it arcs outward as it drops, as in build-spill.py)."""
    return base + normal * math.sqrt(max(0.0, 0.51 - z) / 34.0) + Vector((0, 0, z))


def angle_gap(a, b):
    return (a - b + 180) % 360 - 180


def shot(f):
    """Camera position, look-at point and vertical FOV (degrees) at frame f."""
    if f <= F_OPEN:
        u = ease(f / F_OPEN)
        fov = lerp(HERO_FOV, OPEN_FOV, u)
        view = lerp(HERO_VIEW, OPEN_VIEW, u)
        distance = view / (2 * math.tan(math.radians(fov / 2)))
        elevation = lerp(math.asin(HERO_DIRECTION.z), math.radians(14), u)
        target = HERO_TARGET.lerp(Vector((0, 0, 0.45)), u)
        az = math.radians(-135)
        direction = Vector((math.cos(az) * math.cos(elevation), math.sin(az) * math.cos(elevation), math.sin(elevation)))
        return target + direction * distance, target, fov

    open_eye, open_target, _ = shot(F_OPEN)
    open_radius = (open_eye - open_target).xy.length
    open_height = open_eye.z - open_target.z

    if f <= F_KITE:
        s = (f - F_OPEN) / (F_KITE - F_OPEN)
        # Mostly even, eased at the ends.
        s = lerp(s, ease(s), 0.5)
        az = -135 + 360 * s
        # Descend with the water, always looking down along it so the pool is in view below.
        eye_z = lerp(open_eye.z, POOL_Z + 1.5, s)
        look_down = lerp(open_height, 1.6, ease(s / 0.3))
        target_z = eye_z - look_down
        # Swing in toward each main fall as the camera passes it, and look along that fall.
        pull, lean = 0.0, Vector((0, 0, 0))
        for fall_az, base, normal in FALLS.values():
            w = math.exp(-((angle_gap(az, fall_az) / 22) ** 2))
            pull += w
            lean += (fall_point(base, normal, target_z) - Vector((0, 0, target_z))) * w
        radius = lerp(open_radius, 2.5, ease(s / 0.25)) - 1.15 * min(1.0, pull)
        rad = math.radians(az)
        target = Vector((0, 0, target_z)) + lean * 0.9
        eye = Vector((math.cos(rad) * radius, math.sin(rad) * radius, eye_z))
        return eye, target, lerp(OPEN_FOV, KITE_FOV, ease(s / 0.2))

    # Land: settle above the shore, looking down into the pool.
    kite_eye, kite_target, _ = shot(F_KITE)
    u = ease((f - F_KITE) / (F_END - F_KITE))
    az = lerp(225, 255, u)
    radius = lerp(kite_eye.xy.length, 2.35, u)
    rad = math.radians(az)
    eye = Vector((math.cos(rad) * radius, math.sin(rad) * radius, lerp(kite_eye.z, POOL_Z + 1.2, u)))
    target = kite_target.lerp(Vector((0, 0, POOL_Z)), u)
    return eye, target, lerp(KITE_FOV, LAND_FOV, u)


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

for f in range(F_END + 1):
    eye, target, fov = shot(f)
    cam.location = eye
    cam.rotation_quaternion = (target - eye).to_track_quat('-Z', 'Y')
    cam.data.lens = 12 / math.tan(math.radians(fov / 2))
    cam.keyframe_insert('location', frame=f)
    cam.keyframe_insert('rotation_quaternion', frame=f)
    cam.data.keyframe_insert('lens', frame=f)

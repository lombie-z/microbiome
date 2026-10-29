"""FogDrog's road signs for the landing: a leftover green highway guide sign ("FogDrog | 2 km" under an up arrow) on two
galvanised posts, and a small yellow diamond crossing sign (a dog walking with a frog on its head) on one. Weathered in
the vertex colours (sun-faded paint, rust at the edges and bolts, grime run down from the top and the bolts), ivy
climbing a post and over a corner. Builds art/sign.blend from nothing and exports public/models/sign.glb (Draco).

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python art/build-sign.py

Optional: `-- --render <png>` also renders a close-up of both signs in a warm low light.

Blender z up; each sign stands at its object's origin (the ground or water line), its face toward -y (three's +z).
Lettering: Overpass Bold (OFL), art/fonts/Overpass-Bold.ttf, the wght=700 instance of google/fonts'
ofl/overpass/Overpass[wght].ttf (fontTools varLib.instancer). Colour in the 'Col' attribute (bytes, sRGB), '_metal' marks the
bare metal (posts, rails, bolts) for the site's material (components/three/sign.tsx).
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Color, Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FONT = os.path.join(HERE, 'fonts', 'Overpass-Bold.ttf')
BLEND = os.path.join(HERE, 'sign.blend')
GLB = os.path.join(REPO, 'public', 'models', 'sign.glb')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = argv[argv.index('--render') + 1] if '--render' in argv else None

rnd = random.Random(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def srgb(hex_):
    """A hex colour. ('Col' is a byte colour layer: bmesh reads and writes it as sRGB, as the landing's.)"""
    return Color([int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)])


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return Color((a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t))


def scale(c, k):
    return Color((c.r * k, c.g * k, c.b * k))


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def n3(x, y, z=0.0):
    """Perlin noise, 0 to 1."""
    return noise.noise(Vector((x, y, z))) * 0.5 + 0.5


# The palette (the brand's: sign green, white, rust, gold) and what weather does to it.
GREEN = srgb('#2E6A4F')
GREEN_FADED = srgb('#6E9A84')  # sun-bleached toward a chalky sea-green
WHITE = srgb('#F6EEE9')
RUST = srgb('#B0532F')
RUST_DARK = srgb('#5E2A16')
GRIME = srgb('#3A372B')
ALU = srgb('#B9B6AE')  # bare aluminium where the paint's chipped
ZINC = srgb('#A8ABA6')  # galvanised posts
ZINC_DARK = srgb('#6F716B')
ALGAE = srgb('#4E5A2A')
YELLOW = srgb('#E9B949')
YELLOW_FADED = srgb('#EFD38C')
INK = srgb('#1E1B17')
LEAF = srgb('#3F6E2A')
LEAF_LIT = srgb('#8DAE42')
LEAF_DARK = srgb('#2A4A1E')
LEAF_RED = srgb('#8A3B22')
STEM = srgb('#4A3A22')


class Builder:
    """One bmesh with the colour and metal layers; faces carry a material index (0 paint and metal, 1 ivy)."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new('Col')
        self.metal = self.bm.verts.layers.float.new('_metal')

    def face(self, verts, colour_fn, mat=0, smooth=True, metal=0.0):
        vs = [self.bm.verts.new(v) for v in verts]
        f = self.bm.faces.new(vs)
        self.paint(f, colour_fn, mat, smooth, metal)
        return f

    def paint(self, f, colour_fn, mat=0, smooth=True, metal=0.0):
        f.material_index = mat
        f.smooth = smooth
        for loop in f.loops:
            c = colour_fn(loop.vert.co) if callable(colour_fn) else colour_fn
            loop[self.col] = (c.r, c.g, c.b, 1.0)
            loop.vert[self.metal] = metal

    def finish(self, name, materials):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in materials:
            me.materials.append(m)
        attr = me.color_attributes['Col']
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
        o = bpy.data.objects.new(name, me)
        scene.collection.objects.link(o)
        print(name, 'faces', len(me.polygons))
        return o


def material(name, roughness, metallic=0.0):
    """Vertex-coloured, as the landing's: the colour lives in 'Col'."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat


PAINT = material('SignPaint', 0.6)
IVY = material('SignIvy', 0.55)
IVY.use_backface_culling = False


# --- Shared parts -----------------------------------------------------------------------------------------------------


def rounded_point(u, v, hw, hh, r):
    """Maps a point of the w x h rectangle (centred) onto the same rectangle with corners rounded to r: the corner squares
    are squeezed onto quarter discs (Chebyshev to Euclidean), so a regular grid stays a clean grid."""
    cu, cv = hw - r, hh - r
    if abs(u) > cu and abs(v) > cv:
        cx, cy = math.copysign(cu, u), math.copysign(cv, v)
        dx, dy = u - cx, v - cy
        d = math.hypot(dx, dy)
        if d > 1e-9:
            k = max(abs(dx), abs(dy)) / d
            return cx + dx * k, cy + dy * k, Vector((dx, dy)).normalized()
    if abs(u) >= hw - 1e-9:
        return u, v, Vector((math.copysign(1, u), 0))
    return u, v, Vector((0, math.copysign(1, v)))


def rounded_outline(hw, hh, r, per_corner=8, step=0.05):
    """The outline of a rounded rectangle, counter-clockwise from the right edge's middle."""
    pts = []
    for cx, cy, a0 in ((hw - r, hh - r, 0), (-(hw - r), hh - r, 90), (-(hw - r), -(hh - r), 180), (hw - r, -(hh - r), 270)):
        for i in range(per_corner + 1):
            a = math.radians(a0 + 90 * i / per_corner)
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    # Straight runs split into short pieces, so the band follows the face's bow and dents.
    out = []
    for k, (x, y) in enumerate(pts):
        nx, ny = pts[(k + 1) % len(pts)]
        n = max(1, round(math.hypot(nx - x, ny - y) / step))
        out += [(x + (nx - x) * i / n, y + (ny - y) * i / n) for i in range(n)]
    return out


def panel(b, to_world, hw, hh, r, nu, nv, surface, colour, back_colour):
    """A sign blank: a gridded face (so it can dent and carry weathering), its edge rolled back in a half-round lip, and a
    flat back. to_world(u, v, depth) -> Vector places panel coordinates; surface(u, v) is how far the face is pushed back
    (dents, bow); colour(u, v, edge) colours the face, edge being the distance in from the rim."""
    grid = []
    edge_info = {}
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            u0 = -hw + 2 * hw * i / nu
            v0 = -hh + 2 * hh * j / nv
            u, v, n = rounded_point(u0, v0, hw, hh, r)
            vert = b.bm.verts.new(to_world(u, v, surface(u, v)))
            row.append(vert)
            if i in (0, nu) or j in (0, nv):
                edge_info[vert] = (u, v, n)
        grid.append(row)

    def edge_dist(u, v):
        # Distance in from the rounded rim.
        cu, cv = hw - r, hh - r
        du, dv = max(abs(u) - cu, 0), max(abs(v) - cv, 0)
        if du > 0 and dv > 0:
            return r - math.hypot(du, dv)
        return min(hw - abs(u), hh - abs(v))

    uv = {}
    for j in range(nv + 1):
        for i in range(nu + 1):
            u0 = -hw + 2 * hw * i / nu
            v0 = -hh + 2 * hh * j / nv
            u, v, _ = rounded_point(u0, v0, hw, hh, r)
            uv[grid[j][i]] = (u, v)
    for j in range(nv):
        for i in range(nu):
            q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
            if len({tuple(round(c, 6) for c in x.co) for x in q}) < 3:
                continue
            f = b.bm.faces.new(q)
            f.material_index = 0
            f.smooth = True
            for loop in f.loops:
                u, v = uv[loop.vert]
                c = colour(u, v, edge_dist(u, v))
                loop[b.col] = (c.r, c.g, c.b, 1.0)
    # The rim, in order round the outline.
    ring = [grid[0][i] for i in range(nu + 1)] + [grid[j][nu] for j in range(1, nv + 1)]
    ring += [grid[nv][i] for i in range(nu - 1, -1, -1)] + [grid[j][0] for j in range(nv - 1, 0, -1)]
    # Drop the duplicates the rounding made at the corners.
    clean = []
    for vtx in ring:
        if not clean or (clean[-1].co - vtx.co).length > 1e-6:
            clean.append(vtx)
    if (clean[0].co - clean[-1].co).length < 1e-6:
        clean.pop()
    thickness = 0.026
    steps = 4
    loops = [clean]
    for s in range(1, steps + 1):
        th = math.pi * s / steps
        layer = []
        for vtx in clean:
            u, v, n = edge_info[vtx]
            out = math.sin(th) * thickness * 0.5
            depth = (1 - math.cos(th)) * thickness * 0.5
            layer.append(b.bm.verts.new(to_world(u + n.x * out, v + n.y * out, surface(u, v) + depth)))
        loops.append(layer)
    for s in range(steps):
        a, c = loops[s], loops[s + 1]
        for k in range(len(a)):
            k2 = (k + 1) % len(a)
            f = b.bm.faces.new([a[k2], a[k], c[k], c[k2]])
            u, v, _ = edge_info[clean[k]]
            b.paint(f, lambda co, u=u, v=v, s=s: colour(u, v, 0.0) if s < 2 else back_colour)
    back = b.bm.faces.new(list(reversed(loops[-1])))
    b.paint(back, back_colour, smooth=False)
    return edge_dist


def tube(b, path, radius, sides, colour_fn, mat=0, metal=0.0, cap=True):
    """A tube along a polyline of Vectors."""
    rings = []
    for k, p in enumerate(path):
        t = (path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]).normalized()
        a = t.orthogonal().normalized()
        c = t.cross(a)
        rad = radius(k / max(len(path) - 1, 1)) if callable(radius) else radius
        rings.append([b.bm.verts.new(p + (a * math.cos(2 * math.pi * s / sides) + c * math.sin(2 * math.pi * s / sides)) * rad) for s in range(sides)])
    for k in range(len(rings) - 1):
        for s in range(sides):
            s2 = (s + 1) % sides
            f = b.bm.faces.new([rings[k][s], rings[k][s2], rings[k + 1][s2], rings[k + 1][s]])
            b.paint(f, colour_fn, mat, True, metal)
    if cap:
        f = b.bm.faces.new(list(reversed(rings[-1])))
        b.paint(f, colour_fn, mat, False, metal)


def post(b, x, y, z0, z1, r, seed):
    """A galvanised round post: dull spangled zinc, dark and green at the water line, rust where the coating's gone."""
    sides, rings = 12, max(8, int((z1 - z0) / 0.12))

    def colour(co):
        h = co.z
        c = mix(ZINC, ZINC_DARK, n3(co.x * 9 + seed, co.y * 9, h * 2.5) * 0.9)
        # Rust freckles and runs, more of them low down.
        rust = smoothstep(0.62, 0.78, n3(co.x * 30 + seed, co.y * 30, h * 6)) * (0.4 + 0.6 * smoothstep(1.2, -0.2, h))
        c = mix(c, mix(RUST, RUST_DARK, n3(h * 20, seed)), rust)
        # The water line: wet, dark, a skin of algae just above it.
        wet = smoothstep(0.35, -0.05, h)
        c = mix(c, scale(ALGAE, 0.7), wet * 0.85)
        c = mix(c, scale(c, 0.45), smoothstep(-0.05, -0.3, h))
        return c

    path = [Vector((x, y, z0 + (z1 - z0) * k / rings)) for k in range(rings + 1)]
    tube(b, path, r, sides, colour, metal=1.0)
    # A cap on top.
    return colour


def bolt(b, centre, normal, r, colour):
    """A carriage-bolt head: a low dome on the face."""
    n = normal.normalized()
    a = n.orthogonal().normalized()
    c = n.cross(a)
    segs, rings = 8, 3
    top = b.bm.verts.new(centre + n * r * 0.55)
    prev = None
    layers = []
    for k in range(rings):
        th = (math.pi / 2) * (1 - (k + 1) / (rings + 0.0))
        rr = r * math.cos(th) if k < rings - 1 else r
        hh = r * 0.55 * math.sin(th)
        layers.append([b.bm.verts.new(centre + n * hh + (a * math.cos(2 * math.pi * s / segs) + c * math.sin(2 * math.pi * s / segs)) * rr) for s in range(segs)])
    for s in range(segs):
        f = b.bm.faces.new([top, layers[0][s], layers[0][(s + 1) % segs]])
        b.paint(f, colour, metal=1.0)
    for k in range(rings - 1):
        for s in range(segs):
            s2 = (s + 1) % segs
            f = b.bm.faces.new([layers[k][s], layers[k + 1][s], layers[k + 1][s2], layers[k][s2]])
            b.paint(f, colour, metal=1.0)
    del prev


def box(b, lo, hi, colour, metal=1.0):
    bm = b.bm
    v = [bm.verts.new((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y) for z in (lo.z, hi.z)]
    for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        f = bm.faces.new([v[i] for i in q])
        b.paint(f, colour, smooth=False, metal=metal)


def text_mesh(body, size, extrude=0.0035):
    """Overpass Bold set in metres, as a mesh in its own plane (x along, y up, z out of the face), without its back."""
    font = bpy.data.fonts.load(FONT, check_existing=True)
    cu = bpy.data.curves.new('T', 'FONT')
    cu.body = body
    cu.font = font
    cu.size = size
    cu.extrude = extrude
    cu.resolution_u = 5
    ob = bpy.data.objects.new('T', cu)
    scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bm.normal_update()
    # The back of the letters is against the sign: not needed.
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.9], context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    return bm


def stamp(b, src, place, colour_fn, mat=0):
    """Copies a bmesh's faces into the builder through place(co) -> Vector, flat-shaded."""
    vmap = {v: b.bm.verts.new(place(v.co)) for v in src.verts}
    for f in src.faces:
        nf = b.bm.faces.new([vmap[v] for v in f.verts])
        b.paint(nf, colour_fn, mat, smooth=False)
    src.free()


def flat_poly(pts):
    """A flat shape, wound counter-clockwise so it faces the viewer once stood on the sign."""
    if sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1])) < 0:
        pts = pts[::-1]
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0)) for x, y in pts]
    bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm


def ellipse(cx, cy, rx, ry, rot=0.0, n=14):
    c, s = math.cos(rot), math.sin(rot)
    return [(cx + rx * math.cos(2 * math.pi * k / n) * c - ry * math.sin(2 * math.pi * k / n) * s,
             cy + rx * math.cos(2 * math.pi * k / n) * s + ry * math.sin(2 * math.pi * k / n) * c) for k in range(n)]


# Ivy: Hedera's five-lobed leaf, base at the origin, tip at +y, length 1.
LEAF_OUTLINE = [(0.0, 0.06), (0.3, -0.04), (0.55, 0.2), (0.34, 0.38), (0.4, 0.66), (0.0, 1.0), (-0.4, 0.66), (-0.34, 0.38),
                (-0.55, 0.2), (-0.3, -0.04)]


def leaf(b, base, up, out, size, tint):
    """One ivy leaf on its stalk: lying along up, facing out, creased a little down the midrib."""
    out = out.normalized()
    up = (up - out * up.dot(out)).normalized()
    side = up.cross(out)
    centre = base + up * 0.42 * size + out * 0.1 * size
    lift = out * 0.07 * size
    vc = b.bm.verts.new(centre)
    ring = []
    for x, y in LEAF_OUTLINE:
        # The lobes curl back a little, the blade cupped.
        p = base + side * x * size + up * y * size - out * (abs(x) * 0.12 * size) + lift * 0.3
        ring.append(b.bm.verts.new(p))
    lit = n3(base.x * 3, base.y * 3, base.z * 3)
    for k in range(len(ring)):
        f = b.bm.faces.new([vc, ring[k], ring[(k + 1) % len(ring)]])

        def colour(co, k=k):
            edge = (co - centre).length / size
            c = mix(tint, scale(tint, 0.8), smoothstep(0.1, 0.55, edge))
            # The veins: paler toward the middle.
            return mix(c, mix(tint, LEAF_LIT, 0.5), 0.35 * smoothstep(0.2, 0.0, edge) + 0.15 * lit)

        b.paint(f, colour, mat=1, smooth=True)


def leaf_tint():
    roll = rnd.random()
    if roll < 0.08:
        return mix(LEAF_RED, LEAF, rnd.uniform(0, 0.4))  # a few turning
    if roll < 0.3:
        return mix(LEAF, LEAF_LIT, rnd.uniform(0.3, 0.8))  # young, yellow-green
    return mix(LEAF_DARK, LEAF, rnd.uniform(0.3, 1.0))


def vine(b, path, leaves_every, size, out_fn):
    """A stem along path with leaves on alternating sides; out_fn(p) is the surface's outward normal there."""
    tube(b, path, lambda t: 0.007 * (1.2 - 0.6 * t), 4, lambda co: STEM, mat=1, cap=False)
    total = 0.0
    side = 1
    for k in range(1, len(path)):
        seg = path[k] - path[k - 1]
        total += seg.length
        while total > leaves_every:
            total -= leaves_every
            p = path[k] - seg.normalized() * total
            out = out_fn(p)
            along = seg.normalized()
            across = along.cross(out).normalized() * side
            side = -side
            s = size * rnd.uniform(0.7, 1.25) * (0.75 + 0.25 * (k / len(path)))
            up = (along * 0.3 + across * 0.9 + Vector((0, 0, 0.5)) + Vector((rnd.uniform(-0.3, 0.3), 0, rnd.uniform(-0.2, 0.3)))).normalized()
            o = (out + Vector((rnd.uniform(-0.35, 0.35), rnd.uniform(-0.35, 0.35), rnd.uniform(0.0, 0.5)))).normalized()
            leaf(b, p + across * 0.012, up, o, s, leaf_tint())


# --- The guide sign ---------------------------------------------------------------------------------------------------

W, H = 3.2, 1.15
HW, HH = W / 2, H / 2
Z0 = 2.3  # the panel's foot above the ground or water (a tall sign, as on a highway verge)
ZC = Z0 + HH
POSTS = (-0.95, 0.95)
POST_R = 0.048
RAIL_Y = 0.026  # behind the panel
POST_Y = RAIL_Y + 0.04 + POST_R
RAILS = (-0.33, 0.33)  # rail heights on the panel (v)


def guide_surface(u, v):
    """How far the face is pushed back at (u, v): a slight bow, a dent low on the left (something hit it), and the top
    right corner bent back."""
    y = 0.012 * (u / HW) ** 2
    d = math.hypot((u + 0.62) / 1.2, (v + 0.4) / 0.85)
    y += 0.02 * math.exp(-(d / 0.14) ** 2)
    y += 0.006 * math.exp(-(((u + 0.62 - (v + 0.4) * 0.6) / 0.03) ** 2)) * math.exp(-(d / 0.2) ** 2)  # the crease
    k = max(0.0, (u - (HW - 0.42)) / 0.42 + (v - (HH - 0.3)) / 0.3 - 1.0)
    y += 0.07 * k * k
    return y


def guide_world(u, v, depth):
    return Vector((u, depth, ZC + v))


BOLTS = [(x, v) for x in POSTS for v in RAILS]


def grime(u, v, top):
    """Dirt run down the face: streaks from the top edge and from each bolt (0 to 1)."""
    streak = smoothstep(0.45, 0.8, n3(u * 16, v * 0.9, 3.1)) * smoothstep(HH - 0.75, HH, v) * 0.9
    for bx, bv in BOLTS:
        if v < bv:
            streak += math.exp(-((u - bx) / (0.025 + 0.02 * (bv - v))) ** 2) * smoothstep(-1.0, 0.0, v - bv) * 0.8
    return min(1.0, streak) * top


def rust_at(u, v, edge):
    r = smoothstep(0.055, 0.0, edge) * smoothstep(0.45, 0.68, n3(u * 7, v * 7, 1.3))
    for bx, bv in BOLTS:
        d = math.hypot(u - bx, v - bv)
        r += smoothstep(0.075, 0.02, d) * (0.6 + 0.4 * n3(u * 40, v * 40))
        if v < bv:
            r += 0.55 * math.exp(-((u - bx) / 0.018) ** 2) * smoothstep(-0.32, 0.0, v - bv)
    return min(1.0, r)


def guide_colour(u, v, edge):
    fade = 0.22 + 0.4 * smoothstep(-0.6, HH, v) + 0.25 * (n3(u * 1.4, v * 1.4, 8) - 0.5) + 0.2 * smoothstep(0.5, 1.5, u)
    c = mix(GREEN, GREEN_FADED, fade)
    c = mix(c, scale(c, 0.82), n3(u * 5, v * 5, 2) * 0.6)  # blotchy chalking
    chips = smoothstep(0.74, 0.82, n3(u * 22, v * 22, 5)) * (0.3 + 0.7 * smoothstep(0.12, 0.0, edge))
    c = mix(c, ALU, chips * 0.85)
    c = mix(c, GRIME, grime(u, v, 0.55))
    r = rust_at(u, v, edge)
    c = mix(c, mix(RUST, RUST_DARK, n3(u * 30, v * 30, 9)), r)
    return c


def guide_white(co):
    u, v = co.x, co.z - ZC
    c = mix(WHITE, scale(WHITE, 0.86), n3(u * 6, v * 6, 4))
    c = mix(c, mix(WHITE, GREEN_FADED, 0.4), 0.15)  # a film of green from the paint around it
    c = mix(c, GRIME, grime(u, v, 0.45))
    c = mix(c, RUST, 0.8 * min(1.0, sum(0.55 * math.exp(-((u - bx) / 0.018) ** 2) * smoothstep(-0.32, 0.0, v - bv) for bx, bv in BOLTS if v < bv)))
    return c


def on_guide(u, v, lift):
    """A point on the face (following its dents), lifted toward the viewer."""
    return guide_world(u, v, guide_surface(u, v) - lift)


g = Builder()
panel(g, guide_world, HW, HH, 0.1, 84, 30, guide_surface, guide_colour, scale(ZINC_DARK, 0.9))

# The border: a white band just inside the rim.
outer = rounded_outline(HW - 0.05, HH - 0.05, 0.065)
inner = rounded_outline(HW - 0.095, HH - 0.095, 0.025)
assert len(inner) == len(outer)
for k in range(len(outer)):
    k2 = (k + 1) % len(outer)
    quad = [inner[k], outer[k], outer[k2], inner[k2]]
    g.face([on_guide(u, v, 0.002) for u, v in quad], guide_white, smooth=False)

# The lettering: FogDrog on the left, a divider, and the right-hand block, an up arrow over "2 km".
LEFT, RIGHT = -HW + 0.17, 0.5
word = text_mesh('FogDrog', 1.0)
xs = [v.co.x for v in word.verts]
ys = [v.co.y for v in word.verts]
k_size = (RIGHT - LEFT) / (max(xs) - min(xs))
cap = text_mesh('F', 1.0)
cap_h = max(v.co.y for v in cap.verts)
cap.free()
# Centre the capitals on the panel (the g's descenders hang below), a touch high.
base_v = -cap_h * k_size / 2 + 0.06
x0 = min(xs)
stamp(g, word, lambda co: on_guide(LEFT + (co.x - x0) * k_size, base_v + co.y * k_size, 0.002 + co.z), guide_white)
print('FogDrog cap height', cap_h * k_size, 'width', RIGHT - LEFT)

# The divider.
DIV = RIGHT + 0.16
g.face([on_guide(DIV - 0.016, -0.37, 0.002), on_guide(DIV + 0.016, -0.37, 0.002), on_guide(DIV + 0.016, 0.37, 0.002),
        on_guide(DIV - 0.016, 0.37, 0.002)], guide_white, smooth=False)

# The arrow: a highway arrow, shaft and broad head.
AX = (DIV + HW - 0.085) / 2
arrow = [(-0.04, -0.02), (0.04, -0.02), (0.04, 0.2), (0.125, 0.2), (0.0, 0.36), (-0.125, 0.2), (-0.04, 0.2)]
bm = flat_poly(arrow)
stamp(g, bm, lambda co: on_guide(AX + co.x, co.y, 0.003), guide_white)
km = text_mesh('2 km', 1.0)
kx = [v.co.x for v in km.verts]
km_size = 0.24 / cap_h
km_w = (max(kx) - min(kx)) * km_size
stamp(g, km, lambda co: on_guide(AX - km_w / 2 + (co.x - min(kx)) * km_size, -0.33 + co.y * km_size, 0.002 + co.z * 0.6), guide_white)


def bolt_colour(co):
    return mix(mix(ZINC_DARK, RUST, 0.55), RUST_DARK, n3(co.x * 80, co.z * 80))


for bx, bv in BOLTS:
    bolt(g, on_guide(bx, bv, 0.0), Vector((0, -1, 0)), 0.02, bolt_colour)

# Behind: two rails across the back, bolted to the posts by clamps.
for rv in RAILS:
    box(g, Vector((-HW + 0.12, RAIL_Y, ZC + rv - 0.03)), Vector((HW - 0.12, RAIL_Y + 0.04, ZC + rv + 0.03)),
        lambda co: mix(ZINC_DARK, RUST_DARK, smoothstep(0.55, 0.75, n3(co.x * 12, co.z * 12))))
    for px in POSTS:
        box(g, Vector((px - POST_R - 0.012, RAIL_Y + 0.035, ZC + rv - 0.045)), Vector((px + POST_R + 0.012, POST_Y + POST_R + 0.012, ZC + rv + 0.045)),
            lambda co: mix(ZINC_DARK, RUST, 0.5 * n3(co.x * 40, co.z * 40)))

# The posts, sunk well into the ground (or the water).
for k, px in enumerate(POSTS):
    post(g, px, POST_Y, -1.2, Z0 + H + 0.04, POST_R, k * 10.0)


# Ivy: up the left post from the water, out onto the panel's lower-left corner and over it, along the top edge a way;
# a second, younger stem a little way up the right post.
def post_spiral(px, z0, z1, turns, phase):
    pts = []
    n = int((z1 - z0) / 0.05)
    for k in range(n + 1):
        t = k / n
        a = phase + turns * 2 * math.pi * t
        r = POST_R + 0.012
        pts.append(Vector((px + math.cos(a) * r, POST_Y + math.sin(a) * r, z0 + (z1 - z0) * t)))
    return pts


def post_out(px):
    return lambda p: Vector((p.x - px, p.y - POST_Y, 0)).normalized()


left_up = post_spiral(POSTS[0], -0.15, Z0 - 0.02, 1.6, -1.2)
vine(g, left_up, 0.07, 0.12, post_out(POSTS[0]))
# Onto the face: up the left of the panel, round the top-left corner and along the top a little.
face_path = [left_up[-1]]
for k in range(1, 44):
    t = k / 43
    # Along the bottom rim to the corner, up the left margin, over the top-left corner and along the top border.
    if t < 0.25:
        s = t / 0.25
        u = POSTS[0] - 0.62 * s
        v = -HH + 0.02 + 0.03 * s
    elif t < 0.6:
        s = (t - 0.25) / 0.35
        u = -HW + 0.06 - 0.03 * math.sin(s * 3)
        v = -HH + 0.05 + (H - 0.12) * s
    else:
        s = (t - 0.6) / 0.4
        u = -HW + 0.08 + 1.1 * s
        v = HH - 0.035 + 0.02 * math.sin(s * 7)
    face_path.append(on_guide(u, v, 0.014))
vine(g, face_path, 0.04, 0.16, lambda p: Vector((-0.15, -1, 0.25)).normalized())
# A strand trailing down from the corner, over the panel's edge.
hang = [on_guide(-HW + 0.02, HH - 0.15, 0.014)]
for k in range(1, 12):
    hang.append(hang[0] + Vector((-0.03 * k - 0.01 * k * k * 0.1, -0.012 * k, -0.06 * k)))
vine(g, hang, 0.05, 0.13, lambda p: Vector((-0.4, -1, 0.1)).normalized())
right_up = post_spiral(POSTS[1], -0.15, 0.95, 1.0, 0.6)
vine(g, right_up, 0.08, 0.1, post_out(POSTS[1]))
# A clump at the left post's foot.
for k in range(14):
    a = rnd.uniform(0, 2 * math.pi)
    base = Vector((POSTS[0] + math.cos(a) * 0.09, POST_Y + math.sin(a) * 0.09, rnd.uniform(-0.05, 0.25)))
    leaf(g, base, Vector((math.cos(a) * 0.4, math.sin(a) * 0.4, 1)), Vector((math.cos(a), math.sin(a), 0.6)), 0.13, leaf_tint())

guide = g.finish('Sign', [PAINT, IVY])

# --- The crossing sign ------------------------------------------------------------------------------------------------
# A yellow diamond on one post: a dog walking, a frog riding on its head.

D = 0.78  # side
DH = D / 2
DZ = 1.6  # centre height
DPOST_R = 0.035
DPOST_Y = 0.026 + 0.03 + DPOST_R
ROT = math.radians(45)


def diamond_world(u, v, depth):
    # Panel coordinates are the square's own; turned 45 degrees onto the post.
    x = u * math.cos(ROT) - v * math.sin(ROT)
    z = u * math.sin(ROT) + v * math.cos(ROT)
    return Vector((x, depth, DZ + z))


def diamond_surface(u, v):
    x = u * math.cos(ROT) - v * math.sin(ROT)
    # Bent a little at its bottom corner (from the right), and bowed.
    k = max(0.0, (-(u * math.sin(ROT) + v * math.cos(ROT)) - 0.32) / 0.22)
    return 0.008 * (x / 0.55) ** 2 + 0.05 * k * k


D_BOLTS = [(0.0, 0.28), (0.0, -0.28)]  # on the post, in the sign's x/z (centre-relative)


def d_grime(x, z):
    s = smoothstep(0.5, 0.82, n3(x * 18, z * 0.9, 13)) * smoothstep(-0.1, 0.5, z) * 0.7
    for bx, bz in D_BOLTS:
        if z < bz:
            s += math.exp(-((x - bx) / (0.02 + 0.02 * (bz - z))) ** 2) * smoothstep(-0.6, 0.0, z - bz) * 0.7
    return min(1.0, s)


def diamond_colour(u, v, edge):
    x = u * math.cos(ROT) - v * math.sin(ROT)
    z = u * math.sin(ROT) + v * math.cos(ROT)
    c = mix(YELLOW, YELLOW_FADED, 0.25 + 0.45 * smoothstep(-0.3, 0.55, z) + 0.3 * (n3(x * 3, z * 3, 20) - 0.5))
    c = mix(c, scale(c, 0.8), n3(x * 6, z * 6, 21) * 0.5)
    c = mix(c, ALU, smoothstep(0.75, 0.83, n3(x * 25, z * 25, 22)) * (0.3 + 0.7 * smoothstep(0.08, 0.0, edge)))
    c = mix(c, GRIME, d_grime(x, z) * 0.6)
    r = smoothstep(0.05, 0.0, edge) * smoothstep(0.35, 0.6, n3(x * 8, z * 8, 23))
    for bx, bz in D_BOLTS:
        r += smoothstep(0.06, 0.015, math.hypot(x - bx, z - bz))
        if z < bz:
            r += 0.5 * math.exp(-((x - bx) / 0.014) ** 2) * smoothstep(-0.25, 0.0, z - bz)
    return mix(c, mix(RUST, RUST_DARK, n3(x * 30, z * 30, 24)), min(1.0, r))


def diamond_colour_at(x, z):
    u = x * math.cos(ROT) + z * math.sin(ROT)
    v = -x * math.sin(ROT) + z * math.cos(ROT)
    return diamond_colour(u, v, 1.0)


def on_diamond(x, z, lift):
    """A point on the diamond's face given in the sign's own x (right) and z (up), from its centre."""
    u = x * math.cos(ROT) + z * math.sin(ROT)
    v = -x * math.sin(ROT) + z * math.cos(ROT)
    return Vector((x, diamond_surface(u, v) - lift, DZ + z))


def ink(co):
    x, z = co.x, co.z - DZ
    c = mix(INK, scale(INK, 1.8), n3(x * 12, z * 12, 30) * 0.6)
    return mix(c, mix(YELLOW_FADED, GRIME, 0.5), 0.12 + 0.2 * d_grime(x, z))


d = Builder()
panel(d, diamond_world, DH, DH, 0.045, 30, 30, diamond_surface, diamond_colour, scale(ZINC_DARK, 0.9))
# The black border, in the square's own coordinates.
outer = rounded_outline(DH - 0.03, DH - 0.03, 0.04)
inner = rounded_outline(DH - 0.055, DH - 0.055, 0.02)
assert len(inner) == len(outer)


def from_square(u, v, lift):
    x = u * math.cos(ROT) - v * math.sin(ROT)
    z = u * math.sin(ROT) + v * math.cos(ROT)
    return on_diamond(x, z, lift)


for k in range(len(outer)):
    k2 = (k + 1) % len(outer)
    d.face([from_square(u, v, 0.002) for u, v in (inner[k], outer[k], outer[k2], inner[k2])], ink, smooth=False)

# The pictogram, in the sign's x/z (metres from its centre), walking right: a retriever, tail out, one foreleg
# raised; a frog sitting on its head.
S = 0.82  # scale of the drawing (designed about 0.68 wide)
dog = [
    # One outline: plumed tail, back, the head held level with a long muzzle, chest, belly, rump.
    [(-0.33, 0.06), (-0.27, 0.085), (-0.2, 0.055), (-0.1, 0.065), (0.06, 0.065), (0.12, 0.11), (0.16, 0.175), (0.22, 0.19),
     (0.265, 0.165), (0.335, 0.135), (0.35, 0.11), (0.33, 0.09), (0.25, 0.085), (0.2, 0.05), (0.18, -0.01), (0.14, -0.065),
     (0.06, -0.075), (-0.06, -0.08), (-0.16, -0.06), (-0.21, -0.01), (-0.205, 0.03), (-0.26, 0.04), (-0.31, 0.03)],
    # Legs: the near foreleg raised mid-step, the far one planted; the hind legs angled back, one planted, one pushing off.
    [(0.1, -0.05), (0.155, -0.045), (0.19, -0.115), (0.215, -0.16), (0.2, -0.18), (0.165, -0.165), (0.14, -0.115), (0.105, -0.085)],
    [(0.055, -0.05), (0.11, -0.06), (0.1, -0.225), (0.115, -0.245), (0.06, -0.245), (0.06, -0.12)],
    [(-0.21, -0.0), (-0.12, -0.03), (-0.13, -0.1), (-0.15, -0.225), (-0.13, -0.245), (-0.19, -0.245), (-0.19, -0.12), (-0.23, -0.06)],
    [(-0.14, -0.05), (-0.08, -0.06), (-0.06, -0.12), (-0.035, -0.215), (-0.02, -0.24), (-0.07, -0.24), (-0.1, -0.13)],
]
# The frog, sat up on the dog's head, kept apart from it by a sliver of yellow so the two read as two.
frog = [
    ellipse(0.205, 0.235, 0.06, 0.036, -0.12, 14),  # body, squat
    ellipse(0.175, 0.272, 0.019, 0.019, 0.0, 10),  # the eye bumps
    ellipse(0.232, 0.266, 0.019, 0.019, 0.0, 10),
    ellipse(0.155, 0.218, 0.03, 0.022, 0.4, 10),  # haunch
]
gap = [ellipse(0.2, 0.235, 0.075, 0.048, -0.12, 16)]


def figure(shapes, lift, colour):
    for shape in shapes:
        bm = flat_poly([(x * S, y * S) for x, y in shape])
        stamp(d, bm, lambda co: on_diamond(co.x, co.y - 0.03, lift), colour)


figure(dog, 0.0025, ink)
figure(gap, 0.003, lambda co: diamond_colour_at(co.x, co.z - DZ))
figure(frog, 0.0035, ink)

for bx, bz in D_BOLTS:
    bolt(d, on_diamond(bx, bz, 0.0), Vector((0, -1, 0)), 0.016, bolt_colour)
for bz in (0.28, -0.28):
    box(d, Vector((-DPOST_R - 0.01, 0.024, DZ + bz - 0.03)), Vector((DPOST_R + 0.01, DPOST_Y + DPOST_R + 0.01, DZ + bz + 0.03)),
        lambda co: mix(ZINC_DARK, RUST, 0.5 * n3(co.x * 40, co.z * 40)))
post(d, 0.0, DPOST_Y, -1.2, DZ + 0.3, DPOST_R, 30.0)
POST_X_D = 0.0
POST_R_SAVE, POST_Y_SAVE = POST_R, POST_Y
# Ivy up its post, and over the diamond's left corner.
up = []
n = 36
for k in range(n + 1):
    t = k / n
    a = 0.4 + 2.4 * math.pi * t
    r = DPOST_R + 0.012
    up.append(Vector((math.cos(a) * r, DPOST_Y + math.sin(a) * r, -0.1 + (DZ - DH * 1.2 + 0.05) * t)))
vine(d, up, 0.07, 0.1, lambda p: Vector((p.x, p.y - DPOST_Y, 0)).normalized())
over = [up[-1]]
for k in range(1, 18):
    t = k / 17
    x = -0.06 - 0.36 * t
    z = -DH * 1.2 + 0.08 + 0.55 * t + 0.04 * math.sin(t * 9)
    over.append(on_diamond(x, z, 0.012))
vine(d, over, 0.055, 0.1, lambda p: Vector((-0.2, -1, 0.3)).normalized())

diamond = d.finish('Diamond', [PAINT, IVY])
diamond.location = (2.6, 0.6, 0)

# --- Save and export --------------------------------------------------------------------------------------------------

bpy.ops.wm.save_as_mainfile(filepath=BLEND)
for o in scene.objects:
    o.select_set(o.name in ('Sign', 'Diamond'))
bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', use_selection=True, export_apply=True, export_vertex_color='ACTIVE',
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                          export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_color_quantization=8,
                          export_yup=True, export_cameras=False, export_lights=False, export_attributes=True, export_materials='EXPORT')
print('exported', GLB, os.path.getsize(GLB), 'faces', sum(len(o.data.polygons) for o in (guide, diamond)),
      'triangles', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in (guide, diamond)))

# --- A close-up --------------------------------------------------------------------------------------------------------

if RENDER:
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1400, 900
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('Dusk')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (1.0, 0.62, 0.55, 1)
    bg.inputs['Strength'].default_value = 0.9
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.0
    sun.data.color = (1.0, 0.78, 0.6)
    sun.rotation_euler = (math.radians(75), 0, math.radians(-140))
    scene.collection.objects.link(sun)
    ground = bpy.data.meshes.new('Water')
    bmw = bmesh.new()
    bmesh.ops.create_grid(bmw, x_segments=1, y_segments=1, size=20)
    bmw.to_mesh(ground)
    bmw.free()
    water = bpy.data.objects.new('Water', ground)
    wm = bpy.data.materials.new('Water')
    wm.use_nodes = True
    wm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.5, 0.33, 0.3, 1)
    wm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.08
    ground.materials.append(wm)
    water.location.z = 0.35
    scene.collection.objects.link(water)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.lens = 40
    cam.location = (0.7, -6.6, 2.5)
    cam.rotation_euler = (math.radians(88), 0, math.radians(4))
    # As the site draws them: one-sided, so a face wound the wrong way shows up here.
    PAINT.use_backface_culling = True
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.filepath = RENDER
    bpy.ops.render.render(write_still=True)
    print('rendered', RENDER)

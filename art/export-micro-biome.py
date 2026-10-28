"""Export the micro biome for the web: freeze modifiers, decimate heavy parts, bake AO into vertex colours,
write the glb and the transparent fallback still. Does not save the .blend.
Run: blender --background art/micro-biome.blend --python art/export-micro-biome.py && art/outline-still.sh"""
import os
import bpy

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), '..'))
GLB = os.path.join(ROOT_DIR, 'public', 'models', 'micro-biome.glb')
STILL = os.path.join(ROOT_DIR, 'public', 'images', '3d', 'micro-biome.png')
# Silhouette without the lettering, for the sticker outline (composited by art/outline-still.sh).
STILL_MASK = os.path.join(ROOT_DIR, 'public', 'images', '3d', 'micro-biome-mask.png')
STILL_BACK = os.path.join(ROOT_DIR, 'public', 'images', '3d', 'micro-biome-back.png')
DECIMATE = {'Cloud': 0.3, 'Letter': 0.45, 'Word': 0.45, 'Spire': 0.6, 'Moss': 0.12, 'Leaf': 0.5}

scene = bpy.context.scene
root = bpy.data.objects['MicroBiome']

# Fallback stills first, from the untouched scene (preview camera + studio lights, transparent background).
# Three layers so the letter ring weaves around the sticker outline like the live scene:
#   back  - ring letters on the far side only (goes under the outline band)
#   front - everything except the far-side letters (goes over it)
#   mask  - silhouette without any letters (the outline is grown from this)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = 1200
os.makedirs(os.path.dirname(STILL), exist_ok=True)
cam_dir = (scene.camera.matrix_world.translation - root.matrix_world.translation).normalized()
letters = [o for o in root.children_recursive if o.type in {'FONT', 'MESH'} and o.name.startswith(('Letter', 'Word'))]
back = [o for o in letters if (o.matrix_world.translation - root.matrix_world.translation).dot(cam_dir) < 0]
everything = [o for o in scene.objects if o.type in {'MESH', 'FONT'}]


def render(path, visible):
    for o in everything:
        o.hide_render = o not in visible
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


render(STILL_BACK, set(back))
render(STILL, set(everything) - set(back))
render(STILL_MASK, set(everything) - set(letters))
for o in everything:
    o.hide_render = False


def freeze(o):
    """Replace o's modifiers (or text curve) with a plain evaluated mesh."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    if o.type == 'MESH':
        o.modifiers.clear()
        o.data = me
        return o
    n = bpy.data.objects.new(o.name + '_m', me)
    for c in o.users_collection:
        c.objects.link(n)
    n.parent = o.parent
    n.matrix_parent_inverse = o.matrix_parent_inverse.copy()
    n.location, n.rotation_euler, n.scale = o.location.copy(), o.rotation_euler.copy(), o.scale.copy()
    name = o.name
    bpy.data.objects.remove(o)
    n.name = name
    return n


meshes = []
for o in list(root.children_recursive):
    if o.type not in {'MESH', 'FONT'}:
        continue
    o = freeze(o)
    ratio = next((r for prefix, r in DECIMATE.items() if o.name.startswith(prefix)), None)
    if ratio:
        o.modifiers.new('Decimate', 'DECIMATE').ratio = ratio
        o = freeze(o)
    if not o.name.startswith(('Planter', 'Soil')):
        for p in o.data.polygons:
            p.use_smooth = True
    o.data.color_attributes.active_color = o.data.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
    meshes.append(o)

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 48
scene.world.light_settings.distance = 0.35
for o in bpy.context.view_layer.objects:
    o.select_set(False)
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
# Clay should only darken in crevices, never go muddy.
for o in meshes:
    for d in o.data.color_attributes['AO'].data:
        v = 0.5 + 0.5 * d.color[0]
        d.color = (v, v, v, 1)

for o in bpy.context.view_layer.objects:
    o.select_set(False)
for o in [root, *root.children_recursive]:
    o.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(filepath=GLB, export_format='GLB', use_selection=True, export_apply=True, export_vertex_color='ACTIVE',
                          export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                          export_draco_position_quantization=12, export_draco_normal_quantization=8, export_draco_color_quantization=8,
                          export_yup=True, export_cameras=False, export_lights=False)
print('exported', GLB, os.path.getsize(GLB))

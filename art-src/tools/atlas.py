"""Pack the chosen sprites into src/art/atlas.png + atlas.json, and write the backdrop strips.
python atlas.py <scratchpad> <project src/art dir>"""
import sys, os, json
from PIL import Image
SP, OUT = sys.argv[1], sys.argv[2]
dl = lambda n: f'{SP}/dl/{n}.png'
sg = lambda n: f'{SP}/seg/{n}.png'
an = lambda n, i: f'{SP}/anim/{n}_{i}.png'

def load(p): return Image.open(p).convert('RGBA')

def key_bg(im, tol=14):
    """Flood-fill the flat background from the borders to transparent."""
    im = im.copy(); px = im.load(); W, H = im.size
    ref = px[0, 0]
    seen = bytearray(W * H); stack = []
    for x in range(W): stack += [(x, 0), (x, H - 1)]
    for y in range(H): stack += [(0, y), (W - 1, y)]
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= W or y >= H or seen[y * W + x]: continue
        seen[y * W + x] = 1
        p = px[x, y]
        if max(abs(p[0] - ref[0]), abs(p[1] - ref[1]), abs(p[2] - ref[2])) > tol: continue
        px[x, y] = (0, 0, 0, 0)
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return im

def crop(im, box=None):
    if box: im = im.crop(box)
    bb = im.getchannel('A').point(lambda v: 255 if v > 16 else 0).getbbox()
    return im.crop(bb) if bb else im

def frames_union(paths):
    ims = [load(p) for p in paths]
    bb = None
    for im in ims:
        b = im.getchannel('A').point(lambda v: 255 if v > 16 else 0).getbbox()
        if b: bb = b if bb is None else (min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3]))
    return [im.crop(bb) for im in ims]

S = {}  # name -> list of frames (Image)
def one(name, im): S[name] = [im]

# trees
one('tree_apple', crop(load(dl('tree_apple'))))
one('tree_apple_fruit', crop(key_bg(load(dl('apple_autumn')))))
one('tree_oak', crop(load(dl('tree_oak'))))
one('tree_spruce', crop(load(dl('tree_spruce'))))
one('tree_birch', crop(load(dl('birch2'))))
one('tree_bare', crop(load(dl('tree_bare'))))
# bushes (bushes_0 is cut off by the canvas edge)
for i in range(1, 8): one(f'bush_{i - 1}', load(sg(f'bushes_{i}')))
one('bramble', crop(load(dl('bramble2'))))
for i in range(8): one(f'flower_{i}', load(sg(f'flowers_{i}')))
for i, n in enumerate(['toadstool', 'mushrooms', 'fern', 'clover', 'mossrock', 'fern2', 'quartz', 'mossrock2', 'acorn', 'pinecone', 'snail']):
    one(n, load(sg(f'floor_{i}')))
for i, n in enumerate(['stump', 'boulder', 'grassclump', 'cattails', 'rockpile', 'wheatgrass']):
    one(n, load(sg(f'props_{i}')))
p6 = load(sg('props_6'))
one('cattails2', crop(p6, (0, 0, 44, p6.height)))
one('dandelion', crop(p6, (44, 0, p6.width, p6.height)))
for i, n in [(0, 'ammonite'), (1, 'bone'), (2, 'crystal'), (3, 'buried_acorn'), (8, 'grub'), (9, 'rootpiece'), (10, 'flatpebble'), (5, 'crystal2')]:
    one(n, load(sg(f'buried_{i}')))
one('bone', crop(S['bone'][0], (6, 0, S['bone'][0].width, S['bone'][0].height)))
for i, n in enumerate(['food_apple', 'food_berries', 'food_seeds', 'food_mealworm', 'food_sugar', 'food_carcass']):
    one(n, load(sg(f'food_{i}')))
for i in range(6): one(f'cloud_{i}', load(sg(f'clouds_{i}')))
one('leaf', crop(load(dl('leaf'))))
one('log', crop(load(dl('log'))))
one('bee', crop(load(dl('bee'))))
one('worm', crop(load(an('worm', 0))))
S['beetle'] = frames_union([an('beetle', i) for i in range(1, 9)])
S['spider'] = frames_union([an('spider', i) for i in range(1, 9)])
S['caterpillar'] = frames_union([an('caterpillar', i) for i in range(1, 9)])
S['butterfly'] = frames_union([an('butterfly', i) for i in range(0, 5)])
# v1.7 critters, drawn by tools/dangers.py
S['bird'] = frames_union([an('bird', i) for i in range(4)])
S['ladybird'] = frames_union([an('ladybird', i) for i in range(2)])

# shelf-pack
items = []
for name, frames in S.items():
    for k, im in enumerate(frames): items.append((name, k, im))
items.sort(key=lambda t: -t[2].height)
AW = 1024; x = y = rowh = 0; place = []
for name, k, im in items:
    if x + im.width + 1 > AW: x = 0; y += rowh + 1; rowh = 0
    place.append((name, k, im, x, y)); x += im.width + 1; rowh = max(rowh, im.height)
AH = y + rowh
atlas = Image.new('RGBA', (AW, AH), (0, 0, 0, 0))
meta = {}
for name, k, im, x, y in place:
    atlas.paste(im, (x, y))
    meta.setdefault(name, []).append(None)
for name, k, im, x, y in place: meta[name][k] = [x, y, im.width, im.height]
os.makedirs(OUT, exist_ok=True)
atlas.save(f'{OUT}/atlas.png', optimize=True)
json.dump(meta, open(f'{OUT}/atlas.json', 'w'), separators=(',', ':'))
print('atlas', atlas.size, len(meta), 'sprites')

# backdrops: middle of the hills panorama, mirrored so the strip tiles seamlessly
hills = load(dl('hills_v1')).crop((104, 0, 424, 128))
hills.paste((0, 0, 0, 0), (0, 0, hills.width, 40))  # leaves from the framing tree poke in at the top
strip = Image.new('RGBA', (hills.width * 2, hills.height)); strip.paste(hills, (0, 0)); strip.paste(hills.transpose(Image.FLIP_LEFT_RIGHT), (hills.width, 0))
strip.save(f'{OUT}/hills.png', optimize=True)
hedge = crop(load(dl('hedge')))
hstrip = Image.new('RGBA', (hedge.width * 2, hedge.height)); hstrip.paste(hedge, (0, 0)); hstrip.paste(hedge.transpose(Image.FLIP_LEFT_RIGHT), (hedge.width, 0))
hstrip.save(f'{OUT}/hedge.png', optimize=True)
print('hills', strip.size, 'hedge', hstrip.size)

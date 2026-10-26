"""Hand-drawn v1.7 critters, painted at the game's 8 texels per cell: a robin (stand, peck, two wing beats)
and a ladybird (two walk frames). Writes art-src/anim/bird_*.png and ladybird_*.png for atlas.py.
python dangers.py <path to art-src>"""
import sys
from PIL import Image, ImageDraw

SRC = sys.argv[1]
INK = (38, 28, 22, 255)


def outline(im, ink=INK):
    """A one-texel dark outline around everything opaque, like the PixelLab sprites."""
    a = im.getchannel('A').load()
    out = im.copy()
    px = out.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            if a[x, y] > 16:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and a[nx, ny] > 16:
                    px[x, y] = ink
                    break
    return out


# ── robin ─────────────────────────────────────────────────────────────
BACK = (124, 98, 66, 255)
BACK_D = (94, 72, 48, 255)
BACK_L = (156, 128, 88, 255)
BREAST = (226, 112, 52, 255)
BREAST_L = (246, 150, 84, 255)
BELLY = (234, 224, 204, 255)
WING = (102, 80, 54, 255)
WING_L = (140, 112, 76, 255)
BEAK = (58, 46, 38, 255)
LEG = (156, 112, 92, 255)


def robin(pose):
    """pose: 'stand', 'peck', 'up' (wings raised) or 'down' (wings swept down)."""
    im = Image.new('RGBA', (48, 42), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    flying = pose in ('up', 'down')
    # Tail
    d.polygon([(10, 22), (1, 17), (1, 21), (10, 27)], fill=BACK_D)
    d.line([(3, 19), (9, 23)], fill=BACK)
    # Body, then the warm breast and pale belly over the front of it
    d.ellipse((8, 15, 33, 33), fill=BACK)
    d.ellipse((11, 15, 28, 22), fill=BACK_L)
    d.ellipse((21, 17, 35, 31), fill=BREAST)
    d.ellipse((24, 18, 31, 24), fill=BREAST_L)
    d.ellipse((14, 26, 30, 33), fill=BELLY)
    # Head: down at the ground when pecking
    hx, hy = (34, 25) if pose == 'peck' else (32, 14)
    d.ellipse((hx - 7, hy - 7, hx + 7, hy + 7), fill=BACK)
    d.ellipse((hx - 2, hy - 3, hx + 7, hy + 7), fill=BREAST)
    d.ellipse((hx - 5, hy - 6, hx + 1, hy - 2), fill=BACK_L)
    ex, ey = hx + 2, hy - 2
    d.rectangle((ex, ey, ex + 1, ey + 1), fill=(20, 16, 14, 255))
    d.point((ex, ey), fill=(255, 255, 255, 255))
    if pose == 'peck':
        d.polygon([(hx + 4, hy + 3), (hx + 8, hy + 10), (hx + 6, hy + 3)], fill=BEAK)
    else:
        d.polygon([(hx + 6, hy - 1), (hx + 12, hy + 1), (hx + 6, hy + 2)], fill=BEAK)
    # Wing
    if pose == 'up':
        d.polygon([(14, 20), (6, 2), (12, 0), (22, 6), (27, 19)], fill=WING)
        for k in range(4):
            d.line([(8 + k * 4, 2 + k), (15 + k * 3, 18)], fill=WING_L)
    elif pose == 'down':
        d.polygon([(14, 19), (27, 19), (24, 31), (12, 39), (8, 36)], fill=WING)
        for k in range(4):
            d.line([(16 + k * 3, 21), (10 + k * 3, 35 + k)], fill=WING_L)
    else:
        d.ellipse((10, 18, 27, 27), fill=WING)
        for k in range(4):
            d.line([(12 + k * 3, 24), (16 + k * 3, 20)], fill=WING_L)
    # Legs, tucked up in flight
    if not flying:
        for lx in (19, 24):
            d.line([(lx, 32), (lx, 39)], fill=LEG)
            d.line([(lx - 1, 39), (lx + 2, 39)], fill=LEG)
    return outline(im)


# ── ladybird ──────────────────────────────────────────────────────────
RED = (214, 40, 36, 255)
RED_L = (248, 116, 92, 255)
RED_D = (160, 26, 26, 255)
BLACK = (24, 20, 20, 255)


def ladybird(frame):
    im = Image.new('RGBA', (20, 14), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # Legs under the shell, swapping pairs each frame
    for k, lx in enumerate((5, 9, 13)):
        off = 1 if (k + frame) % 2 else -1
        d.line([(lx, 9), (lx + off, 12)], fill=BLACK)
    # Head and pronotum
    d.ellipse((13, 5, 18, 10), fill=BLACK)
    d.point((16, 6), fill=(240, 240, 232, 255))
    d.point((15, 8), fill=(240, 240, 232, 255))
    # The domed shell
    d.pieslice((2, 1, 16, 17), 180, 360, fill=RED)
    d.rectangle((2, 9, 16, 10), fill=RED_D)
    d.ellipse((5, 2, 10, 5), fill=RED_L)
    for x, y in ((6, 6), (10, 4), (12, 7), (4, 8)):
        d.rectangle((x, y, x + 1, y + 1), fill=BLACK)
    return outline(im)


for i, pose in enumerate(['stand', 'peck', 'up', 'down']):
    robin(pose).save(f'{SRC}/anim/bird_{i}.png')
for i in range(2):
    ladybird(i).save(f'{SRC}/anim/ladybird_{i}.png')
print('bird x4, ladybird x2')

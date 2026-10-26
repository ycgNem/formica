"""Segment a sprite sheet into pieces by empty columns. python seg.py sheet.png outdir prefix [linethr]"""
import sys, os
from PIL import Image
src, outdir, prefix = sys.argv[1], sys.argv[2], sys.argv[3]
thr = int(sys.argv[4]) if len(sys.argv) > 4 else 0
im = Image.open(src).convert('RGBA')
W, H = im.size
a = im.getchannel('A').load()
cnt = [sum(1 for y in range(H) if a[x, y] > 16) for x in range(W)]
segs, start = [], None
for x in range(W + 1):
    full = x < W and cnt[x] > thr
    if full and start is None: start = x
    if not full and start is not None:
        segs.append([start, x]); start = None
# merge tiny gaps
merged = []
for s in segs:
    if merged and s[0] - merged[-1][1] <= 1: merged[-1][1] = s[1]
    else: merged.append(s)
os.makedirs(outdir, exist_ok=True)
n = 0
for x0, x1 in merged:
    if x1 - x0 < 4: continue
    piece = im.crop((x0, 0, x1, H))
    if thr:
        # drop stray line pixels: clear pixels whose column has few opaque pixels
        pa = piece.load()
        for x in range(piece.width):
            col = [y for y in range(H) if pa[x, y][3] > 16]
            if len(col) <= thr:
                for y in col: pa[x, y] = (0, 0, 0, 0)
    bb = piece.getchannel('A').point(lambda v: 255 if v > 16 else 0).getbbox()
    if not bb: continue
    piece = piece.crop(bb)
    piece.save(os.path.join(outdir, f'{prefix}_{n}.png'))
    print(f'{prefix}_{n}', piece.size)
    n += 1

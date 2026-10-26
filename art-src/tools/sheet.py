"""Contact sheet: python sheet.py out.png scale file1 file2 ... (draws on a mid-grey checker, labels with index)"""
import sys
from PIL import Image, ImageDraw
out, scale, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f).convert('RGBA') for f in files]
pad = 6
W = max(sum(i.width * scale + pad for i in ims) + pad, 64)
rows, row, x = [], [], pad
maxw = 1400
for i, im in enumerate(ims):
    w = im.width * scale
    if row and x + w > maxw:
        rows.append(row); row = []; x = pad
    row.append((i, im)); x += w + pad
rows.append(row)
H = sum(max(im.height * scale for _, im in r) + pad + 12 for r in rows) + pad
W = min(W, maxw + pad)
sheet = Image.new('RGBA', (W, H), (150, 160, 150, 255))
d = ImageDraw.Draw(sheet)
for yy in range(0, H, 8):
    for xx in range(0, W, 8):
        if (xx // 8 + yy // 8) % 2: d.rectangle([xx, yy, xx + 7, yy + 7], fill=(165, 175, 165, 255))
y = pad
for r in rows:
    x = pad; rh = max(im.height * scale for _, im in r)
    for i, im in r:
        big = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        sheet.alpha_composite(big, (x, y + 12))
        d.text((x, y), str(i), fill=(0, 0, 0, 255))
        x += big.width + pad
    y += rh + pad + 12
sheet.save(out)

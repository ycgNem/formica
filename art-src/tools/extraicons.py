"""UI icons for tools added after v1.1, cut from atlas sprites or drawn here. python extraicons.py <src/art>"""
import sys, json
from PIL import Image, ImageDraw

ART = sys.argv[1]
atlas = Image.open(f'{ART}/atlas.png').convert('RGBA')
meta = json.load(open(f'{ART}/atlas.json'))


def cut(name, frame=0):
    x, y, w, h = meta[name][frame]
    im = atlas.crop((x, y, x + w, y + h))
    return im.crop(im.getchannel('A').point(lambda v: 255 if v > 16 else 0).getbbox())


def fit(im, size=28):
    """Scale by a whole number (up) or nearest (down) so it fits a size x size box, keeping hard pixels."""
    k = min(size / im.width, size / im.height)
    k = max(1, int(k)) if k >= 1 else k
    return im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.NEAREST)


def save(name, im):
    im.save(f'{ART}/ui/{name}.png', optimize=True)
    print(name, im.size)


save('tool_plug', fit(cut('flatpebble')))


def aphids():
    """A root with fat green aphids and a bead of honeydew, outlined like the PixelLab tool icons."""
    im = Image.new('RGBA', (28, 28), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ink = (45, 32, 22, 255)
    # Root: a thick diagonal stroke with an outline and a lit top edge
    for t in range(-1, 27):
        x, y = t, 22 - int(t * 0.5)
        d.rectangle((x, y - 1, x, y + 4), fill=ink)
    for t in range(0, 26):
        x, y = t, 22 - int(t * 0.5)
        d.rectangle((x, y, x, y + 3), fill=(118, 80, 52, 255))
        d.point((x, y), fill=(160, 118, 80, 255))
        d.point((x, y + 3), fill=(88, 58, 38, 255))

    def bug(cx, cy):
        d.ellipse((cx - 5, cy - 4, cx + 5, cy + 4), fill=ink)
        d.ellipse((cx - 4, cy - 3, cx + 4, cy + 3), fill=(96, 152, 52, 255))
        d.ellipse((cx - 3, cy - 3, cx + 2, cy + 1), fill=(140, 196, 72, 255))
        d.rectangle((cx - 2, cy - 2, cx - 1, cy - 2), fill=(206, 236, 140, 255))
        d.point((cx + 4, cy - 4), fill=ink)
        d.point((cx + 5, cy - 5), fill=ink)

    bug(7, 12)
    bug(17, 7)
    bug(13, 18)
    # Honeydew
    d.ellipse((19, 14, 26, 21), fill=ink)
    d.ellipse((20, 15, 25, 20), fill=(232, 158, 40, 255))
    d.rectangle((21, 16, 22, 17), fill=(255, 230, 150, 255))
    return im


save('tool_aphids', aphids())


def honeypot():
    """The honeypot ant portrait: a Lasius worker recoloured amber, with a replete's balloon of honey for a gaster."""
    base = Image.open(f'{ART}/ui/ant_lasius.png').convert('RGBA')
    pad = 6
    im = Image.new('RGBA', (base.width + pad, base.height + pad), (0, 0, 0, 0))
    ramp = [(58, 32, 16), (96, 56, 24), (138, 86, 36), (178, 118, 52), (216, 158, 80)]
    px = base.load()
    for y in range(base.height):
        for x in range(base.width):
            r, g, b, a = px[x, y]
            # Skip the soft ground shadow under the feet
            if a < 200 or (y > base.height - 6 and max(r, g, b) - min(r, g, b) < 12 and r > 90):
                continue
            lum = (r * 3 + g * 6 + b) / 10
            k = min(len(ramp) - 1, int(lum / 256 * len(ramp) * 1.6))
            im.putpixel((x + pad, y + pad), ramp[k] + (a,))
    d = ImageDraw.Draw(im)
    # The honey balloon over the gaster: outline, body, darker underside, bands and a glint
    cx, cy, r = pad + 13, pad + 22, 15
    d.ellipse((cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1), fill=(70, 38, 14, 255))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(214, 140, 36, 255))
    d.ellipse((cx - r + 2, cy - r + 1, cx + r - 3, cy + r - 5), fill=(238, 172, 58, 255))
    d.ellipse((cx - r + 5, cy - r + 3, cx + r - 8, cy + 2), fill=(250, 204, 104, 255))
    # Faint segment bands, kept inside the balloon
    bands = Image.new('RGBA', im.size, (0, 0, 0, 0))
    bd = ImageDraw.Draw(bands)
    for t in (-6, 1, 8):
        bd.arc((cx - r + 1, cy - r + t, cx + r - 1, cy + r + t), 200, 340, fill=(200, 122, 32, 255))
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).ellipse((cx - r + 2, cy - r + 2, cx + r - 2, cy + r - 2), fill=255)
    im.paste(bands, (0, 0), Image.composite(bands.getchannel('A'), Image.new('L', im.size, 0), mask))
    d.rectangle((cx - 7, cy - 10, cx - 4, cy - 8), fill=(255, 244, 210, 255))
    d.point((cx - 3, cy - 11), fill=(255, 244, 210, 255))
    return im.crop(im.getchannel('A').point(lambda v: 255 if v > 16 else 0).getbbox())


save('ant_honeypot', honeypot())

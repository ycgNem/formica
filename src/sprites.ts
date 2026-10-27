import atlasUrl from './art/atlas.png';
import atlasMeta from './art/atlas.json';
import hillsUrl from './art/hills.png';
import hedgeUrl from './art/hedge.png';

/** Sprite texels per world cell. The terrain is drawn at the same density so everything shares one pixel grid. */
export const TEX = 8;

export interface Sprite {
  img: CanvasImageSource;
  sx: number;
  sy: number;
  w: number;
  h: number;
}

/** Recolourings made at load time, so one painted sprite covers every season. */
export type Look = 'spring' | 'autumn' | 'winter' | 'snow' | 'wilt' | 'blossom' | 'bare' | 'grey' | 'dry';

type Rect = [number, number, number, number];
const META = atlasMeta as unknown as Record<string, Rect[]>;

let atlas: HTMLImageElement | null = null;
let atlasData: ImageData | null = null;
const backdrops: Record<'hills' | 'hedge', HTMLImageElement | null> = { hills: null, hedge: null };
const plain = new Map<string, Sprite>();
const looks = new Map<string, Sprite>();

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

/** A scratch canvas. Only ask for `readback` when its pixels will be read, since that keeps it off the GPU. */
export function canvas(w: number, h: number, readback = false): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: readback })!];
}

export async function loadArt(): Promise<void> {
  const [a, hills, hedge] = await Promise.all([loadImage(atlasUrl), loadImage(hillsUrl), loadImage(hedgeUrl)]);
  atlas = a;
  backdrops.hills = hills;
  backdrops.hedge = hedge;
  const [, ctx] = canvas(a.width, a.height, true);
  ctx.drawImage(a, 0, 0);
  atlasData = ctx.getImageData(0, 0, a.width, a.height);
}

export function backdrop(name: 'hills' | 'hedge'): HTMLImageElement {
  return backdrops[name]!;
}

export function has(name: string): boolean {
  return name in META;
}

export function frameCount(name: string): number {
  return META[name]?.length ?? 0;
}

export function sprite(name: string, frame = 0): Sprite {
  const key = `${name}#${frame}`;
  let s = plain.get(key);
  if (!s) {
    const r = META[name][frame % META[name].length];
    s = { img: atlas!, sx: r[0], sy: r[1], w: r[2], h: r[3] };
    plain.set(key, s);
  }
  return s;
}

/** RGBA pixels of a sprite frame, for stamping into the terrain. */
export function pixels(name: string, frame = 0): ImageData {
  const r = META[name][frame % META[name].length];
  const out = new ImageData(r[2], r[3]);
  const src = atlasData!.data;
  const aw = atlasData!.width;
  for (let y = 0; y < r[3]; y++) {
    const o = ((r[1] + y) * aw + r[0]) * 4;
    out.data.set(src.subarray(o, o + r[2] * 4), y * r[2] * 4);
  }
  return out;
}

/** A recoloured copy of a sprite, built once and cached. */
export function variant(name: string, look: Look, frame = 0): Sprite {
  const key = `${name}#${frame}#${look}`;
  let s = looks.get(key);
  if (!s) {
    const d = pixels(name, frame);
    recolor(d, look, hashStr(name));
    const [c, ctx] = canvas(d.width, d.height);
    ctx.putImageData(d, 0, 0);
    s = { img: c, sx: 0, sy: 0, w: d.width, h: d.height };
    looks.set(key, s);
  }
  return s;
}

/** A recoloured copy of a whole backdrop strip. */
export function backdropVariant(name: 'hills' | 'hedge', look: Look | null): HTMLCanvasElement | HTMLImageElement {
  const img = backdrops[name]!;
  if (!look) return img;
  const key = `bd:${name}:${look}`;
  const hit = looks.get(key);
  if (hit) return hit.img as HTMLCanvasElement;
  const [c, ctx] = canvas(img.width, img.height, true);
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height);
  recolor(d, look, hashStr(name));
  ctx.putImageData(d, 0, 0);
  looks.set(key, { img: c, sx: 0, sy: 0, w: c.width, h: c.height });
  return c;
}

// ── recolouring ─────────────────────────────────────────────────────

export const hash2 = (x: number, y: number, s = 0): number => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (((h % 360) + 360) % 360) / 360;
  if (s <= 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Leaves and grass: anything yellow-green through blue-green with some colour in it. */
const leafy = (h: number, s: number): boolean => h >= 50 && h <= 175 && s > 0.12;

function recolor(d: ImageData, look: Look, seed: number): void {
  const px = d.data;
  const w = d.width;
  const h = d.height;
  const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && px[(y * w + x) * 4 + 3] > 96;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (px[o + 3] < 8) continue;
      let [hh, s, l] = rgbToHsl(px[o], px[o + 1], px[o + 2]);
      const leaf = leafy(hh, s);
      // Patchy per-cluster variation, so recoloured canopies aren't one flat tone
      const n = hash2(x >> 2, y >> 2, seed);
      switch (look) {
        case 'spring':
          if (leaf) {
            hh -= 10;
            l = Math.min(0.92, l * 1.08 + 0.03);
          }
          break;
        case 'autumn':
          if (leaf) {
            hh = n < 0.4 ? 12 + n * 30 : n < 0.8 ? 30 + n * 12 : 46;
            s = Math.min(1, s * 1.15 + 0.12);
            l = l * 0.98;
          }
          break;
        case 'wilt':
          if (s > 0.15) {
            hh = 32 + n * 10;
            s *= 0.35;
            l *= 0.82;
          }
          break;
        case 'winter':
          if (leaf) {
            hh = 28 + n * 8;
            s *= 0.28;
            l *= 0.78;
          }
          break;
        case 'bare':
          // Strip the foliage, keep bark and twigs
          if (leaf || (hh > 40 && hh < 70 && s > 0.3)) {
            px[o + 3] = 0;
            continue;
          }
          break;
        case 'grey':
          s *= 0.15;
          l = l * 0.7 + 0.08;
          break;
        case 'dry':
          // Sun-bleached scrub: olive and khaki instead of meadow green
          if (leaf) {
            hh = 48 + (hh - 100) * 0.15 + n * 10;
            s *= 0.5;
            l = Math.min(0.9, l * 1.05 + 0.04);
          }
          break;
        default:
          break;
      }
      const [r, g, b] = hslToRgb(hh, s, l);
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
    }
  }

  if (look === 'blossom') {
    // Dots of white and pink across the upper canopy
    for (let y = 1; y < h * 0.7; y++) {
      for (let x = 1; x < w - 1; x++) {
        const o = (y * w + x) * 4;
        if (px[o + 3] < 200) continue;
        const [hh, s] = rgbToHsl(px[o], px[o + 1], px[o + 2]);
        if (!leafy(hh, s) || hash2(x, y, seed + 7) > 0.05) continue;
        const pink = hash2(x, y, seed + 9) < 0.5;
        const c = pink ? [246, 186, 206] : [252, 246, 240];
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) {
          const q = ((y + dy) * w + x + dx) * 4;
          if (px[q + 3] < 200) continue;
          px[q] = c[0];
          px[q + 1] = c[1];
          px[q + 2] = c[2];
        }
      }
    }
  }

  if (look === 'snow' || look === 'winter' || look === 'bare') {
    // Snow settles on every upward-facing edge
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!opaque(x, y) || opaque(x, y - 1)) continue;
        const o = (y * w + x) * 4;
        px[o] = 244;
        px[o + 1] = 248;
        px[o + 2] = 251;
        // A drift two or three texels deep, blue-grey where it thins out
        const depth = hash2(x, y, seed + 3) < 0.5 ? 2 : 3;
        for (let d = 1; d < depth && opaque(x, y + d); d++) {
          const q = o + d * w * 4;
          const c = d === depth - 1 ? [212, 224, 236] : [238, 244, 249];
          px[q] = c[0];
          px[q + 1] = c[1];
          px[q + 2] = c[2];
        }
      }
    }
  }
}

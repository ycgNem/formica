import { W, H, GROUND, AIR, DIRT, TUNNEL, ROCK, MOUND } from './config';
import { Rng } from './rng';
import { TEX, has, pixels } from './sprites';
import type { World } from './world';
import type { Plant } from './ecology';
import type { Buried, Zone } from './layout';

const TW = W * TEX;
const TH = H * TEX;
/** Upload granularity: dirty regions are pushed to the canvas in squares of this many texels. */
const CHUNK = 32 * TEX;
const NX = Math.ceil(TW / CHUNK);
const NT = 256;
const NM = NT - 1;

type RGB = readonly [number, number, number];

const cl = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const pack = (r: number, g: number, b: number): number => ((255 << 24) | (cl(b) << 16) | (cl(g) << 8) | cl(r)) >>> 0;
const packc = (c: RGB, k = 1): number => pack(c[0] * k, c[1] * k, c[2] * k);
const scale = (c: number, k: number): number => pack((c & 255) * k, ((c >> 8) & 255) * k, ((c >> 16) & 255) * k);

/** Topsoil, loam, clay, deep sand and bedrock. */
const STRATA: RGB[] = [[116, 80, 54], [148, 104, 68], [174, 122, 78], [150, 118, 90], [100, 95, 92]];
const STRATA_DEPTH = [12, 44, 100];
/** Tint mixed into tunnel walls per chamber role: plain, queen, nursery, food store, midden, granary. */
const ROLE_TINT: RGB[] = [[0, 0, 0], [132, 70, 106], [124, 112, 68], [84, 114, 62], [92, 78, 66], [156, 128, 66]];
const ROCK_C: RGB = [122, 114, 106];
const CRUMBS: RGB[] = [[198, 158, 112], [180, 140, 98], [158, 120, 84], [214, 178, 132]];
const WATER: RGB = [74, 140, 194];
const WATER_TOP: RGB = [170, 218, 246];
/** Grass lip per season (light, dark); winter is snow. */
const LIP: [RGB, RGB][] = [
  [[152, 206, 96], [104, 166, 70]],
  [[122, 182, 76], [84, 144, 56]],
  [[206, 172, 86], [164, 128, 60]],
  [[245, 249, 252], [210, 222, 234]],
];
const ROOT: RGB = [92, 62, 42];
const MOSS: [RGB, RGB] = [[122, 156, 70], [86, 120, 52]];
const ROOT_HI: RGB = [126, 90, 60];
const PEBBLES: RGB[] = [[150, 140, 128], [126, 116, 104], [172, 162, 148], [118, 102, 88], [160, 132, 110]];

/** Tileable value noise in [-1, 1]. Periods must divide 256. */
function noiseTile(rng: Rng, periods: number[], weights: number[]): Float32Array {
  const out = new Float32Array(NT * NT);
  periods.forEach((p, o) => {
    const n = NT / p;
    const lat = new Float32Array(n * n);
    for (let i = 0; i < lat.length; i++) lat[i] = rng.next() * 2 - 1;
    for (let y = 0; y < NT; y++) {
      const fy = y / p;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % n) * n;
      const r1 = ((y0 + 1) % n) * n;
      for (let x = 0; x < NT; x++) {
        const fx = x / p;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % n;
        const c1 = (x0 + 1) % n;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
        out[y * NT + x] += (a + (b - a) * sy) * weights[o];
      }
    }
  });
  return out;
}

/**
 * The cross-section, drawn at TEX texels per cell.
 *
 * Each texel blends the four nearest cell centres into a soft "openness" field
 * and thresholds it with a little noise, so tunnels get rounded, slightly rough
 * walls instead of stair-steps. The same field gives wall shading: ambient
 * occlusion, a shadowed ceiling, a lit floor, and a grass or snow lip where
 * soil meets the sky. Untouched soil comes from a texture baked once per world.
 */
export class Terrain {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly px: Uint32Array;
  private readonly soil = new Uint32Array(TW * TH);
  private readonly grain = new Uint8Array(NT * NT);
  private mott: Float32Array = new Float32Array(NT * NT);
  private rough: Float32Array = new Float32Array(NT * NT);
  private readonly nb = new Uint8Array(9);
  private readonly nbi = new Int32Array(9);
  private readonly chunks = new Set<number>();
  private world: World | null = null;
  private season = 0;
  /** The biome's soil layers and grass lip. */
  private strata: readonly RGB[] = STRATA;
  private lip: readonly (readonly [RGB, RGB])[] = LIP;
  private rocks = 1;

  constructor() {
    this.canvas.width = TW;
    this.canvas.height = TH;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(TW, TH);
    this.px = new Uint32Array(this.img.data.buffer);
  }

  attach(
    world: World, seed: number, season: number, plants: Plant[], buried: Buried[], zones: Zone[],
    palette: { strata: readonly RGB[]; lip: readonly (readonly [RGB, RGB])[] | null; rocks: number } | null = null,
  ): void {
    this.world = world;
    this.season = season;
    this.strata = palette?.strata ?? STRATA;
    this.lip = palette?.lip ?? LIP;
    this.rocks = palette?.rocks ?? 1;
    this.bakeSoil(seed, plants, buried, zones);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) this.renderCell(x, y);
    world.dirty.clear();
    this.chunks.clear();
    this.ctx.putImageData(this.img, 0, 0);
  }

  setSeason(season: number): void {
    const w = this.world;
    if (!w || season === this.season) return;
    this.season = season;
    for (let x = 0; x < W; x++) {
      for (let y = Math.max(0, w.top[x] - 2); y <= Math.min(H - 1, w.top[x] + 2); y++) w.dirty.add(y * W + x);
    }
  }

  /** Redraw changed cells and push the touched chunks to the canvas. */
  update(): void {
    const w = this.world;
    if (!w) return;
    if (w.dirty.size) {
      for (const i of w.dirty) this.renderCell(i % W, (i / W) | 0);
      w.dirty.clear();
    }
    for (const k of this.chunks) {
      const cx = (k % NX) * CHUNK;
      const cy = Math.floor(k / NX) * CHUNK;
      this.ctx.putImageData(this.img, 0, 0, cx, cy, Math.min(CHUNK, TW - cx), Math.min(CHUNK, TH - cy));
    }
    this.chunks.clear();
  }

  // ── baked soil ─────────────────────────────────────────────────────

  private bakeSoil(seed: number, plants: Plant[], buried: Buried[], zones: Zone[]): void {
    const rng = new Rng(seed ^ 0x1b873593);
    const mott = (this.mott = noiseTile(rng, [32, 16, 4], [0.5, 0.32, 0.18]));
    this.rough = noiseTile(rng, [8, 4], [0.65, 0.35]);
    const big = noiseTile(rng, [128, 64], [0.7, 0.3]);
    const grain = this.grain;
    for (let i = 0; i < grain.length; i++) grain[i] = (rng.next() * 256) | 0;
    const wave = new Float32Array(TW);
    for (let tx = 0; tx < TW; tx++) {
      const x = tx / TEX;
      wave[tx] = Math.sin(x * 0.045) * 2.2 + Math.sin(x * 0.13 + 1.7) * 1.1;
    }
    const soil = this.soil;
    const [d0, d1, d2] = STRATA_DEPTH;
    for (let ty = 0; ty < TH; ty++) {
      const cy = ty / TEX;
      const row = ty * TW;
      const ny = (ty & NM) << 8;
      const nyb = ((ty >> 1) & NM) << 8;
      const gy = ((ty + 37) & NM) << 8;
      for (let tx = 0; tx < TW; tx++) {
        const m = mott[ny | (tx & NM)];
        const b = big[nyb | ((tx >> 1) & NM)];
        const d = cy - GROUND + wave[tx] + b * 3;
        let s: number;
        let edge: number;
        if (cy > H - 4.5 + b * 2) {
          s = 4;
          edge = 9;
        } else if (d < d0) {
          s = 0;
          edge = d0 - d;
        } else if (d < d1) {
          s = 1;
          edge = Math.min(d - d0, d1 - d);
        } else if (d < d2) {
          s = 2;
          edge = Math.min(d - d1, d2 - d);
        } else {
          s = 3;
          edge = d - d2;
        }
        const c = this.strata[s];
        let k = 1 + 0.1 * m + 0.06 * b - 0.12 * Math.min(1, Math.max(0, d) / 160);
        if (edge < 0.28) k *= 0.88;
        const g = grain[gy | ((tx + (ty >> 8) * 97) & NM)];
        if (g < 7) k *= 1.22;
        else if (g < 17) k *= 0.82;
        else if (grain[(((ty >> 1) & NM) << 8) | ((tx >> 1) & NM)] < 5) k *= 1.1;
        soil[row + tx] = pack(c[0] * k, c[1] * k, c[2] * k);
      }
    }

    const w = this.world!;
    // Fibrous grass roots in the first few rows
    for (let tx = 0; tx < TW; tx++) {
      if (grain[(tx * 7) & NM] > 70) continue;
      const top = w.top[Math.min(W - 1, (tx / TEX) | 0)] * TEX;
      const len = 4 + (grain[(tx * 13 + 5) & NM] % 14);
      let x = tx;
      for (let k = 1; k < len; k++) {
        if (grain[(tx + k * 31) & NM] < 40) x += grain[(tx * 3 + k) & NM] < 128 ? -1 : 1;
        this.tint(x, top + k, 0.74);
      }
    }
    // Stones through the soil, thicker under stony ground
    const stony = zones.filter((z) => z.kind === 'stony');
    const n = Math.round(650 * this.rocks);
    for (let k = 0; k < n + stony.length * 300; k++) {
      const z = k >= n ? stony[k % stony.length] : null;
      const tx = (z ? rng.range(z.x0, z.x1) : rng.range(1, W - 1)) * TEX;
      const top = w.top[Math.min(W - 1, (tx / TEX) | 0)];
      const ty = (z ? rng.range(top + 1, top + 30) : rng.range(top + 3, H - 2)) * TEX;
      this.pebble(tx, ty, rng.range(1, z ? 3.8 : 2.8), rng.pick(PEBBLES));
    }
    // Roots under every plant
    for (const p of plants) {
      const top = w.top[Math.max(0, Math.min(W - 1, p.x))] * TEX;
      const tx = p.x * TEX + TEX / 2;
      if (p.kind === 'tree' || p.kind === 'wood') {
        const spruce = p.kind === 'wood' && p.variant === 1;
        const n = rng.int(5, 7);
        for (let i = 0; i < n; i++) {
          const a = Math.PI / 2 + (i / (n - 1) - 0.5) * (spruce ? 2.6 : 2.1) + rng.range(-0.15, 0.15);
          this.root(rng, tx + rng.range(-4, 4), top + 2, a, rng.range(spruce ? 50 : 70, spruce ? 90 : 150), rng.range(1.8, 3), 0);
        }
      } else if (p.kind === 'bush' || p.kind === 'berry') {
        for (let i = 0; i < 3; i++) this.root(rng, tx + rng.range(-6, 6), top + 1, Math.PI / 2 + rng.range(-0.8, 0.8), rng.range(18, 40), 1.1, 1);
      } else {
        this.root(rng, tx, top + 1, Math.PI / 2 + rng.range(-0.4, 0.4), rng.range(8, 18), 0.2, 2);
      }
    }
    // Fallen logs: bark round the outside, pale rotting heartwood with long grain inside
    const wood = w.wood;
    const isWood = (x: number, y: number): boolean => x >= 0 && x < W && y >= 0 && y < H && wood[y * W + x] === 1;
    for (let i = 0; i < W * H; i++) {
      if (!wood[i]) continue;
      const cx = i % W;
      const cy = (i / W) | 0;
      const l = isWood(cx - 1, cy);
      const r = isWood(cx + 1, cy);
      const u = isWood(cx, cy - 1);
      const d = isWood(cx, cy + 1);
      for (let j = 0; j < TEX; j++) {
        const ty = cy * TEX + j;
        for (let k = 0; k < TEX; k++) {
          const tx = cx * TEX + k;
          const edge = Math.min(l ? 9 : k, r ? 9 : TEX - 1 - k, u ? 9 : j, d ? 9 : TEX - 1 - j);
          const m = mott[((ty & NM) << 8) | (tx & NM)];
          const grain = Math.sin(ty * 0.95 + m * 3 + Math.sin(tx * 0.05) * 2);
          // Bark three texels thick, split by vertical fissures; pale end grain where the log was snapped off
          const fissure = (tx + ((m * 5) | 0)) % 5 === 0;
          const endGrain = Math.min(l ? 99 : k, r ? 99 : TEX - 1 - k);
          let c: RGB = edge < 3 ? (fissure ? [56, 36, 24] : edge === 2 ? [102, 70, 46] : [80, 54, 36])
            : grain > 0.7 ? [118, 84, 54] : [148, 108, 70];
          if (endGrain < 3 && edge >= 2) c = endGrain === 1 ? [128, 94, 60] : [188, 152, 102];
          if (edge >= 4 && grain < -0.85 && m > 0.2) c = [96, 68, 44]; // rot holes
          const kk = 1 + m * 0.12 + (this.grain[((ty & NM) << 8) | (tx & NM)] < 10 ? -0.12 : 0);
          soil[ty * TW + tx] = pack(c[0] * kk, c[1] * kk, c[2] * kk);
        }
      }
    }
    // Fossils, bones and seeds pressed into the soil
    for (const b of buried) {
      if (!has(b.name)) continue;
      const d = pixels(b.name);
      const ox = Math.round(b.tx - d.width / 2);
      const oy = Math.round(b.ty - d.height / 2);
      for (let y = 0; y < d.height; y++) {
        for (let x = 0; x < d.width; x++) {
          const o = (y * d.width + x) * 4;
          if (d.data[o + 3] < 128) continue;
          const sx = ox + x;
          const sy = oy + y;
          if (sx < 0 || sy < 0 || sx >= TW || sy >= TH) continue;
          soil[sy * TW + sx] = pack(d.data[o] * 0.86, d.data[o + 1] * 0.86, d.data[o + 2] * 0.86);
        }
      }
    }
  }

  private tint(tx: number, ty: number, k: number): void {
    if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) return;
    const o = ty * TW + tx;
    this.soil[o] = scale(this.soil[o], k);
  }

  private pebble(cx: number, cy: number, r: number, c: RGB): void {
    const rx = r * 1.25;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        const nx = dx / rx;
        const ny = dy / r;
        const d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        const tx = Math.round(cx + dx);
        const ty = Math.round(cy + dy);
        if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) continue;
        let k = 1 - 0.22 * (nx * 0.5 + ny * 0.8);
        if (d2 > 0.62) k *= 0.76;
        // Half soil, half stone: pebbles sit in the ground instead of floating on it
        const o = ty * TW + tx;
        const sb = this.soil[o];
        this.soil[o] = pack(((sb & 255) * 0.45 + c[0] * 0.55) * k, (((sb >> 8) & 255) * 0.45 + c[1] * 0.55) * k, (((sb >> 16) & 255) * 0.45 + c[2] * 0.55) * k);
      }
    }
  }

  private root(rng: Rng, x: number, y: number, ang: number, len: number, width: number, depth: number): void {
    let a = ang;
    for (let s = 0; s < len; s++) {
      const rad = width * (1 - s / len) + 0.5;
      const ir = Math.ceil(rad);
      for (let dy = -ir; dy <= ir; dy++) {
        for (let dx = -ir; dx <= ir; dx++) {
          if (dx * dx + dy * dy > rad * rad) continue;
          const tx = Math.round(x + dx);
          const ty = Math.round(y + dy);
          if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) continue;
          const top = dx * dx + (dy - 1) * (dy - 1) > rad * rad;
          this.soil[ty * TW + tx] = packc(top && rad > 1 ? ROOT_HI : ROOT);
        }
      }
      a += rng.range(-0.22, 0.22) + (Math.PI / 2 - a) * 0.025;
      x += Math.cos(a);
      y += Math.sin(a);
      if (depth < 2 && rng.chance(0.03)) {
        this.root(rng, x, y, a + (rng.chance(0.5) ? -1 : 1) * rng.range(0.5, 1.1), (len - s) * rng.range(0.3, 0.6), rad * 0.55, depth + 1);
      }
    }
  }

  // ── per-cell render ────────────────────────────────────────────────

  private renderCell(x: number, y: number): void {
    const w = this.world!;
    const cells = w.cells;
    const { nb, nbi, px, soil } = this;
    let dirt = 0;
    let air = 0;
    for (let k = 0; k < 9; k++) {
      const xx = Math.min(W - 1, Math.max(0, x + (k % 3) - 1));
      const yy = Math.min(H - 1, Math.max(0, y + ((k / 3) | 0) - 1));
      const i = yy * W + xx;
      const c = cells[i];
      nb[k] = c;
      nbi[k] = i;
      if (c === DIRT) dirt++;
      else if (c === AIR) air++;
    }
    this.chunks.add(((y * TEX / CHUNK) | 0) * NX + ((x * TEX / CHUNK) | 0));
    const t0 = y * TEX * TW + x * TEX;
    if (dirt === 9) {
      for (let j = 0; j < TEX; j++) {
        const o = t0 + j * TW;
        px.set(soil.subarray(o, o + TEX), o);
      }
      return;
    }
    if (air === 9) {
      for (let j = 0; j < TEX; j++) px.fill(0, t0 + j * TW, t0 + j * TW + TEX);
      return;
    }

    const lip = this.lip[this.season];
    const winter = this.season === 3;
    for (let j = 0; j < TEX; j++) {
      const v = (j + 0.5) / TEX - 0.5;
      const qy = v < 0 ? 0 : 3;
      const fv = v < 0 ? v + 1 : v;
      const ty = y * TEX + j;
      for (let i = 0; i < TEX; i++) {
        const u = (i + 0.5) / TEX - 0.5;
        const k00 = qy + (u < 0 ? 0 : 1);
        const fu = u < 0 ? u + 1 : u;
        const c00 = nb[k00];
        const c10 = nb[k00 + 1];
        const c01 = nb[k00 + 3];
        const c11 = nb[k00 + 4];
        const w00 = (1 - fu) * (1 - fv);
        const w10 = fu * (1 - fv);
        const w01 = (1 - fu) * fv;
        const w11 = fu * fv;
        const o00 = c00 === AIR || c00 === TUNNEL ? 1 : 0;
        const o10 = c10 === AIR || c10 === TUNNEL ? 1 : 0;
        const o01 = c01 === AIR || c01 === TUNNEL ? 1 : 0;
        const o11 = c11 === AIR || c11 === TUNNEL ? 1 : 0;
        const open = o00 * w00 + o10 * w10 + o01 * w01 + o11 * w11;
        const sky = (c00 === AIR ? w00 : 0) + (c10 === AIR ? w10 : 0) + (c01 === AIR ? w01 : 0) + (c11 === AIR ? w11 : 0);
        const tx = x * TEX + i;
        const o = ty * TW + tx;
        const n = this.rough[((ty & NM) << 8) | (tx & NM)];
        const thr = 0.5 + 0.13 * n;

        if (open > thr) {
          if (sky * 2 >= open) {
            px[o] = 0;
            continue;
          }
          // Nearest tunnel corner decides chamber tint and water
          let best = k00;
          let bw = -1;
          if (c00 === TUNNEL && w00 > bw) { best = k00; bw = w00; }
          if (c10 === TUNNEL && w10 > bw) { best = k00 + 1; bw = w10; }
          if (c01 === TUNNEL && w01 > bw) { best = k00 + 3; bw = w01; }
          if (c11 === TUNNEL && w11 > bw) { best = k00 + 4; bw = w11; }
          const ti = nbi[best];
          const e = open - thr;
          // Openness rising downward means the wall is above us: a ceiling
          const gv = (1 - fu) * (o01 - o00) + fu * (o11 - o10);
          // The back wall is the same soil in shade, pulled toward a warm neutral so ants stand out
          const sb = soil[o];
          let r = (sb & 255) * 0.5 + 34;
          let g = ((sb >> 8) & 255) * 0.48 + 27;
          let b = ((sb >> 16) & 255) * 0.48 + 22;
          const role = w.room[ti];
          if (role) {
            const t = ROLE_TINT[role];
            r = r * 0.68 + t[0] * 0.32;
            g = g * 0.68 + t[1] * 0.32;
            b = b * 0.68 + t[2] * 0.32;
          }
          let k = e < 0.3 ? 0.6 + (e / 0.3) * 0.4 : 1;
          if (gv > 0.2 && e < 0.4) k *= 1 - 0.2 * (1 - e / 0.4);
          else if (gv < -0.2 && e < 0.14) k *= 1.2;
          if (w.water[ti]) {
            const wy = ty - ((ti / W) | 0) * TEX;
            if (wy < 2 && !w.water[ti - W]) {
              px[o] = packc(WATER_TOP);
              continue;
            }
            r = r * 0.28 + WATER[0] * 0.72;
            g = g * 0.28 + WATER[1] * 0.72;
            b = b * 0.28 + WATER[2] * 0.72;
            k = 0.85 + k * 0.15;
          }
          px[o] = pack(r * k, g * k, b * k);
          continue;
        }

        // Solid: rock, spoil or soil, then the edge it faces
        const rock = (c00 === ROCK ? w00 : 0) + (c10 === ROCK ? w10 : 0) + (c01 === ROCK ? w01 : 0) + (c11 === ROCK ? w11 : 0);
        const s = thr - open;
        let col: number;
        let mat = 0;
        const rthr = 0.5 + 0.2 * this.rough[(((ty + 91) & NM) << 8) | ((tx + 53) & NM)];
        if (rock > rthr) {
          mat = 2;
          const m = this.mott[(((ty + 128) & NM) << 8) | ((tx + 64) & NM)];
          // Flat-shaded facets with speckle, so stones read as chunky rock rather than grey plates
          const facet = this.mott[((((ty >> 1) + 77) & NM) << 8) | (((tx >> 1) + 31) & NM)];
          const gr0 = this.grain[(((ty + 11) & NM) << 8) | ((tx + 5) & NM)];
          const rr = rock - rthr;
          let k = (facet > 0.2 ? 1.12 : facet < -0.2 ? 0.84 : 0.98) * (1 + 0.08 * m);
          if (gr0 < 14) k *= 0.82;
          else if (gr0 > 246) k *= 1.16;
          // Lit from above: brighter where the stone continues below, darker where it continues above
          const above = (nb[0] === ROCK ? 1 : 0) + (nb[1] === ROCK ? 1 : 0) + (nb[2] === ROCK ? 1 : 0);
          const below = (nb[6] === ROCK ? 1 : 0) + (nb[7] === ROCK ? 1 : 0) + (nb[8] === ROCK ? 1 : 0);
          k *= 1 + 0.07 * (below - above) - 0.05 * (j / TEX - 0.5);
          if (rr < 0.07) k *= 0.5;
          else if (rr < 0.3) {
            const r00 = c00 === ROCK ? 1 : 0;
            const r10 = c10 === ROCK ? 1 : 0;
            const r01 = c01 === ROCK ? 1 : 0;
            const r11 = c11 === ROCK ? 1 : 0;
            const gr = (1 - fu) * (r01 - r00) + fu * (r11 - r10);
            if (gr > 0.15) k *= rr < 0.16 ? 1.34 : 1.14;
            else if (gr < -0.15) k *= 0.74;
          }
          col = packc(ROCK_C, k);
        } else {
          const mound = (c00 === MOUND ? w00 : 0) + (c10 === MOUND ? w10 : 0) + (c01 === MOUND ? w01 : 0) + (c11 === MOUND ? w11 : 0);
          if (mound > 0.5) {
            mat = 1;
            col = packc(CRUMBS[this.grain[(((ty >> 1) & NM) << 8) | ((tx >> 1) & NM)] & 3]);
          } else col = soil[o];
        }
        // A fallen log: moss in patches instead of a lawn along the top
        if (mat === 0 && w.wood[((ty / TEX) | 0) * W + ((tx / TEX) | 0)]) mat = 3;
        if (s < 0.36) {
          if (sky > open - sky) {
            // Facing the sky: grass on soil, snow on everything in winter
            if (winter && s < 0.34) col = packc(s < 0.2 ? lip[0] : lip[1]);
            else if (mat === 0 && !winter && s < 0.24) col = packc(s < 0.1 && this.grain[((ty & NM) << 8) | ((tx * 3) & NM)] > 40 ? lip[0] : lip[1]);
            else if (mat === 3 && !winter && s < 0.2 && this.mott[(((ty + 40) & NM) << 8) | ((tx * 2) & NM)] > 0.05) col = packc(s < 0.08 ? MOSS[0] : MOSS[1]);
            else if (s < 0.1) col = scale(col, mat === 0 || mat === 3 ? 0.82 : 1.16);
            else if (mat === 0) col = scale(col, 0.84);
          } else if (s < 0.07) col = scale(col, 0.55);
          else if (s < 0.18) col = scale(col, 0.8);
        }
        px[o] = col;
      }
    }
  }
}

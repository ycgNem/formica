import {
  W, H, GROUND, MOUND, TUNNEL, clampCol,
  ROLE_QUEEN, ROLE_NURSERY, ROLE_FOOD, ROLE_MIDDEN, ROLE_GRANARY,
} from './config';
import { Rng } from './rng';
import { Camera } from './camera';
import { Terrain } from './terrain';
import { Ambient, type ViewRect } from './ambient';
import { TEX, sprite, variant, frameCount, backdropVariant, canvas, hash2, type Sprite, type Look } from './sprites';
import { makeScenery, type Prop } from './layout';
import { Ant, LOAD_NONE, LOAD_SUGAR, LOAD_PROTEIN, LOAD_CORPSE, LOAD_SEED } from './ant';
import { CRITTER_INFO, critterY, type Critter, type Plant, type FoodKind } from './ecology';
import type { Sim, ToolId } from './sim';
import type { Colony, Project } from './colony';

export interface ViewState {
  tool: ToolId;
  hover: { x: number; y: number } | null;
  selected: Ant | Critter | null;
  trails: boolean;
  labels: boolean;
  /** Pheromone or soil-warmth overlay. */
  overlay: Overlay;
  /** Seconds of ambient motion this frame: 0 while paused. */
  vdt: number;
}

export type Overlay = 'none' | 'scent' | 'heat';

type RGB = [number, number, number];

/** Soil temperature colour ramp: cold blue, brood-perfect green, hot red. */
const HEAT: [number, RGB][] = [[4, [60, 90, 210]], [14, [70, 180, 220]], [23, [110, 215, 120]], [29, [150, 225, 90]], [32, [245, 190, 60]], [37, [230, 70, 45]]];
export const heatColor = (t: number): RGB => {
  if (t <= HEAT[0][0]) return HEAT[0][1];
  for (let i = 1; i < HEAT.length; i++) {
    if (t <= HEAT[i][0]) {
      const [t0, c0] = HEAT[i - 1];
      const [t1, c1] = HEAT[i];
      const k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return HEAT[HEAT.length - 1][1];
};

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1): string => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const BROOD_C = ['#f7f2e6', '#f0e3c2', '#dcc59a'];
const BROOD_R: [number, number][] = [[0.3, 0.22], [0.42, 0.3], [0.48, 0.32]];
/** Grass blade colours per season (dark, light). */
const BLADES = [['#5f9e3e', '#93cc5e'], ['#4f8a36', '#7fb84f'], ['#a8843c', '#d4ae58']];

const SKY_DAY: [RGB, RGB] = [[132, 186, 224], [226, 238, 232]];
const SKY_NIGHT: [RGB, RGB] = [[10, 16, 38], [36, 48, 82]];
const SKY_DUSK: [RGB, RGB] = [[98, 106, 158], [246, 178, 136]];
const SKY_RAIN: [RGB, RGB] = [[116, 126, 136], [170, 177, 181]];

/** How many texels each sprite's foot is pushed below the ground line, so bases and painted shadows tuck under the grass. */
const SINK: Record<string, number> = {
  tree_apple: 6, tree_apple_fruit: 6, tree_oak: 9, tree_spruce: 3, tree_birch: 3, tree_bare: 5,
  bramble: 7, log: 7, stump: 8, boulder: 8, grassclump: 7, cattails: 9, cattails2: 9, rockpile: 7, wheatgrass: 8, dandelion: 9,
  toadstool: 1, mushrooms: 1, fern: 2, fern2: 2, clover: 2, mossrock: 3, mossrock2: 3, quartz: 3, acorn: 1, pinecone: 1, snail: 1,
  beetle: 3, spider: 4, caterpillar: 2,
};
/** Birds are drawn bigger than their sprite: a robin should tower over a spider. */
const critterScale = (c: Critter): number => (c.kind === 'bird' ? 1.5 : 1);
const sinkOf = (name: string): number => SINK[name] ?? (name.startsWith('bush_') ? 8 : name.startsWith('flower_') ? 1 : 0);

const PLANTY = new Set(['grassclump', 'wheatgrass', 'cattails', 'cattails2', 'fern', 'fern2', 'clover', 'dandelion']);
const SUMMER_ONLY = new Set(['dandelion', 'snail']);
const NO_WINTER = new Set(['mushrooms', 'toadstool', 'dandelion', 'snail']);

const FOOD_SPRITE: Record<FoodKind, string | null> = {
  fruit: 'food_apple', berry: 'food_berries', seeds: 'food_seeds', carcass: 'food_carcass',
  sugar: 'food_sugar', protein: 'food_mealworm', corpse: null,
};
const FOOD_SCALE: Record<FoodKind, number> = { fruit: 0.6, berry: 0.7, seeds: 0.75, carcass: 0.8, sugar: 0.75, protein: 0.8, corpse: 1 };

interface Cloud {
  x: number;
  y: number;
  v: number;
  kind: number;
}

export class Renderer {
  readonly cam = new Camera();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrain = new Terrain();
  private readonly ambient = new Ambient();

  /** Cells dug in view during the last frame. */
  get digsInView(): number {
    return this.ambient.digsInView;
  }
  private sim: Sim | null = null;
  private props: Prop[] = [];
  private stars: { x: number; y: number; r: number; ph: number }[] = [];
  private clouds: Cloud[] = [];
  private readonly drops: { x: number; y: number; v: number }[] = [];
  private readonly sorted = new Map<Project, number[]>();
  private readonly tints = new Map<string, { key: string; c: HTMLCanvasElement }>();
  private vignette: CanvasGradient | null = null;
  private dpr = 1;
  private ax = 0;
  private ay = 0;
  private t = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    for (let k = 0; k < 320; k++) this.drops.push({ x: Math.random(), y: Math.random(), v: 0.8 + Math.random() * 0.5 });
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  attach(sim: Sim): void {
    this.sim = sim;
    this.sorted.clear();
    const r = new Rng(sim.opts.seed ^ 0x9e3779b9);
    this.stars = [];
    for (let k = 0; k < 110; k++) this.stars.push({ x: r.range(0, W), y: r.range(-26, GROUND - 14), r: r.range(0.1, 0.28), ph: r.range(0, 6) });
    this.clouds = [];
    for (let k = 0; k < 10; k++) this.clouds.push({ x: r.range(0, W + 80), y: r.range(-22, 8), v: r.range(0.6, 1.6), kind: r.pick([0, 1, 1, 3, 3, 5]) });
    const w = sim.world;
    const scene = makeScenery(sim.opts.seed, sim.zones, sim.eco.plants, (x) => w.top[clampCol(x)], w.logs);
    this.props = scene.props;
    this.terrain.attach(w, sim.opts.seed, sim.season, sim.eco.plants, scene.buried, sim.zones, sim.biome);
    this.ambient.reset(sim);
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(innerWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(innerHeight * dpr));
    this.canvas.style.width = `${innerWidth}px`;
    this.canvas.style.height = `${innerHeight}px`;
    this.cam.vw = this.canvas.width;
    this.cam.vh = this.canvas.height;
    this.cam.clamp();
    this.vignette = null;
  }

  // ── frame ───────────────────────────────────────────────────────────

  draw(dt: number, v: ViewState): void {
    const s = this.sim;
    if (!s) return;
    this.t += dt;
    const { ctx, cam } = this;
    this.terrain.setSeason(s.season);
    this.terrain.update();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1c1511';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const sc = cam.scale;
    ctx.setTransform(sc, 0, 0, sc, cam.vw / 2 - cam.x * sc, cam.vh / 2 - cam.y * sc);
    const view: ViewRect = {
      x0: cam.x - cam.vw / 2 / sc - 3,
      x1: cam.x + cam.vw / 2 / sc + 3,
      y0: cam.y - cam.vh / 2 / sc - 3,
      y1: cam.y + cam.vh / 2 / sc + 3,
    };
    this.ambient.update(s, v.vdt, view);
    // Crisp texels when magnified, filtered when shrunk below a pixel
    ctx.imageSmoothingEnabled = sc / TEX < 1;
    ctx.imageSmoothingQuality = 'high';

    const sky = this.drawSky(s);
    if (view.y0 < GROUND + 4) {
      this.drawClouds(s, view);
      this.drawBackdrop(s, 'hills', 0.3, GROUND + 3, 0.34, sky);
      this.drawBackdrop(s, 'hedge', 0.55, GROUND + 3, 0.22, sky);
      this.drawPlants(s, view, false);
      this.drawProps(s, view, false);
    }
    ctx.drawImage(this.terrain.canvas, 0, 0, W, H);
    this.drawWet(s, view);
    if (view.y0 < GROUND + 10) {
      this.drawPlants(s, view, true);
      this.drawProps(s, view, true);
      this.drawGrass(s, view);
      this.drawPits(s, view);
    }
    if (v.overlay === 'heat') this.drawHeat(s, view);
    if (v.overlay === 'scent') this.drawScent(s, view);
    else if (v.trails) this.drawTrails(s, view.x0, view.x1);
    this.drawAlarms(s, v.overlay === 'scent');
    this.drawStores(s);
    this.drawHerds(s, view);
    this.drawCorpses(s);
    this.drawFood(s, view);
    this.drawBrood(s);
    this.drawCritters(s, view);
    this.drawRafts(s);
    this.drawAnts(s, view);
    // A centipede is big enough to show over the ants mobbing it
    for (const c of s.eco.critters) if (c.kind === 'centipede' && c.x > view.x0 - 8 && c.x < view.x1 + 8) this.drawCentipede(c);
    this.drawSwarm(s, view);
    this.drawCovers(s);
    this.drawPlugs(s);
    this.ambient.draw(ctx, view, sc);
    this.drawMarkers(s);
    this.drawSelection(v);
    this.drawPreview(s, v);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawWeather(s, dt);
    const dark = s.darkness;
    if (dark > 0) {
      ctx.fillStyle = `rgba(8,14,40,${dark * 0.45})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.ambient.drawGlow(ctx, cam, this.dpr);
    this.drawVignette();
    if (v.labels) this.drawLabels(s);
  }

  /** Draw a sprite standing on the ground line at world x. */
  private blit(sp: Sprite, x: number, ground: number, flip: boolean, sink: number, k = 1): void {
    const w = (sp.w / TEX) * k;
    const h = (sp.h / TEX) * k;
    const left = Math.round((x - w / 2) * TEX) / TEX;
    const top = ground - h + (sink / TEX) * k;
    if (!flip) {
      this.ctx.drawImage(sp.img, sp.sx, sp.sy, sp.w, sp.h, left, top, w, h);
      return;
    }
    this.ctx.save();
    this.ctx.translate(left + w, top);
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(sp.img, sp.sx, sp.sy, sp.w, sp.h, 0, 0, w, h);
    this.ctx.restore();
  }

  private drawSky(s: Sim): RGB {
    const { ctx } = this;
    const L = s.light;
    const day = smooth(0.18, 0.55, L);
    let top = mix(SKY_NIGHT[0], SKY_DAY[0], day);
    let bot = mix(SKY_NIGHT[1], SKY_DAY[1], day);
    const dusk = Math.max(0, 1 - Math.abs(L - 0.3) / 0.16) * 0.75;
    top = mix(top, SKY_DUSK[0], dusk * 0.45);
    bot = mix(bot, SKY_DUSK[1], dusk);
    const rain = s.weather.intensity * 0.7;
    top = mix(top, mix(SKY_NIGHT[0], SKY_RAIN[0], day), rain);
    bot = mix(bot, mix(SKY_NIGHT[1], SKY_RAIN[1], day), rain);
    const g = ctx.createLinearGradient(0, -26, 0, GROUND + 4);
    g.addColorStop(0, css(top));
    g.addColorStop(1, css(bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, -26, W, GROUND + 34);

    // Twinkling stars
    const dark = s.darkness;
    if (dark > 0.05) {
      for (let k = 0; k < this.stars.length; k++) {
        const st = this.stars[k];
        const tw = 0.6 + 0.4 * Math.sin(this.t * 2.2 + st.ph * 5);
        ctx.fillStyle = `rgba(255,255,240,${dark * (1 - rain) * 0.9 * tw})`;
        ctx.fillRect(st.x, st.y, st.r, st.r);
      }
    }
    // Sun and moon on arcs
    const f = s.dayFrac;
    const p = (f - 0.067) / 0.667;
    if (p > -0.05 && p < 1.05) {
      const x = W * 0.06 + p * W * 0.88;
      const y = GROUND - 8 - Math.sin(Math.PI * Math.max(0, Math.min(1, p))) * 52;
      for (const [r, a] of [[11, 0.08], [7, 0.18], [5, 0.3]] as const) {
        ctx.fillStyle = `rgba(255,236,170,${a * (1 - rain)})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(255,234,156,${1 - rain * 0.8})`;
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const q = ((f - 0.733 + 1) % 1) / 0.334;
      const x = W * 0.08 + q * W * 0.84;
      const y = GROUND - 10 - Math.sin(Math.PI * Math.max(0, Math.min(1, q))) * 46;
      ctx.fillStyle = `rgba(220,228,255,${0.14 * (1 - rain)})`;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(236,238,246,${0.95 - rain * 0.7})`;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(190,196,214,${0.8 - rain * 0.6})`;
      ctx.beginPath();
      ctx.arc(x - 0.9, y - 0.6, 0.7, 0, Math.PI * 2);
      ctx.arc(x + 1, y + 0.8, 0.5, 0, Math.PI * 2);
      ctx.arc(x + 0.6, y - 1.3, 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    return bot;
  }

  private drawClouds(s: Sim, view: ViewRect): void {
    const { ctx } = this;
    const I = s.weather.intensity;
    const n = Math.round(5 + I * 5);
    const span = W + 120;
    for (let k = 0; k < n; k++) {
      const c = this.clouds[k];
      const kind = I > 0.5 && k >= 5 ? 1 : c.kind;
      const base = ((c.x + s.time * c.v * 0.12) % span) - 60;
      // Distant, so they barely move as the camera pans
      const x = base + this.cam.x * 0.8 - W * 0.4;
      if (x < view.x0 - 20 || x > view.x1 + 20) continue;
      const big = 1 + I * 0.3;
      ctx.globalAlpha = 0.9 * (1 - I * 0.55);
      this.blit(sprite(`cloud_${kind}`), x, c.y, false, 0, big);
      if (I > 0.02) {
        ctx.globalAlpha = I * 0.95;
        this.blit(variant(`cloud_${kind}`, 'grey'), x, c.y, false, 0, big);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** A parallax strip of scenery behind the meadow, hazed toward the sky colour. */
  private drawBackdrop(s: Sim, name: 'hills' | 'hedge', par: number, bottom: number, haze: number, sky: RGB): void {
    const look: Look | null = [s.season === 0 ? 'spring' : null, null, 'autumn', 'winter'][s.season] as Look | null;
    const img = backdropVariant(name, look);
    const h = s.weather.intensity;
    const tint = mix(sky, [120, 128, 136], h * 0.4);
    const key = `${s.season}:${tint.map((c) => c >> 3).join(',')}`;
    let t = this.tints.get(name);
    if (!t || t.key !== key) {
      const [c, cx] = t ? [t.c, t.c.getContext('2d')!] : canvas(img.width, img.height);
      cx.globalCompositeOperation = 'copy';
      cx.drawImage(img, 0, 0);
      cx.globalCompositeOperation = 'source-atop';
      cx.fillStyle = css(tint, haze + h * 0.15);
      cx.fillRect(0, 0, c.width, c.height);
      cx.globalCompositeOperation = 'source-over';
      t = { key, c };
      this.tints.set(name, t);
    }
    const tw = img.width / TEX;
    const th = img.height / TEX;
    const off = this.cam.x * (1 - par);
    const x0 = this.cam.x - this.cam.vw / 2 / this.cam.scale;
    const x1 = this.cam.x + this.cam.vw / 2 / this.cam.scale;
    for (let k = Math.floor((x0 - off) / tw); off + k * tw < x1; k++) this.ctx.drawImage(t.c, off + k * tw, bottom - th, tw + 0.02, th);
  }

  private plantLook(p: Plant, season: number): Sprite | null {
    switch (p.kind) {
      case 'tree':
        return [variant('tree_apple', 'blossom'), sprite('tree_apple_fruit'), variant('tree_apple', 'autumn'), sprite('tree_bare')][season];
      case 'wood': {
        const v = p.variant % 3;
        if (v === 1) return season === 3 ? variant('tree_spruce', 'snow') : sprite('tree_spruce');
        const n = v === 0 ? 'tree_oak' : 'tree_birch';
        return [variant(n, 'spring'), sprite(n), variant(n, 'autumn'), v === 0 ? sprite('tree_bare') : variant(n, 'bare')][season];
      }
      case 'bush': {
        const n = `bush_${p.variant % 7}`;
        return [variant(n, 'spring'), sprite(n), variant(n, 'autumn'), variant(n, 'snow')][season];
      }
      case 'berry':
        return [sprite('bramble'), sprite('bramble'), variant('bramble', 'autumn'), variant('bramble', 'snow')][season];
      case 'flower': {
        const n = `flower_${p.variant % 8}`;
        return season === 3 ? null : season === 2 ? variant(n, 'wilt') : sprite(n);
      }
    }
  }

  private plantName(p: Plant): string {
    if (p.kind === 'tree') return 'tree_apple';
    if (p.kind === 'wood') return ['tree_oak', 'tree_spruce', 'tree_birch'][p.variant % 3];
    if (p.kind === 'berry') return 'bramble';
    if (p.kind === 'bush') return `bush_${p.variant % 7}`;
    return `flower_${p.variant % 8}`;
  }

  /** Trees and bushes stand behind the terrain so their bases sink into the grass; flowers stand in front. */
  private drawPlants(s: Sim, view: ViewRect, front: boolean): void {
    const w = s.world;
    const order = front ? ['flower'] : ['wood', 'tree', 'bush', 'berry'];
    for (const kind of order) {
      for (const p of s.eco.plants) {
        if (p.kind !== kind || p.x < view.x0 - 16 || p.x > view.x1 + 16) continue;
        const sp = this.plantLook(p, s.season);
        if (!sp) continue;
        const name = this.plantName(p);
        const grow = p.kind === 'berry' ? 0.35 + 0.65 * p.grow : 1;
        this.blit(sp, p.x + 0.5, w.top[clampCol(p.x)], (p.x * 7 + p.variant) % 2 === 1, sinkOf(name), grow);
      }
    }
  }

  private drawProps(s: Sim, view: ViewRect, front: boolean): void {
    const w = s.world;
    const season = s.season;
    for (const pr of this.props) {
      if (pr.front !== front || pr.x < view.x0 - 14 || pr.x > view.x1 + 14) continue;
      if (season === 3 && NO_WINTER.has(pr.name)) continue;
      if (season > 1 && SUMMER_ONLY.has(pr.name)) continue;
      const planty = PLANTY.has(pr.name);
      const look: Look | null = season === 0 ? (planty ? 'spring' : null) : season === 2 ? (planty ? 'autumn' : null) : season === 3 ? (planty ? 'winter' : 'snow') : null;
      const sp = look ? variant(pr.name, look) : sprite(pr.name);
      this.blit(sp, pr.x + 0.5, w.top[clampCol(pr.x)], pr.flip, sinkOf(pr.name));
    }
  }

  /** Swaying grass blades along the surface, one texel wide. */
  private drawGrass(s: Sim, view: ViewRect): void {
    if (s.season === 3 || this.cam.scale < 3.5) return;
    const { ctx } = this;
    const w = s.world;
    const T = 1 / TEX;
    const wind = this.ambient.wind;
    const cols = BLADES[s.season];
    const x0 = Math.max(1, Math.floor(view.x0));
    const x1 = Math.min(W - 1, Math.ceil(view.x1));
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = cols[pass];
      ctx.beginPath();
      for (let x = x0; x < x1; x++) {
        const gy = w.top[x];
        if (w.cells[gy * W + x] === MOUND || w.isProtected(x) || w.wood[gy * W + x] || hash2(x, 7, 29) > s.biome.grass) continue;
        for (let b = 0; b < 3; b++) {
          if ((hash2(x, b, 17) < 0.45 ? 0 : 1) !== pass) continue;
          const bx = x + Math.floor(hash2(x, b, 3) * TEX) * T;
          const hgt = 2 + Math.floor(hash2(x, b, 5) * 6);
          const lean = (hash2(x, b, 9) - 0.5) * 2;
          const sway = Math.sin(this.t * 1.6 + x * 0.37 + b * 1.3) * wind;
          for (let k = 0; k < hgt; k++) {
            const f = (k + 1) / hgt;
            ctx.rect(bx + Math.round((sway + lean) * f * f * 2) * T, gy - (k + 1) * T, T, T);
          }
        }
      }
      ctx.fill();
    }
  }

  /** Rain darkens the topsoil while it soaks in. */
  private drawWet(s: Sim, view: ViewRect): void {
    const I = s.weather.intensity;
    if (I < 0.05 || s.isWinter) return;
    const { ctx } = this;
    const w = s.world;
    ctx.fillStyle = `rgba(40,26,30,${I * 0.22})`;
    ctx.beginPath();
    for (let x = Math.max(0, Math.floor(view.x0)); x < Math.min(W, view.x1); x++) ctx.rect(x, w.top[x] + 0.25, 1, 1.6);
    ctx.fill();
  }

  private drawTrails(s: Sim, x0: number, x1: number): void {
    const { ctx } = this;
    const w = s.world;
    for (const c of s.colonies) {
      ctx.fillStyle = c.species.ui;
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, x1); x++) {
        const t = c.trail[x];
        if (t < 0.03) continue;
        ctx.globalAlpha = Math.min(0.75, t * 0.8);
        ctx.fillRect(x, w.top[x] - 0.3, 1, 0.22);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Pheromone view: each colony's home range as a wash above the ground, food trails as bars by strength. */
  private drawScent(s: Sim, view: ViewRect): void {
    const { ctx } = this;
    const w = s.world;
    const x0 = Math.max(0, Math.floor(view.x0));
    const x1 = Math.min(W, Math.ceil(view.x1));
    s.colonies.forEach((c, i) => {
      ctx.fillStyle = c.species.ui;
      for (let x = x0; x < x1; x++) {
        const hm = c.home[x];
        if (hm >= 0.04) {
          ctx.globalAlpha = Math.min(0.3, hm * 0.35);
          ctx.fillRect(x, w.top[x] - 3.2 - i * 0.4, 1, 3.2);
        }
      }
      for (let x = x0; x < x1; x++) {
        const t = c.trail[x];
        if (t < 0.02) continue;
        ctx.globalAlpha = Math.min(0.95, 0.25 + t);
        ctx.fillRect(x + 0.1, w.top[x] - 0.4 - t * 2.4, 0.8, t * 2.4 + 0.15);
      }
    });
    ctx.globalAlpha = 1;
  }

  /** Alarm pheromone: a red bloom that spreads and fades where an ant was attacked. */
  private drawAlarms(s: Sim, strong: boolean): void {
    const { ctx } = this;
    for (const al of s.alarms) {
      const k = 1 - al.t / 8;
      const r = 1.4 + Math.sqrt(al.t) * 2.2 + al.power * 0.35;
      const y = al.under ? al.y : al.y - 0.3;
      const g = ctx.createRadialGradient(al.x, y, 0, al.x, y, r);
      g.addColorStop(0, `rgba(232,58,40,${(strong ? 0.6 : 0.35) * k})`);
      g.addColorStop(0.6, `rgba(232,58,40,${(strong ? 0.25 : 0.12) * k})`);
      g.addColorStop(1, 'rgba(232,58,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(al.x - r, y - r, r * 2, r * 2);
    }
  }

  /** Soil warmth: a colour band per row underground, clipped to the soil. */
  private drawHeat(s: Sim, view: ViewRect): void {
    const { ctx } = this;
    const w = s.world;
    const x0 = Math.max(0, Math.floor(view.x0));
    const x1 = Math.min(W, Math.ceil(view.x1));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, H);
    for (let x = x0; x <= x1 && x < W; x++) {
      ctx.lineTo(x, w.top[x]);
      ctx.lineTo(x + 1, w.top[x]);
    }
    ctx.lineTo(x1, H);
    ctx.closePath();
    ctx.clip();
    const y0 = Math.max(0, Math.floor(view.y0));
    const y1 = Math.min(H, Math.ceil(view.y1));
    for (let y = y0; y < y1; y++) {
      ctx.fillStyle = css(heatColor(s.tempAt(y)), 0.42);
      ctx.fillRect(x0, y, x1 - x0, 1.02);
    }
    ctx.restore();
  }

  /** Chamber cells, floor first, cached per project. */
  private floorFirst(p: Project): number[] {
    let c = this.sorted.get(p);
    if (!c) {
      c = [...p.cells].sort((a, b) => b - a);
      this.sorted.set(p, c);
    }
    return c;
  }

  private drawStores(s: Sim): void {
    const { ctx } = this;
    const w = s.world;
    const h = (n: number): number => hash2(n, 0, 11);
    for (const c of s.colonies) {
      if (c.foodChambers.length) {
        const fill = Math.min(1, c.stored / c.cap);
        const share = c.stored > 0 ? c.sugar / c.stored : 1;
        for (const kind of [0, 1]) {
          ctx.fillStyle = kind === 0 ? '#e9b44c' : '#d9826b';
          ctx.beginPath();
          for (const p of c.foodChambers) {
            const cells = this.floorFirst(p);
            const n = Math.floor(fill * cells.length * 0.9);
            for (let k = 0; k < n; k++) {
              const i = cells[k];
              if (w.cells[i] !== TUNNEL) continue;
              if ((h(i) < share ? 0 : 1) !== kind) continue;
              circle(ctx, (i % W) + 0.3 + h(i * 3) * 0.4, Math.floor(i / W) + 0.55 + h(i * 5) * 0.2, 0.34);
            }
          }
          ctx.fill();
        }
        // A glint on each droplet
        ctx.fillStyle = 'rgba(255,250,230,0.55)';
        ctx.beginPath();
        for (const p of c.foodChambers) {
          const cells = this.floorFirst(p);
          const n = Math.floor(fill * cells.length * 0.9);
          for (let k = 0; k < n; k += 2) {
            const i = cells[k];
            if (w.cells[i] !== TUNNEL) continue;
            circle(ctx, (i % W) + 0.2 + h(i * 3) * 0.4, Math.floor(i / W) + 0.45 + h(i * 5) * 0.2, 0.09);
          }
        }
        ctx.fill();
      }
      if (c.granaryChambers.length && c.seeds > 0) {
        // Seeds heaped on the granary floors
        const fill = Math.min(1, c.seeds / Math.max(1, c.seedCap));
        ctx.fillStyle = '#d9b56c';
        ctx.beginPath();
        for (const p of c.granaryChambers) {
          const cells = this.floorFirst(p);
          const n = Math.floor(fill * cells.length * 0.9);
          for (let k = 0; k < n; k++) {
            const i = cells[k];
            if (w.cells[i] !== TUNNEL) continue;
            for (let j = 0; j < 3; j++) blob(ctx, (i % W) + 0.2 + h(i * 7 + j) * 0.6, Math.floor(i / W) + 0.5 + h(i * 13 + j) * 0.35, 0.16, 0.1, h(i + j) * 3);
          }
        }
        ctx.fill();
      }
      if (c.middenChambers.length && c.midden > 0) {
        ctx.fillStyle = '#3e322b';
        ctx.beginPath();
        const per = c.midden / c.middenChambers.length / 2;
        for (const p of c.middenChambers) {
          const cells = this.floorFirst(p);
          const n = Math.min(cells.length, Math.floor(per));
          for (let k = 0; k < n; k++) {
            const i = cells[k];
            if (w.cells[i] !== TUNNEL) continue;
            blob(ctx, (i % W) + 0.5, Math.floor(i / W) + 0.65, 0.42, 0.22, h(i) * 3);
          }
        }
        ctx.fill();
      }
    }
  }

  /** Root aphids: a cluster of little green bodies round a root, with honeydew beading on them. */
  private drawHerds(s: Sim, view: ViewRect): void {
    const { ctx } = this;
    const h = (n: number, k: number): number => hash2(n, k, 23);
    const COLS = ['#4a3324', '#7a5638', '#3f6a24', '#97c850', 'rgba(246,196,90,0.95)'];
    for (let pass = 0; pass < COLS.length; pass++) {
      ctx.fillStyle = COLS[pass];
      ctx.beginPath();
      for (const hd of s.eco.herds) {
        const cx = (hd.cell % W) + 0.5;
        const cy = Math.floor(hd.cell / W) + 0.5;
        if (cx < view.x0 - 3 || cx > view.x1 + 3 || cy < view.y0 - 3 || cy > view.y1 + 3) continue;
        if (pass < 2) {
          // The root they cling to, dark edge then lit core
          blob(ctx, cx, cy + 0.15, 2.3 - pass * 0.1, 0.34 - pass * 0.12, 0.5);
          continue;
        }
        const n = pass < 4 ? Math.max(2, Math.round(hd.size / 3)) : Math.min(6, Math.floor(hd.honey / 4));
        for (let k = 0; k < n; k++) {
          const a = h(hd.id, k) * Math.PI * 2;
          const t = (h(hd.id, k + 50) - 0.5) * 3.6;
          const x = cx + t * Math.cos(0.5) + Math.cos(a) * 0.2;
          const y = cy + 0.15 + t * Math.sin(0.5) + Math.sin(a) * 0.25;
          if (pass === 2) blob(ctx, x, y, 0.36, 0.27, 0.5);
          else if (pass === 3) blob(ctx, x - 0.04, y - 0.05, 0.27, 0.18, 0.5);
          else circle(ctx, x + 0.25, y - 0.3, 0.11);
        }
      }
      ctx.fill();
    }
  }

  private drawCorpses(s: Sim): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(40,30,26,0.8)';
    ctx.beginPath();
    for (const c of s.corpses) blob(ctx, (c.at % W) + 0.5, Math.floor(c.at / W) + 0.7, 0.45, 0.2, 0);
    ctx.fill();
  }

  private drawFood(s: Sim, view: ViewRect): void {
    const { ctx } = this;
    const w = s.world;
    for (const f of s.eco.food) {
      if (f.x < view.x0 - 4 || f.x > view.x1 + 4) continue;
      const x = f.x + 0.5;
      const y = w.top[f.x];
      const frac = Math.max(0.15, f.amount / f.max);
      const name = FOOD_SPRITE[f.kind];
      if (!name) {
        // A dead ant
        ctx.fillStyle = '#3a2a22';
        ctx.beginPath();
        blob(ctx, x, y - 0.25, 0.5, 0.25, 0);
        circle(ctx, x + 0.5, y - 0.25, 0.16);
        ctx.fill();
        continue;
      }
      if (f.kind === 'sugar') {
        const r = 0.9 + 1.1 * frac;
        ctx.fillStyle = 'rgba(240,180,70,0.7)';
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.3, r * 0.35, 0, Math.PI, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = frac < 0.3 ? 0.45 + frac * 1.8 : 1;
      const sp = sprite(name);
      if (f.kind === 'seeds') {
        // A heap that shrinks as it's carried off
        const n = Math.ceil(frac * 3);
        for (let k = 0; k < n; k++) this.blit(sp, x + (k - (n - 1) / 2) * 1.6, y, k % 2 === 1, 1, 0.75);
      } else this.blit(sp, x, y, f.id % 2 === 1, f.kind === 'fruit' ? 2 : 1, FOOD_SCALE[f.kind]);
      ctx.globalAlpha = 1;
    }
  }

  private drawBrood(s: Sim): void {
    const { ctx } = this;
    for (let st = 0; st < 3; st++) {
      for (const pass of [0, 1]) {
        ctx.fillStyle = pass ? BROOD_C[st] : 'rgba(70,48,34,0.55)';
        ctx.beginPath();
        for (const c of s.colonies) {
          for (const b of c.brood) {
            if (b.stage !== st) continue;
            const big = b.caste === 'worker' ? 1 : 1.3;
            let x: number;
            let y: number;
            if (b.carrier) {
              this.place(b.carrier);
              const u = this.antSize(b.carrier);
              x = this.ax + b.carrier.hx * 0.95 * u;
              y = this.ay + b.carrier.hy * 0.95 * u;
            } else {
              x = (b.cell % W) + 0.5 + b.ox;
              y = Math.floor(b.cell / W) + 0.5 + b.oy;
            }
            // A soft outline first so pale brood reads against pale soil
            const o = pass ? 0 : 0.07;
            blob(ctx, x, y, BROOD_R[st][0] * big + o, BROOD_R[st][1] * big + o, b.carrier ? 0 : 0.2);
          }
        }
        ctx.fill();
      }
    }
  }

  private critterSprite(c: Critter): Sprite {
    if (c.kind === 'bird') {
      const fly = c.alt > 0 || c.leaving;
      return sprite('bird', fly ? 2 + (Math.floor(this.t * 9 + c.id) % 2) : c.biteT > CRITTER_INFO.bird.bite - 0.3 ? 1 : 0);
    }
    if (c.kind === 'ladybird') return sprite('ladybird', Math.floor(Math.abs(c.x) * 6) % 2);
    const n = frameCount(c.kind);
    const moving = c.attackers.length === 0 || c.leaving;
    const f = moving ? Math.floor(Math.abs(c.x) * (c.kind === 'spider' ? 2.2 : 3.2)) % n : Math.floor(this.t * 5) % n;
    return sprite(c.kind, f);
  }

  private drawCritters(s: Sim, view: ViewRect): void {
    const { ctx } = this;
    const w = s.world;
    for (const c of s.eco.critters) {
      if (c.x < view.x0 - 8 || c.x > view.x1 + 8) continue;
      if (c.kind === 'centipede') continue;
      const g = w.top[clampCol(c.x)];
      const x = c.x + 0.5;
      const sp = this.critterSprite(c);
      if (c.alt > 0) {
        // A shadow on the ground under a flyer, smaller and fainter the higher it is
        const k = Math.max(0.15, 1 - c.alt / 30);
        ctx.fillStyle = `rgba(30,20,12,${0.28 * k})`;
        ctx.beginPath();
        blob(ctx, x, g - 0.05, (sp.w / TEX) * critterScale(c) * 0.35 * k, 0.16, 0);
        ctx.fill();
      }
      this.blit(sp, x, g - c.alt, c.dir < 0, c.alt > 0 ? 0 : sinkOf(c.kind), critterScale(c));
      if (c.hp < c.maxHp) {
        const bw = 3;
        const by = g - c.alt - (sp.h / TEX) * critterScale(c) - 0.4;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x - bw / 2, by, bw, 0.35);
        ctx.fillStyle = '#e05a3c';
        ctx.fillRect(x - bw / 2, by, (bw * Math.max(0, c.hp)) / c.maxHp, 0.35);
      }
    }
  }

  /** A centipede: a chain of segments laid along its own track through the tunnels, legs rippling down its length. */
  private drawCentipede(c: Critter): void {
    const { ctx } = this;
    const SEG = 13;
    const GAP = 0.36;
    const poly = [c.x, c.y, ...c.trail];
    const seg: number[] = [c.x, c.y];
    let carry = 0;
    for (let i = 0; i + 3 < poly.length && seg.length < SEG * 2; i += 2) {
      const ax = poly[i];
      const ay = poly[i + 1];
      const dx = poly[i + 2] - ax;
      const dy = poly[i + 3] - ay;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      let t = GAP - carry;
      while (t <= d && seg.length < SEG * 2) {
        seg.push(ax + (dx * t) / d, ay + (dy * t) / d);
        t += GAP;
      }
      carry = d - (t - GAP);
    }
    while (seg.length < SEG * 2) {
      const n = seg.length;
      seg.push(seg[n - 2] - c.dir * GAP, seg[n - 1]);
    }
    const n = seg.length / 2;
    const axis = (i: number): [number, number] => {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = seg[a * 2] - seg[b * 2];
      const dy = seg[a * 2 + 1] - seg[b * 2 + 1];
      const l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    };
    const moving = c.attackers.length === 0 || c.leaving;
    // Legs: a pair per segment, swinging in a wave that runs down the body
    ctx.strokeStyle = '#c99a4a';
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      const [ax, ay] = axis(i);
      const sw = Math.sin((moving ? this.t * 16 : this.t * 4) - i * 0.9) * 0.14;
      const x = seg[i * 2];
      const y = seg[i * 2 + 1];
      const len = i === n - 1 ? 0.75 : 0.5;
      for (const side of [-1, 1]) {
        ctx.moveTo(x, y);
        ctx.lineTo(x - ay * side * len + ax * sw * side, y + ax * side * len + ay * sw * side);
      }
    }
    // Antennae, feeling ahead
    const [hx, hy] = axis(0);
    const wig = Math.sin(this.t * 7) * 0.15;
    for (const side of [-1, 1]) {
      ctx.moveTo(c.x + hx * 0.15, c.y + hy * 0.15);
      ctx.lineTo(c.x + hx * 0.95 - hy * side * (0.3 + wig), c.y + hy * 0.95 + hx * side * (0.3 + wig));
    }
    ctx.stroke();
    // Segments, tail first so the head sits on top: dark rim, then alternating rust plates
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const r = (i === 0 ? 0.3 : 0.28 - (i / n) * 0.08) + (pass === 0 ? 0.06 : 0);
        ctx.fillStyle = pass === 0 ? '#2a140a' : i === 0 ? '#5a2410' : i % 2 ? '#a3461f' : '#c2602e';
        ctx.beginPath();
        ctx.arc(seg[i * 2], seg[i * 2 + 1], r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (c.hp < c.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(c.x - 1, c.y - 0.9, 2, 0.28);
      ctx.fillStyle = '#e05a3c';
      ctx.fillRect(c.x - 1, c.y - 0.9, (2 * Math.max(0, c.hp)) / c.maxHp, 0.28);
    }
  }

  /** Antlion pits: a cone of sliding sand, with the jaws showing at the bottom when it's hungry. */
  private drawPits(s: Sim, view: ViewRect): void {
    const { ctx } = this;
    const w = s.world;
    for (const p of s.danger.pits) {
      if (p.x < view.x0 - 3 || p.x > view.x1 + 3) continue;
      const g = w.top[p.x];
      const cx = p.x + 0.5;
      // A rim of thrown-out sand, then the cone, darker towards the bottom
      ctx.fillStyle = '#e2cb93';
      ctx.beginPath();
      ctx.ellipse(cx, g - 0.05, 2.7, 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b08d58';
      ctx.beginPath();
      ctx.moveTo(cx - 2.2, g - 0.02);
      ctx.lineTo(cx, g + 1.8);
      ctx.lineTo(cx + 2.2, g - 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#86683d';
      ctx.beginPath();
      ctx.moveTo(cx - 1.2, g + 0.8);
      ctx.lineTo(cx, g + 1.8);
      ctx.lineTo(cx + 1.2, g + 0.8);
      ctx.closePath();
      ctx.fill();
      if (p.sated > 0 && !p.victim) continue;
      // The jaws: open and waiting, or snapping at a victim
      const open = p.victim ? 0.25 + Math.abs(Math.sin(this.t * 9)) * 0.35 : 0.5;
      ctx.strokeStyle = '#3a2412';
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      for (const side of [-1, 1]) {
        ctx.moveTo(cx, g + 1.65);
        ctx.quadraticCurveTo(cx + side * open, g + 1.3, cx + side * open * 0.4, g + 1);
      }
      ctx.stroke();
    }
  }

  /** The army ant column: a seething dark carpet of ants on the surface, and raiders streaming into a nest. */
  private drawSwarm(s: Sim, view: ViewRect): void {
    const sw = s.danger.swarm;
    if (!sw) return;
    const { ctx } = this;
    const w = s.world;
    const lo = Math.min(sw.x, sw.x - sw.dir * sw.len);
    const hi = Math.max(sw.x, sw.x - sw.dir * sw.len);
    if (hi >= view.x0 - 2 && lo <= view.x1 + 2) {
      // A dark, seething carpet, thinning out at the head and the tail of the column
      for (let x = Math.max(0, Math.floor(lo)); x < Math.min(W, hi); x++) {
        const k = Math.min(1, (hi - x) / 5, (x - lo) / 5);
        ctx.fillStyle = `rgba(48,14,6,${0.55 * k})`;
        ctx.fillRect(x, w.top[x] - 0.42, 1, 0.5);
      }
      const n = Math.floor(sw.len * 12);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass === 0 ? '#2a0d05' : '#7a2e12';
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const back = hash2(i, 1, 31) * sw.len;
          const x = sw.x - sw.dir * back + Math.sin(this.t * 3.1 + i * 1.7) * 0.8;
          if (x < view.x0 || x > view.x1 || x < 0 || x >= W) continue;
          const y = w.top[clampCol(x)] - 0.2 - hash2(i, 2, 31) * 0.9;
          const f = sw.dir * (Math.sin(this.t * 2 + i) > -0.6 ? 1 : -1);
          if (pass === 0) {
            blob(ctx, x + f * 0.24, y - 0.02, 0.11, 0.09, 0);
            blob(ctx, x, y, 0.14, 0.07, 0);
            blob(ctx, x - f * 0.26, y + 0.01, 0.18, 0.11, 0);
          } else if (i % 3 === 0) blob(ctx, x - f * 0.28, y - 0.03, 0.08, 0.04, 0);
        }
        ctx.fill();
      }
    }
    if (!sw.raiding) return;
    // Raiders in the tunnels near the entrance, down as far as they've got
    const rx = sw.root % W;
    const floor = w.top[rx] + sw.reach;
    ctx.fillStyle = '#3e170b';
    ctx.beginPath();
    for (let y = Math.max(0, w.top[rx] - 1); y < Math.min(H, floor); y++) {
      for (let x = Math.max(0, rx - 30); x <= Math.min(W - 1, rx + 30); x++) {
        const i = y * W + x;
        if (w.cells[i] !== TUNNEL || hash2(x, y, 41) < 0.4) continue;
        const ph = this.t * 1.3 + hash2(x, y, 43) * 6;
        const ax = x + 0.5 + Math.sin(ph) * 0.35;
        const ay = y + 0.7 + Math.cos(ph * 0.7) * 0.12;
        blob(ctx, ax, ay, 0.16, 0.07, 0);
        blob(ctx, ax + 0.19, ay, 0.08, 0.07, 0);
      }
    }
    ctx.fill();
  }

  /** Fire ants afloat: a dark mat of linked bodies under the ants sitting on it. */
  private drawRafts(s: Sim): void {
    const { ctx } = this;
    const w = s.world;
    for (const c of s.colonies) {
      if (!c.rafting) continue;
      let n = 0;
      for (const a of c.ants) if (a.intent === 'raft' && !a.under && Math.abs(a.x - c.raftX) < 3) n++;
      if (!n) continue;
      ctx.fillStyle = 'rgba(90,30,16,0.85)';
      ctx.beginPath();
      blob(ctx, c.raftX + 0.5, w.top[c.raftX] - 0.12, 0.5 + Math.sqrt(n) * 0.3, 0.18, 0);
      ctx.fill();
    }
  }

  private antSize(a: Ant): number {
    const sp = a.colony.species;
    return sp.size * (a.caste === 'queen' ? 1.75 : a.caste === 'soldier' ? 1.15 : a.caste === 'alate' ? (a.male ? 0.95 : 1.25) : a.caste === 'replete' ? 1.1 : 1);
  }

  /** Position of an ant in world units, with its lane offset and small nudges for digging and fighting. */
  private place(a: Ant): void {
    let x = a.x;
    let y = a.y;
    if (a.under) {
      x += a.ox;
      y += a.oy;
    }
    if (a.intent === 'digging' && a.target >= 0) {
      const tx = (a.target % W) + 0.5;
      const ty = Math.floor(a.target / W) + 0.5;
      const j = 0.3 + Math.sin(this.t * 30 + a.id) * 0.08;
      x += (tx - x) * j;
      y += (ty - y) * j;
    } else if (a.intent === 'fight') {
      x += Math.sin(this.t * 37 + a.id) * 0.14;
      y += Math.cos(this.t * 29 + a.id) * 0.08;
    } else if (a.intent === 'hang') {
      // Clinging to the ceiling, swaying a little
      y -= 0.32;
      x += Math.sin(this.t * 0.8 + a.id) * 0.05;
    } else if (a.intent === 'trapped') {
      // Half buried in the pit, scrabbling at the sliding sand
      y += 0.55;
      x += Math.sin(this.t * 24 + a.id) * 0.12;
    }
    this.ax = x;
    this.ay = y;
  }

  private drawAnts(s: Sim, view: ViewRect): void {
    const { ctx } = this;
    const sc = this.cam.scale;
    const legs = sc > 7;
    const shine = sc > 6;
    const { x0, x1, y0, y1 } = view;
    const inView = (a: Ant): boolean => a.x > x0 && a.x < x1 && a.y > y0 && a.y < y1;
    // Soft contact shadows for ants on the surface
    ctx.fillStyle = 'rgba(30,20,12,0.22)';
    ctx.beginPath();
    for (const c of s.colonies) {
      for (const a of c.ants) {
        if (a.under || a.intent === 'fly' || !inView(a)) continue;
        const u = this.antSize(a);
        blob(ctx, a.x, s.world.top[clampCol(a.x)] - 0.04, 0.6 * u, 0.13 * u, 0);
      }
    }
    ctx.fill();
    for (const c of s.colonies) {
      const sp = c.species;
      // Wings first so bodies sit on top
      if (c.alateCount > 0) {
        ctx.fillStyle = 'rgba(236,242,252,0.6)';
        ctx.strokeStyle = 'rgba(160,176,200,0.6)';
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        for (const a of c.ants) {
          if (a.caste !== 'alate' || !inView(a)) continue;
          this.place(a);
          const u = this.antSize(a);
          const rot = Math.atan2(a.hy, a.hx);
          const flap = a.intent === 'fly' ? Math.sin(this.t * 50 + a.id) * 0.5 : 0;
          blob(ctx, this.ax - a.hx * 0.5 * u, this.ay - a.hy * 0.5 * u - 0.3 * u, 0.85 * u, 0.3 * u, rot - 0.35 + flap);
          blob(ctx, this.ax - a.hx * 0.5 * u, this.ay - a.hy * 0.5 * u + 0.3 * u, 0.85 * u, 0.3 * u, rot + 0.35 - flap);
        }
        ctx.fill();
        ctx.stroke();
      }
      if (legs) {
        ctx.strokeStyle = sp.color;
        ctx.lineWidth = 0.08;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const a of c.ants) {
          if (!inView(a)) continue;
          this.legs(a);
        }
        ctx.stroke();
      }
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      for (const a of c.ants) {
        if (a.caste === 'queen' || !inView(a)) continue;
        this.antPath(a);
      }
      ctx.fill();
      // Males are small and dark, with big eyes and long wings for their size
      if (c.alateCount > 0) {
        ctx.fillStyle = 'rgba(18,12,10,0.5)';
        ctx.beginPath();
        for (const a of c.ants) {
          if (!a.male || !inView(a)) continue;
          this.antPath(a);
        }
        ctx.fill();
      }
      if (c.queenAlive && inView(c.queen)) {
        ctx.fillStyle = sp.queen;
        ctx.beginPath();
        this.antPath(c.queen);
        ctx.fill();
      }
      if (shine) {
        // A glossy highlight on head and gaster
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        for (const a of c.ants) {
          if (!inView(a) || (a.caste === 'queen' && !c.queenAlive)) continue;
          this.place(a);
          const u = this.antSize(a);
          const rot = Math.atan2(a.hy, a.hx);
          blob(ctx, this.ax - a.hx * 0.55 * u - a.hy * 0.08 * u, this.ay - a.hy * 0.55 * u - 0.12 * u, 0.22 * u, 0.1 * u, rot);
          blob(ctx, this.ax + a.hx * 0.5 * u, this.ay + a.hy * 0.5 * u - 0.09 * u, 0.08 * u, 0.05 * u, rot);
        }
        ctx.fill();
      }
    }
    // Repletes: a gaster swollen into a ball of honey, as full as the colony's sugar stores
    for (const c of s.colonies) {
      if (!c.repleteCount) continue;
      const fill = Math.min(1, c.sugar / Math.max(1, c.cap));
      for (const pass of [0, 1, 2]) {
        ctx.fillStyle = pass === 0 ? 'rgba(92,52,20,0.9)' : pass === 1 ? 'rgba(232,160,48,0.92)' : 'rgba(255,236,180,0.85)';
        ctx.beginPath();
        for (const a of c.ants) {
          if (a.caste !== 'replete' || !inView(a)) continue;
          this.place(a);
          const u = this.antSize(a);
          const r = (0.42 + 0.5 * fill) * u;
          const gx = this.ax - a.hx * (0.45 * u + r * 0.6);
          const gy = this.ay - a.hy * (0.45 * u + r * 0.6) + r * 0.25;
          if (pass === 0) circle(ctx, gx, gy, r + 0.06);
          else if (pass === 1) circle(ctx, gx, gy, r);
          else circle(ctx, gx - r * 0.35, gy - r * 0.35, r * 0.22);
        }
        ctx.fill();
      }
    }
    // A crop full of sugar swells the gaster and shows amber through it
    ctx.fillStyle = 'rgba(240,178,64,0.78)';
    ctx.beginPath();
    for (const c of s.colonies) {
      for (const a of c.ants) {
        if (a.load !== LOAD_SUGAR || !inView(a)) continue;
        this.place(a);
        const u = this.antSize(a);
        const full = 0.75 + 0.25 * Math.min(1, a.loadAmt / c.species.carry);
        blob(ctx, this.ax - a.hx * 0.55 * u, this.ay - a.hy * 0.55 * u, 0.5 * u * full, 0.36 * u * full, Math.atan2(a.hy, a.hx));
      }
    }
    ctx.fill();
    // What they carry in their mandibles
    const loads: [number, string][] = [[LOAD_PROTEIN, '#e39a7c'], [LOAD_SEED, '#d9b56c'], [LOAD_CORPSE, '#3b2c25'], [-1, '#c9a274']];
    for (const [kind, col] of loads) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (const c of s.colonies) {
        for (const a of c.ants) {
          if (kind === -1 ? a.carry <= 0 || a.load !== LOAD_NONE : a.load !== kind) continue;
          if (!inView(a)) continue;
          this.place(a);
          const u = this.antSize(a);
          circle(ctx, this.ax + a.hx * 0.85 * u, this.ay + a.hy * 0.85 * u, (kind === LOAD_CORPSE ? 0.35 : 0.3) * u);
        }
      }
      ctx.fill();
    }
  }

  private antPath(a: Ant): void {
    this.place(a);
    const { ctx, ax, ay } = this;
    const u = this.antSize(a);
    const hx = a.hx;
    const hy = a.hy;
    const rot = Math.atan2(hy, hx);
    const head = a.caste === 'soldier' ? 0.25 * a.colony.species.soldierHead * 1.25 : 0.25;
    blob(ctx, ax - hx * 0.5 * u, ay - hy * 0.5 * u, 0.5 * u, 0.34 * u, rot);
    blob(ctx, ax, ay, 0.24 * u, 0.2 * u, rot);
    blob(ctx, ax + hx * (0.42 + head * 0.3) * u, ay + hy * (0.42 + head * 0.3) * u, head * u, head * u * 0.95, rot);
  }

  private legs(a: Ant): void {
    this.place(a);
    const { ctx, ax, ay } = this;
    const u = this.antSize(a);
    const px = -a.hy;
    const py = a.hx;
    const moving = a.legs.length > 0;
    for (let i = -1; i <= 1; i++) {
      const sw = moving ? Math.sin(a.walk * 3 + i * 2) * 0.18 : 0;
      for (const side of [-1, 1]) {
        const off = i * 0.22 + sw * side;
        ctx.moveTo(ax + a.hx * off * u, ay + a.hy * off * u);
        ctx.lineTo(ax + (a.hx * (off + i * 0.25) + px * side * 0.55) * u, ay + (a.hy * (off + i * 0.25) + py * side * 0.55) * u);
      }
    }
    // Antennae
    const hx = ax + a.hx * 0.6 * u;
    const hy = ay + a.hy * 0.6 * u;
    for (const side of [-1, 1]) {
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + (a.hx * 0.45 + px * side * 0.3) * u, hy + (a.hy * 0.45 + py * side * 0.3) * u);
    }
  }

  private drawCovers(s: Sim): void {
    const { ctx } = this;
    const sp = s.isWinter ? variant('leaf', 'winter') : s.season === 2 ? variant('leaf', 'autumn') : sprite('leaf');
    const k = 13 / (sp.w / TEX);
    for (const c of s.covers) {
      const left = (c.until - s.time) / 50;
      ctx.globalAlpha = Math.max(0.25, Math.min(1, left));
      this.blit(sp, c.x + 0.5, s.world.top[clampCol(c.x)] - 0.15, false, 0, k);
    }
    ctx.globalAlpha = 1;
  }

  /** Pebbles sitting in plugged entrances, sunk a little into the hole. */
  private drawPlugs(s: Sim): void {
    const sp = s.isWinter ? variant('flatpebble', 'snow') : sprite('flatpebble');
    for (const p of s.plugs) {
      const left = (p.until - s.time) / 20;
      this.ctx.globalAlpha = Math.max(0.3, Math.min(1, left));
      const x = p.root % W;
      this.blit(sp, x + 0.5, s.world.top[x] + 0.6, false, 0, 1.25);
    }
    this.ctx.globalAlpha = 1;
  }

  private drawMarkers(s: Sim): void {
    const { ctx } = this;
    const col = s.player?.species.ui ?? '#fff';
    for (const m of s.markers) {
      const pulse = 1 + Math.sin(this.t * 4) * 0.2;
      ctx.strokeStyle = col;
      ctx.lineWidth = 0.18;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 1.3 * pulse, 0, Math.PI * 2);
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x, m.y - 3);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - 3);
      ctx.lineTo(m.x + 2, m.y - 2.4);
      ctx.lineTo(m.x, m.y - 1.8);
      ctx.fill();
    }
  }

  private drawSelection(v: ViewState): void {
    const sel = v.selected;
    if (!sel) return;
    const { ctx } = this;
    let x: number;
    let y: number;
    let r: number;
    if (sel instanceof Ant) {
      if (sel.dead) return;
      this.place(sel);
      x = this.ax;
      y = this.ay;
      r = 1.4 * this.antSize(sel);
    } else if (sel.kind === 'centipede') {
      if (sel.dead) return;
      x = sel.x;
      y = sel.y;
      r = 1.4;
    } else {
      if (sel.dead || !this.sim) return;
      const sp = this.critterSprite(sel);
      x = sel.x + 0.5;
      y = critterY(sel, this.sim.world.top) - (sp.h / TEX / 2) * critterScale(sel) + 0.2;
      r = (Math.max(sp.w, sp.h) / TEX) * 0.6 * critterScale(sel);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 0.16;
    ctx.setLineDash([0.5, 0.35]);
    ctx.beginPath();
    ctx.arc(x, y, r + Math.sin(this.t * 5) * 0.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawPreview(s: Sim, v: ViewState): void {
    const h = v.hover;
    if (!h || v.tool === 'inspect') return;
    const { ctx } = this;
    const col = clampCol(h.x);
    const g = s.world.top[col];
    const x = col + 0.5;
    const surface = h.y < g + 2.5;
    ctx.globalAlpha = surface || v.tool === 'dig' || v.tool === 'squish' ? 0.6 : 0.25;
    switch (v.tool) {
      case 'sugar':
        this.blit(sprite('food_sugar'), x, g, false, 1);
        break;
      case 'protein':
        this.blit(sprite('food_mealworm'), x, g, false, 1);
        break;
      case 'leaf': {
        const sp = sprite('leaf');
        this.blit(sp, x, g - 0.15, false, 0, 13 / (sp.w / TEX));
        break;
      }
      case 'bush':
        this.blit(sprite('bramble'), x, g, false, sinkOf('bramble'));
        break;
      case 'plug':
        this.blit(sprite('flatpebble'), x, g + 0.6, false, 0, 1.25);
        break;
      case 'aphids': {
        // Show which plant's roots they would go on
        const host = s.eco.plants.filter((p) => p.kind !== 'flower' && Math.abs(p.x - col) < 8).sort((a, b) => Math.abs(a.x - col) - Math.abs(b.x - col))[0];
        ctx.strokeStyle = host ? '#8fbf4a' : '#e05a3c';
        ctx.lineWidth = 0.2;
        ctx.beginPath();
        ctx.arc(host ? host.x + 0.5 : x, g + 8, 2.4, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'dig': {
        ctx.strokeStyle = h.y > g + 8 ? '#ffffff' : '#e05a3c';
        ctx.lineWidth = 0.2;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 1.3, 0, Math.PI * 2);
        ctx.moveTo(h.x - 2.2, h.y);
        ctx.lineTo(h.x + 2.2, h.y);
        ctx.moveTo(h.x, h.y - 2.2);
        ctx.lineTo(h.x, h.y + 2.2);
        ctx.stroke();
        break;
      }
      case 'squish':
        ctx.fillStyle = 'rgba(224,90,60,0.35)';
        ctx.strokeStyle = '#e05a3c';
        ctx.lineWidth = 0.2;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
    }
    ctx.globalAlpha = 1;
  }

  private drawWeather(s: Sim, dt: number): void {
    const I = s.weather.intensity;
    if (I < 0.02) return;
    const { ctx, cam } = this;
    const w = s.world;
    const n = Math.floor(this.drops.length * I);
    const snow = s.isWinter;
    const vw = cam.vw;
    const vh = cam.vh;
    const d = this.dpr;
    ctx.strokeStyle = 'rgba(205,222,240,0.55)';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.2 * d;
    ctx.beginPath();
    for (let k = 0; k < this.drops.length; k++) {
      const p = this.drops[k];
      p.y += dt * (snow ? 0.12 : 1.5) * p.v;
      if (p.y > 1) {
        p.y -= 1.05;
        p.x = Math.random();
      }
      if (k >= n) continue;
      const sx = p.x * vw + (snow ? Math.sin(this.t * 1.5 + k) * 12 * d : 0);
      const sy = p.y * vh;
      const wp = cam.toWorld(sx, sy);
      if (wp.x < 0 || wp.x >= W || wp.y > w.top[Math.floor(wp.x)]) continue;
      if (snow) {
        ctx.moveTo(sx + 1.8 * d, sy);
        ctx.arc(sx, sy, 1.8 * d, 0, Math.PI * 2);
      } else {
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - 4 * d, sy + 16 * d);
      }
    }
    if (snow) ctx.fill();
    else ctx.stroke();
  }

  private drawVignette(): void {
    const { ctx, canvas } = this;
    if (!this.vignette) {
      const r = Math.hypot(canvas.width, canvas.height) / 2;
      const g = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, r * 0.7, canvas.width / 2, canvas.height / 2, r * 1.05);
      g.addColorStop(0, 'rgba(20,12,8,0)');
      g.addColorStop(1, 'rgba(20,12,8,0.2)');
      this.vignette = g;
    }
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  private drawLabels(s: Sim): void {
    const p = s.player;
    if (!p || this.cam.zoom < 1.6) return;
    const { ctx, cam } = this;
    const d = this.dpr;
    ctx.font = `600 ${11 * d}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const names: Record<number, string> = { [ROLE_QUEEN]: 'Queen', [ROLE_NURSERY]: 'Nursery', [ROLE_FOOD]: 'Food store', [ROLE_MIDDEN]: 'Midden', [ROLE_GRANARY]: 'Granary' };
    for (const pr of p.projects) {
      if (pr.kind !== 'chamber' || pr.cursor < pr.cells.length * 0.5) continue;
      const name = names[pr.role];
      if (!name) continue;
      const sp = cam.toScreen(pr.ex + 0.5, pr.ey - 4.2);
      if (sp.x < -50 || sp.y < -20 || sp.x > cam.vw + 50 || sp.y > cam.vh + 20) continue;
      const tw = ctx.measureText(name).width + 12 * d;
      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.beginPath();
      ctx.roundRect(sp.x - tw / 2, sp.y - 9 * d, tw, 18 * d, 9 * d);
      ctx.fill();
      ctx.fillStyle = '#2b211b';
      ctx.fillText(name, sp.x, sp.y + 0.5 * d);
    }
  }

  /** What's under a world point, for hover tooltips and clicks. */
  pick(s: Sim, x: number, y: number): { ant: Ant | null; critter: Critter | null } {
    let ant: Ant | null = null;
    let bd = 1.6;
    for (const c of s.colonies) {
      for (const a of c.ants) {
        if (a.dead) continue;
        const d = Math.hypot(a.x - x, a.y - y) / (a.caste === 'queen' ? 1.6 : 1);
        if (d < bd) {
          bd = d;
          ant = a;
        }
      }
    }
    let critter: Critter | null = null;
    for (const c of s.eco.critters) {
      if (c.kind === 'centipede') {
        if (Math.abs(c.x - x) < 1.3 && Math.abs(c.y - y) < 1.1) critter = c;
        continue;
      }
      const g = critterY(c, s.world.top);
      const sp = this.critterSprite(c);
      const k = critterScale(c);
      const hw = (sp.w / TEX / 2) * k;
      if (Math.abs(c.x + 0.5 - x) < hw + 0.3 && y > g - (sp.h / TEX) * k - 0.3 && y < g + 0.5) critter = c;
    }
    return { ant, critter };
  }

  colonyColor(c: Colony): string {
    return c.species.ui;
  }
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number): void {
  ctx.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

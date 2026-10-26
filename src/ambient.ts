import { W, H, DIRT, clampCol } from './config';
import { TEX, sprite, frameCount, hash2 } from './sprites';
import type { Sim } from './sim';
import type { Camera } from './camera';

interface Flyer {
  kind: 'butterfly' | 'bee';
  x: number;
  y: number;
  tx: number;
  ty: number;
  vx: number;
  t: number;
  leaving: boolean;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grav: number;
  color: string;
  /** Leaves come to rest on the ground instead of falling through it. */
  lands: boolean;
}

interface Firefly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ph: number;
}

interface Worm {
  x: number;
  y: number;
  dir: number;
  t: number;
}

export interface ViewRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const LEAF_COLORS = ['#d9822b', '#c4552d', '#e3a93a', '#b8452a', '#d6b04a'];
const MAX_MOTES = 500;

/** Life and weather that don't touch the sim: butterflies, bees, fireflies, falling leaves, splashes, dust and worms. */
export class Ambient {
  private flyers: Flyer[] = [];
  private motes: Mote[] = [];
  private flies: Firefly[] = [];
  private worms: Worm[] = [];
  private leafT = 0;
  private time = 0;
  /** Breeze strength, shared with the grass. */
  wind = 0.5;
  /** Cells dug in view this frame, for the scratching sound. */
  digsInView = 0;

  reset(sim: Sim): void {
    this.flyers = [];
    this.motes = [];
    this.flies = [];
    this.worms = [];
    for (let k = 0; k < 5; k++) this.spawnWorm(sim, k * 7919);
  }

  update(sim: Sim, dt: number, view: ViewRect): void {
    this.time += dt;
    const w = sim.world;
    const rain = sim.weather.intensity;
    this.wind = 0.45 + Math.sin(this.time * 0.23) * 0.25 + rain * 1.3;

    // Dust from spoil heaps and crumbs from the dig face
    for (const i of w.dumpFx) {
      const x = (i % W) + 0.5;
      const y = Math.floor(i / W) + 0.5;
      if (x < view.x0 || x > view.x1) continue;
      for (let k = 0; k < 5; k++) {
        this.mote(x + (Math.random() - 0.5), y, (Math.random() - 0.5) * 3, -1 - Math.random() * 1.8, 0.5 + Math.random() * 0.4, 2, 1.5, 'rgba(214,184,140,0.85)', false);
      }
    }
    for (const i of w.dugFx) {
      const x = (i % W) + 0.5;
      const y = Math.floor(i / W) + 0.5;
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      for (let k = 0; k < 3; k++) {
        this.mote(x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 2, -Math.random(), 0.35 + Math.random() * 0.2, 1, 16, '#5a4030', false);
      }
    }
    this.digsInView = 0;
    for (const i of w.dugFx) {
      const x = (i % W) + 0.5;
      const y = Math.floor(i / W) + 0.5;
      if (x >= view.x0 && x <= view.x1 && y >= view.y0 && y <= view.y1) this.digsInView++;
    }
    w.dumpFx.length = 0;
    w.dugFx.length = 0;
    if (dt <= 0) return;

    const day = sim.light > 0.42;
    const warm = sim.season === 0 || sim.season === 1;
    const flowers = sim.eco.plants.filter((p) => p.kind === 'flower' || p.kind === 'berry');

    // Butterflies and bees visit flowers on fine days
    const wantB = warm && day && rain < 0.1 ? 4 : 0;
    const wantBee = sim.season === 1 && day && rain < 0.1 ? 2 : sim.season === 0 && day && rain < 0.1 ? 1 : 0;
    const count = (k: Flyer['kind']): number => this.flyers.filter((f) => f.kind === k && !f.leaving).length;
    if (count('butterfly') < wantB && Math.random() < dt * 0.5) this.spawnFlyer(sim, 'butterfly', view, flowers);
    if (count('bee') < wantBee && Math.random() < dt * 0.4) this.spawnFlyer(sim, 'bee', view, flowers);
    for (const f of this.flyers) {
      if (!f.leaving && ((f.kind === 'butterfly' && count('butterfly') > wantB) || (f.kind === 'bee' && count('bee') > wantBee))) {
        f.leaving = true;
        f.ty = -40;
        f.tx = f.x + (Math.random() - 0.5) * 60;
      }
      f.t += dt;
      const bee = f.kind === 'bee';
      const sp = bee ? 9 : 4.5;
      const dx = f.tx - f.x;
      const dy = f.ty - f.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.6 && !f.leaving) {
        const p = flowers.length ? flowers[Math.floor(Math.random() * flowers.length)] : null;
        const near = p && Math.abs(p.x - f.x) < 40 ? p.x : f.x + (Math.random() - 0.5) * 24;
        f.tx = near + (Math.random() - 0.5) * 3;
        f.ty = w.top[clampCol(f.tx)] - 2 - Math.random() * (bee ? 4 : 8);
      } else if (d > 0) {
        f.vx = (dx / d) * sp;
        f.x += f.vx * dt;
        f.y += (dy / d) * sp * dt + Math.sin(f.t * (bee ? 22 : 7)) * dt * (bee ? 3 : 4);
      }
    }
    this.flyers = this.flyers.filter((f) => !(f.leaving && f.y < -30) && f.x > -60 && f.x < W + 60);

    // Fireflies on summer nights
    const wantFlies = sim.season === 1 && sim.darkness > 0.35 && rain < 0.1 ? 36 : 0;
    while (this.flies.length < wantFlies) {
      const x = view.x0 + Math.random() * (view.x1 - view.x0);
      this.flies.push({ x, y: w.top[clampCol(x)] - 0.8 - Math.random() * 9, vx: 0, vy: 0, ph: Math.random() * 10 });
    }
    if (this.flies.length > wantFlies) this.flies.length = Math.max(wantFlies, this.flies.length - Math.ceil(dt * 20));
    for (const f of this.flies) {
      f.vx += (Math.random() - 0.5) * dt * 4;
      f.vy += (Math.random() - 0.5) * dt * 4;
      f.vx *= 0.98;
      f.vy *= 0.98;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      const g = w.top[clampCol(f.x)];
      if (f.y > g - 0.5) f.vy = -Math.abs(f.vy) - 0.2;
      if (f.y < g - 12) f.vy = Math.abs(f.vy);
      if (f.x < view.x0 - 10 || f.x > view.x1 + 10) {
        f.x = view.x0 + Math.random() * (view.x1 - view.x0);
        f.y = w.top[clampCol(f.x)] - 1 - Math.random() * 8;
      }
    }

    // Leaves drift down from the canopies in autumn
    if (sim.season === 2) {
      this.leafT -= dt;
      while (this.leafT <= 0) {
        this.leafT += 0.12 / (1 + rain);
        const trees = sim.eco.plants.filter((p) => (p.kind === 'tree' || (p.kind === 'wood' && p.variant !== 1)) && p.x > view.x0 - 15 && p.x < view.x1 + 15);
        if (!trees.length) break;
        const t = trees[Math.floor(Math.random() * trees.length)];
        const g = w.top[clampCol(t.x)];
        this.mote(t.x + (Math.random() - 0.5) * 18, g - 12 - Math.random() * 12, 0, 0.4, 7, 2, 0, LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)], true);
      }
    }

    // Raindrops splashing on the ground
    if (sim.weather.raining && !sim.isWinter && rain > 0.2) {
      const n = Math.floor(rain * 60 * dt * Math.min(4, (view.x1 - view.x0) / 40)) + (Math.random() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const x = view.x0 + Math.random() * (view.x1 - view.x0);
        if (x < 0 || x >= W || sim.isCovered(Math.floor(x))) continue;
        const g = w.top[clampCol(x)];
        for (let j = 0; j < 2; j++) this.mote(x, g - 0.05, (Math.random() - 0.5) * 4, -2 - Math.random() * 2.5, 0.22, 1, 26, 'rgba(200,225,245,0.9)', false);
      }
    }

    for (const m of this.motes) {
      m.life -= dt;
      if (m.lands) {
        const g = w.top[clampCol(m.x)];
        if (m.y < g - 0.1) {
          m.x += (Math.sin(this.time * 2.3 + m.max * 7) * 1.2 + this.wind * 0.8) * dt;
          m.y += m.vy * (1 + Math.sin(this.time * 3 + m.max * 5) * 0.4) * dt;
        } else {
          m.y = g - 0.1;
          m.life = Math.min(m.life, 2.5);
        }
        continue;
      }
      m.vy += m.grav * dt;
      m.vx *= 1 - dt * 2;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
    }
    this.motes = this.motes.filter((m) => m.life > 0);

    for (const wm of this.worms) {
      wm.t += dt;
      const head = Math.floor(wm.x + wm.dir * 3.5);
      const ok = head > 1 && head < W - 2 && w.cells[Math.floor(wm.y) * W + head] === DIRT && w.cells[Math.floor(wm.y) * W + Math.floor(wm.x)] === DIRT;
      if (!ok) {
        if (w.cells[Math.floor(wm.y) * W + Math.floor(wm.x)] !== DIRT) this.place(sim, wm, Math.floor(wm.t * 997));
        else wm.dir = -wm.dir;
      } else wm.x += wm.dir * 0.22 * dt;
    }
  }

  private mote(x: number, y: number, vx: number, vy: number, life: number, size: number, grav: number, color: string, lands: boolean): void {
    if (this.motes.length >= MAX_MOTES) return;
    this.motes.push({ x, y, vx, vy, life, max: life, size, grav, color, lands });
  }

  private spawnFlyer(sim: Sim, kind: Flyer['kind'], view: ViewRect, flowers: { x: number }[]): void {
    const inView = flowers.filter((p) => p.x > view.x0 - 20 && p.x < view.x1 + 20);
    const p = inView.length ? inView[Math.floor(Math.random() * inView.length)] : null;
    const left = Math.random() < 0.5;
    const x = left ? view.x0 - 6 : view.x1 + 6;
    const tx = p ? p.x : view.x0 + Math.random() * (view.x1 - view.x0);
    const g = sim.world.top[clampCol(x)];
    this.flyers.push({ kind, x, y: g - 4 - Math.random() * 8, tx, ty: sim.world.top[clampCol(tx)] - 3, vx: 0, t: Math.random() * 10, leaving: false });
  }

  private spawnWorm(sim: Sim, seed: number): void {
    const wm: Worm = { x: 0, y: 0, dir: 1, t: 0 };
    this.place(sim, wm, seed);
    this.worms.push(wm);
  }

  private place(sim: Sim, wm: Worm, seed: number): void {
    const w = sim.world;
    for (let k = 0; k < 40; k++) {
      const x = 8 + Math.floor(hash2(seed, k, 1) * (W - 16));
      const y = w.top[x] + 6 + Math.floor(hash2(seed, k, 2) * 50);
      if (y < H - 6 && w.cells[y * W + x] === DIRT) {
        wm.x = x + 0.5;
        wm.y = y + 0.5;
        wm.dir = hash2(seed, k, 3) < 0.5 ? -1 : 1;
        return;
      }
    }
  }

  /** World-space pass: drawn over the terrain and under the darkness overlay. */
  draw(ctx: CanvasRenderingContext2D, view: ViewRect, scale: number): void {
    const T = 1 / TEX;
    const inView = (x: number, y: number, m = 4): boolean => x > view.x0 - m && x < view.x1 + m && y > view.y0 - m && y < view.y1 + m;

    // Worms, sliced into strips so they wriggle
    const ws = sprite('worm');
    for (const wm of this.worms) {
      if (!inView(wm.x, wm.y, 8)) continue;
      const wd = ws.w * T;
      const hd = ws.h * T;
      const x0 = wm.x - wd / 2;
      for (let s = 0; s < ws.w; s += 4) {
        const k = wm.dir > 0 ? s : ws.w - 4 - s;
        const off = Math.round(Math.sin(wm.t * 3 + s * 0.25) * 1.2) * T;
        ctx.save();
        if (wm.dir < 0) {
          ctx.translate(wm.x, 0);
          ctx.scale(-1, 1);
          ctx.translate(-wm.x, 0);
        }
        ctx.drawImage(ws.img, ws.sx + k, ws.sy, 4, ws.h, x0 + k * T, wm.y - hd / 2 + off, 4 * T, hd);
        ctx.restore();
      }
    }

    for (const m of this.motes) {
      if (!inView(m.x, m.y)) continue;
      ctx.globalAlpha = Math.min(1, m.life / Math.min(0.3, m.max));
      ctx.fillStyle = m.color;
      const sz = m.size * T;
      if (m.lands) ctx.fillRect(Math.round(m.x * TEX) * T, Math.round(m.y * TEX) * T, 2 * T, T);
      else ctx.fillRect(m.x - sz / 2, m.y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;

    if (scale < 2) return;
    for (const f of this.flyers) {
      if (!inView(f.x, f.y, 6)) continue;
      const name = f.kind;
      const n = frameCount(name);
      const s = sprite(name, name === 'butterfly' ? Math.floor(f.t * 12) % n : 0);
      const wd = s.w * T;
      const hd = s.h * T;
      const bob = f.kind === 'bee' ? Math.sin(f.t * 30) * 0.08 : 0;
      ctx.save();
      ctx.translate(f.x, f.y + bob);
      if (f.vx < 0) ctx.scale(-1, 1);
      ctx.drawImage(s.img, s.sx, s.sy, s.w, s.h, -wd / 2, -hd / 2, wd, hd);
      ctx.restore();
    }
  }

  /** Screen-space glow, drawn after the night overlay so it shines through. */
  drawGlow(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number): void {
    if (!this.flies.length) return;
    for (const f of this.flies) {
      const a = Math.max(0, Math.sin(this.time * 1.7 + f.ph * 3)) ** 3;
      if (a < 0.03) continue;
      const p = cam.toScreen(f.x, f.y);
      if (p.x < -20 || p.y < -20 || p.x > cam.vw + 20 || p.y > cam.vh + 20) continue;
      const r = Math.max(3 * dpr, cam.scale * 0.35);
      ctx.fillStyle = `rgba(214,255,120,${a * 0.22})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(250,255,190,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

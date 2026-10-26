import { W, H, DAY, DIRT, idx, clampCol } from './config';
import type { Sim } from './sim';
import { zoneAt } from './layout';
import type { Colony, Project } from './colony';
import type { Ant } from './ant';

export type FoodKind = 'fruit' | 'berry' | 'seeds' | 'carcass' | 'sugar' | 'protein' | 'corpse';

/** type 0 is sugar, 1 is protein. */
export const FOOD_INFO: Record<FoodKind, { type: 0 | 1; amount: number; life: number; label: string }> = {
  fruit: { type: 0, amount: 32, life: DAY * 1.6, label: 'Fallen fruit' },
  berry: { type: 0, amount: 14, life: DAY * 1.2, label: 'Berries' },
  seeds: { type: 1, amount: 14, life: DAY * 3, label: 'Seeds' },
  carcass: { type: 1, amount: 28, life: DAY * 1.5, label: 'Dead insect' },
  sugar: { type: 0, amount: 50, life: DAY * 2.5, label: 'Sugar water' },
  protein: { type: 1, amount: 35, life: DAY * 2, label: 'Mealworm' },
  corpse: { type: 1, amount: 2, life: DAY * 0.8, label: 'Dead ant' },
};

export interface FoodSource {
  id: number;
  x: number;
  kind: FoodKind;
  type: 0 | 1;
  amount: number;
  max: number;
  age: number;
  life: number;
  gone: boolean;
}

/** 'tree' is a fruiting apple tree; 'wood' is a woodland tree (oak, spruce or birch by variant) that only gives shade and scenery. */
export type PlantKind = 'tree' | 'wood' | 'bush' | 'flower' | 'berry';

export interface Plant {
  x: number;
  kind: PlantKind;
  size: number;
  variant: number;
  /** 0..1, for keeper-planted bushes growing in. */
  grow: number;
  dropT: number;
}

export type CritterKind = 'beetle' | 'caterpillar' | 'spider' | 'centipede' | 'bird' | 'ladybird';

export const CRITTER_INFO: Record<CritterKind, {
  hp: number; atk: number; speed: number; size: number; food: number; bite: number; label: string; desc: string;
}> = {
  beetle: { hp: 45, atk: 7, speed: 2.2, size: 1.6, food: 40, bite: 1.2, label: 'Ground beetle', desc: 'Armoured prey, worth a lot of protein if the ants can bring it down.' },
  caterpillar: { hp: 26, atk: 0, speed: 1.1, size: 1.8, food: 30, bite: 99, label: 'Caterpillar', desc: 'Slow, juicy and defenceless.' },
  spider: { hp: 120, atk: 14, speed: 4.5, size: 2.2, food: 60, bite: 1.6, label: 'Wolf spider', desc: 'Hunts ants on the surface. Ants mob it to fight back.' },
  centipede: { hp: 110, atk: 8, speed: 2.4, size: 1.2, food: 40, bite: 1.1, label: 'Centipede', desc: 'Slips into the nest to hunt. It eats brood and bites hard, so nestmates mob it.' },
  bird: { hp: 1, atk: 0, speed: 16, size: 2.5, food: 0, bite: 1.3, label: 'Robin', desc: 'Pecks up ants on open ground. Ants under plants are safe, and a squish scares it off.' },
  ladybird: { hp: 16, atk: 0.6, speed: 1.4, size: 0.9, food: 6, bite: 1.6, label: 'Ladybird', desc: 'Eats aphids. Ants that tend the herd chase it off.' },
};

const KILLS: Partial<Record<CritterKind, string>> = {
  spider: 'eaten by a spider', beetle: 'crushed by a beetle', centipede: 'killed by a centipede', ladybird: 'bitten by a ladybird',
};

/** Where a critter is drawn and picked: underground at its row, on the wing above the ground, or standing on it. */
export function critterY(c: Critter, top: Int32Array): number {
  return c.under ? c.y + 0.5 : top[clampCol(c.x)] - c.alt;
}

export interface Critter {
  id: number;
  kind: CritterKind;
  x: number;
  dir: number;
  hp: number;
  maxHp: number;
  t: number;
  leaving: boolean;
  kills: number;
  biteT: number;
  scanT: number;
  dead: boolean;
  /** Ants fighting it this combat tick. */
  attackers: Ant[];
  /** Centipedes hunt through the tunnels: they have a cell and a row as well as a column. */
  under: boolean;
  at: number;
  y: number;
  /** Tunnel cells still to walk. */
  path: number[];
  /** Recent positions (x, y pairs), so the body follows the tunnel behind the head. */
  trail: number[];
  /** Height above the ground, for birds and ladybirds on the wing. */
  alt: number;
  /** Where a flyer means to land. */
  goal: number;
  /** The herd a ladybird is eating, -1 if none. */
  herdId: number;
}

/** A cluster of root aphids on a plant root. Ants that tunnel to them milk honeydew; left alone they dwindle. */
export interface Herd {
  id: number;
  /** The soil pocket they live in. */
  cell: number;
  size: number;
  /** Honeydew waiting to be milked. */
  honey: number;
  /** Seconds since an ant last tended them. */
  tendT: number;
  owner: Colony | null;
  /** Connected tunnel cell to milk them from, -1 until one is dug. */
  access: number;
  /** Ants on their way to milk them. */
  visitors: number;
  /** The connector tunnel being dug to them. */
  dig: Project | null;
}

/** Everything that lives on the surface besides ants: plants, food and other critters. Plus the root aphids under the plants. */
export class Ecology {
  food: FoodSource[] = [];
  plants: Plant[] = [];
  critters: Critter[] = [];
  herds: Herd[] = [];
  nextId = 1;
  bugT = 0;
  carcT = 0;
  spiderT = 0;
  seedT = 0;
  birdT = DAY * 0.6;
  centT = DAY * 3;
  ladyT = DAY;

  constructor(private readonly sim: Sim) {}

  generate(): void {
    const s = this.sim;
    const r = s.rng;
    const zones = s.zones;
    const plant = (x: number, kind: PlantKind, variant: number, dropT = 0): void => {
      this.plants.push({ x, kind, size: r.range(0.85, 1.25), variant, grow: 1, dropT });
    };
    // Fruit trees keep the 1.0 count and spacing so food stays balanced, but prefer open ground
    const trees = Math.max(1, Math.round({ scarce: 3, normal: 4, plenty: 5 }[s.opts.abundance] * s.biome.fruitTrees));
    const xs: number[] = [];
    for (let k = 0; k < 600 && xs.length < trees; k++) {
      const x = r.int(20, W - 20);
      const z = zoneAt(zones, x);
      if ((z === 'woods' || z === 'stony' || z === 'dune') && k < 300) continue;
      if (xs.every((o) => Math.abs(o - x) > 50)) xs.push(x);
    }
    for (const x of xs) plant(x, 'tree', 0, r.range(20, 80));
    const near = (x: number, d: number): boolean => this.plants.some((p) => (p.kind === 'tree' || p.kind === 'wood') && Math.abs(p.x - x) < d);
    for (const z of zones) {
      const span = z.x1 - z.x0;
      // Woodland trees: a stand in the woods, a lone birch on the stones
      const woods = z.kind === 'woods' ? Math.max(3, Math.round(span / 13)) : z.kind === 'stony' || z.kind === 'reeds' ? 1 : 0;
      const mixK = r.int(0, 2);
      for (let k = 0, tries = 0; k < woods && tries < 80; tries++) {
        const x = r.int(Math.max(6, z.x0 + 3), Math.min(W - 7, z.x1 - 3));
        if (near(x, 10)) continue;
        // Cycle species so a stand always mixes oak, spruce and birch
        plant(x, 'wood', z.kind === 'stony' || z.kind === 'reeds' ? 2 : (k + mixK) % 3);
        k++;
      }
      const bushes = { woods: 5, meadow: 2, stony: 1, bramble: 6, dune: 1, reeds: 3 }[z.kind] * (span / 80);
      for (let k = 0; k < bushes; k++) plant(r.int(Math.max(4, z.x0 + 2), Math.min(W - 5, z.x1 - 2)), 'bush', r.int(0, 6));
      const flowers = { woods: 6, meadow: 26, stony: 5, bramble: 8, dune: 6, reeds: 14 }[z.kind] * (span / 80);
      for (let k = 0; k < flowers; k++) plant(r.int(Math.max(3, z.x0), Math.min(W - 4, z.x1 - 1)), 'flower', r.int(0, 7));
    }
    // Root aphids under a few of the bushes and trees
    const hosts = this.plants.filter((p) => p.kind !== 'flower');
    for (let k = 0; k < 5 && hosts.length; k++) this.addHerd(r.pick(hosts).x + r.int(-3, 3), r.range(8, 16));
    this.bugT = r.range(60, 120);
    this.carcT = r.range(30, 60);
    this.spiderT = DAY * r.range(2.5, 3.5);
    this.seedT = 30;
  }

  addFood(x: number, kind: FoodKind, natural = true, amount = 0): FoodSource {
    const info = FOOD_INFO[kind];
    const amt = amount || Math.round(info.amount * (natural ? this.sim.amountMul : 1));
    if (kind === 'corpse') {
      // The dead pile up where they fell instead of crowding out real food
      const pile = this.food.find((f) => f.kind === 'corpse' && !f.gone && Math.abs(f.x - x) <= 1.5 && f.max < 40);
      if (pile) {
        pile.amount += amt;
        pile.max += amt;
        pile.age = Math.min(pile.age, pile.life * 0.5);
        return pile;
      }
    }
    const f: FoodSource = { id: this.nextId++, x: clampCol(x), kind, type: info.type, amount: amt, max: amt, age: 0, life: info.life, gone: false };
    this.food.push(f);
    return f;
  }

  /** Settle a herd of root aphids in the soil under column x. Null if there's no room. */
  addHerd(x: number, size = 10): Herd | null {
    const w = this.sim.world;
    const r = this.sim.rng;
    const col = clampCol(x);
    for (let k = 0; k < 12; k++) {
      const cx = clampCol(col + r.int(-2, 2));
      const cy = w.top[cx] + r.int(5, 12);
      if (cy >= H - 4) continue;
      const cell = idx(cx, cy);
      if (w.cells[cell] !== DIRT || this.herds.some((h) => Math.abs((h.cell % W) - cx) < 5)) continue;
      const hd: Herd = { id: this.nextId++, cell, size, honey: 0, tendT: 999, owner: null, access: -1, visitors: 0, dig: null };
      this.herds.push(hd);
      return hd;
    }
    return null;
  }

  herdAt(x: number, y: number): Herd | null {
    for (const h of this.herds) if (Math.abs((h.cell % W) + 0.5 - x) < 1.6 && Math.abs(Math.floor(h.cell / W) + 0.5 - y) < 1.6) return h;
    return null;
  }

  foodNear(x: number, r: number): FoodSource | null {
    let best: FoodSource | null = null;
    let bd = r;
    for (const f of this.food) {
      if (f.gone || f.amount <= 0) continue;
      const d = Math.abs(f.x - x);
      if (d <= bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  spawnCritter(kind: CritterKind): Critter {
    const info = CRITTER_INFO[kind];
    const left = this.sim.rng.chance(0.5);
    const c: Critter = {
      id: this.nextId++, kind, x: left ? -4 : W + 4, dir: left ? 1 : -1, hp: info.hp, maxHp: info.hp,
      t: 0, leaving: false, kills: 0, biteT: info.bite, scanT: 0, dead: false, attackers: [],
      under: false, at: -1, y: 0, path: [], trail: [], alt: 0, goal: 0, herdId: -1,
    };
    this.critters.push(c);
    return c;
  }

  killCritter(c: Critter, by: Colony | null): void {
    if (c.dead) return;
    c.dead = true;
    const info = CRITTER_INFO[c.kind];
    if (c.under) {
      // Killed in the tunnels: the nest it died in eats it where it lies
      const owner = this.sim.nestOwner(c.at) ?? by;
      if (owner) owner.protein += info.food * 0.6;
      if (owner?.isPlayer) this.sim.emit('The centipede is dead! Its body feeds the nest.', 'good');
    } else if (info.food > 0) this.addFood(clampCol(c.x), 'carcass', false, info.food);
    if (by?.isPlayer && c.kind !== 'ladybird') this.sim.milestone('hunter');
    if (c.kind === 'spider') this.sim.emit('The spider is dead! Its body will feed the colony.', 'good');
  }

  /** This biome's spawn rate for a kind of critter. */
  private rate(k: CritterKind): number {
    return this.sim.biome.critters[k] ?? 1;
  }

  /** Columns sheltered by leaves, where a bird can't see the ants below. */
  coverMap(): Uint8Array {
    const m = new Uint8Array(W);
    // On the woodland floor the leaf litter hides foragers under the trees
    if (this.sim.biome.id === 'woodland') for (const z of this.sim.zones) if (z.kind === 'woods') m.fill(1, z.x0, z.x1);
    for (const p of this.plants) {
      if (p.kind === 'flower') continue;
      const r = p.kind === 'tree' || p.kind === 'wood' ? 5 * p.size : 2.4 * p.size * p.grow;
      for (let x = Math.max(0, Math.floor(p.x - r)); x <= Math.min(W - 1, Math.ceil(p.x + r)); x++) m[x] = 1;
    }
    for (const cv of this.sim.covers) for (let x = Math.max(0, cv.x - 6); x <= Math.min(W - 1, cv.x + 6); x++) m[x] = 1;
    return m;
  }

  /** A robin drops onto the busiest stretch of open ground it can see. */
  /** Sandbox: bring a creature in near a column. False if there's nothing for it to do (no aphids, no brood, no ants out). */
  summon(kind: CritterKind, x: number): boolean {
    if (kind === 'bird') return this.spawnBird();
    if (kind === 'centipede') {
      const n = this.critters.length;
      this.spawnCentipede();
      return this.critters.length > n;
    }
    if (kind === 'ladybird') {
      const n = this.critters.length;
      this.spawnLadybird();
      return this.critters.length > n;
    }
    const c = this.spawnCritter(kind);
    const from = this.sim.rng.chance(0.5) ? -1 : 1;
    c.x = Math.max(2, Math.min(W - 3, x + from * 24));
    c.dir = -from;
    return true;
  }

  private spawnBird(): boolean {
    const s = this.sim;
    const cover = this.coverMap();
    const n = new Uint16Array(W);
    for (const col of s.colonies) {
      for (const a of col.ants) {
        if (a.dead || a.under || a.intent === 'fly') continue;
        const x = clampCol(a.x);
        if (!cover[x]) n[x]++;
      }
    }
    let best = -1;
    let bn = 4;
    for (let x = 8; x < W - 8; x++) {
      let k = 0;
      for (let d = -4; d <= 4; d++) k += n[x + d];
      if (k > bn) {
        bn = k;
        best = x;
      }
    }
    if (best < 0) return false;
    const c = this.spawnCritter('bird');
    const from = s.rng.chance(0.5) ? -1 : 1;
    c.x = Math.max(-5, Math.min(W + 5, best + from * 45));
    c.dir = -from;
    c.goal = best;
    c.alt = 26;
    return true;
  }

  private updateBird(c: Critter, dt: number): void {
    const s = this.sim;
    const info = CRITTER_INFO.bird;
    if (c.leaving) {
      c.x += c.dir * 14 * dt;
      c.alt += 10 * dt;
      if (c.alt > 40 || c.x < -10 || c.x > W + 10) c.dead = true;
      return;
    }
    if (c.alt > 0) {
      // Glide down onto the landing spot
      const d = c.goal - c.x;
      c.x += Math.sign(d) * Math.min(Math.abs(d), info.speed * dt);
      c.alt = Math.abs(d) < 0.2 ? 0 : Math.min(c.alt, Math.abs(c.goal - c.x) * 0.6);
      return;
    }
    if (c.t > 16 || c.kills >= 3 || s.weather.raining || s.light < 0.35) {
      c.leaving = true;
      return;
    }
    c.biteT -= dt;
    c.scanT -= dt;
    if (c.scanT <= 0) {
      c.scanT = 0.5;
      const cover = this.coverMap();
      let prey: Ant | null = null;
      let bd = 8;
      for (const col of s.colonies) {
        for (const a of col.ants) {
          if (a.dead || a.under || a.intent === 'fly' || cover[clampCol(a.x)]) continue;
          const d = Math.abs(a.x - c.x);
          if (d < bd) {
            bd = d;
            prey = a;
          }
        }
      }
      c.goal = prey ? prey.x : c.x;
      if (prey) c.dir = prey.x > c.x ? 1 : -1;
    }
    // Hop towards the nearest ant in the open and peck
    const d = c.goal - c.x;
    if (Math.abs(d) > 0.9) c.x += Math.sign(d) * Math.min(Math.abs(d), 4 * dt);
    else if (c.biteT <= 0) {
      c.biteT = info.bite;
      const cover = this.coverMap();
      const a = this.nearestSurfaceAnt(c.x, 1.3);
      if (a && !cover[clampCol(a.x)] && s.rng.chance(0.5)) {
        a.colony.die(a, 'eaten by a robin');
        c.kills++;
        if (a.colony.isPlayer && c.kills === 1) s.emit('A robin is picking off foragers in the open! Ants under plants are safe.', 'bad');
      }
    }
  }

  /** A centipede slips in through an open entrance and makes for the brood. */
  private spawnCentipede(): void {
    const s = this.sim;
    const w = s.world;
    const r = s.rng;
    const hosts = s.colonies.filter((c) => c.settled && c.alive && c.brood.length >= 6 && c.workerCount >= 40);
    if (!hosts.length) return;
    const host = s.player && hosts.includes(s.player) && r.chance(0.65) ? s.player : r.pick(hosts);
    for (let k = 0; k < 8; k++) {
      const b = r.pick(host.brood);
      if (b.dead || w.dist[b.cell] < 0) continue;
      const root = w.rootOf(b.cell);
      if (s.isPlugged(root)) continue;
      const path = w.route(root, b.cell);
      if (!path) continue;
      const c = this.spawnCritter('centipede');
      c.under = true;
      c.at = root;
      c.x = (root % W) + 0.5;
      c.y = Math.floor(root / W) + 0.5;
      c.path = path.slice(1);
      if (host.isPlayer) s.emit('A centipede has slipped into the nest! Ants will have to mob it.', 'bad', 'spider');
      return;
    }
  }

  private updateCentipede(c: Critter, dt: number, engaged: boolean): void {
    const s = this.sim;
    const w = s.world;
    const info = CRITTER_INFO.centipede;
    if (!c.leaving && (c.kills >= 7 || c.t > 140 || c.hp < c.maxHp * 0.3)) {
      c.leaving = true;
      c.path = (w.routeToRoot(c.at) ?? []).slice(1);
    }
    // Wounded and leaving, it doesn't stop to fight
    if (!engaged || c.leaving) {
      if (!c.path.length) {
        if (c.leaving || w.dist[c.at] < 0) {
          c.dead = true; // back out into the soil
          return;
        }
        this.centipedeGoal(c);
      } else {
        const nx = (c.path[0] % W) + 0.5;
        const ny = Math.floor(c.path[0] / W) + 0.5;
        const dx = nx - c.x;
        const dy = ny - c.y;
        const d = Math.hypot(dx, dy);
        const step = info.speed * (c.leaving ? 1.4 : 1) * dt;
        if (d <= step) {
          c.x = nx;
          c.y = ny;
          c.at = c.path.shift()!;
          // The tunnel caved in or flooded under it: find another way
          if (w.dist[c.at] < 0) c.path.length = 0;
        } else {
          c.x += (dx / d) * step;
          c.y += (dy / d) * step;
        }
        if (Math.abs(dx) > 0.05) c.dir = dx > 0 ? 1 : -1;
      }
    }
    const tl = c.trail;
    if (tl.length < 2 || Math.hypot(tl[0] - c.x, tl[1] - c.y) > 0.25) {
      tl.unshift(c.x, c.y);
      if (tl.length > 36) tl.length = 36;
    }
    if (c.leaving) return;
    // Hunting: grab ants it runs into, and eat brood lying where it passes
    c.scanT -= dt;
    if (c.scanT > 0) return;
    c.scanT = 0.35;
    for (const col of s.colonies) {
      for (const a of col.ants) {
        if (a.dead || !a.under || a.foeAnt || a.foeCritter || a.caste === 'queen') continue;
        if (Math.abs(a.x - c.x) > 1.3 || Math.abs(a.y - c.y) > 1.3) continue;
        col.interrupt(a);
        a.foeCritter = c;
        a.intent = 'fight';
        s.alarm(a);
        return;
      }
    }
    if (engaged) return;
    for (const col of s.colonies) {
      for (const b of col.brood) {
        if (b.dead || b.carrier || Math.abs((b.cell % W) + 0.5 - c.x) > 1 || Math.abs(Math.floor(b.cell / W) + 0.5 - c.y) > 1) continue;
        col.killBrood(b, 'eaten');
        c.kills++;
        c.scanT = 1.8;
        return;
      }
    }
  }

  /** Somewhere to hunt next: brood if it can smell any along this tunnel system, else a wander. */
  private centipedeGoal(c: Critter): void {
    const s = this.sim;
    const w = s.world;
    const r = s.rng;
    const root = w.rootOf(c.at);
    const owner = s.nestOwner(c.at) ?? s.colonies.find((col) => col.roots.includes(root)) ?? null;
    const cand: number[] = [];
    if (owner) for (const b of owner.brood) if (!b.dead && !b.carrier && w.dist[b.cell] >= 0 && w.rootOf(b.cell) === root) cand.push(b.cell);
    let goal = cand.length ? r.pick(cand) : -1;
    for (let k = 0; k < 20 && goal < 0; k++) {
      const x = clampCol((c.at % W) + r.int(-14, 14));
      const y = Math.max(0, Math.min(H - 1, Math.floor(c.at / W) + r.int(-8, 10)));
      const i = idx(x, y);
      if (w.dist[i] >= 0 && i !== c.at && w.rootOf(i) === root) goal = i;
    }
    c.path = goal >= 0 && goal !== c.at ? (w.route(c.at, goal) ?? []).slice(1) : [];
    if (!c.path.length) {
      c.leaving = true;
      c.path = (w.routeToRoot(c.at) ?? []).slice(1);
    }
  }

  /** A ladybird flies in to eat aphids, and the ants that tend them turn out to chase it. */
  private spawnLadybird(): void {
    const s = this.sim;
    const herds = this.herds.filter((h) => h.size > 5);
    if (!herds.length) return;
    const hd = s.rng.pick(herds);
    const c = this.spawnCritter('ladybird');
    const x = (hd.cell % W) + s.rng.range(-1, 1);
    const from = s.rng.chance(0.5) ? -1 : 1;
    c.x = Math.max(-5, Math.min(W + 5, x + from * 30));
    c.dir = -from;
    c.goal = x;
    c.alt = 14;
    c.herdId = hd.id;
    if (hd.owner?.isPlayer) s.emit('A ladybird has landed by your aphids! The ants that tend them will chase it off.', 'bad');
  }

  private updateLadybird(c: Critter, dt: number, engaged: boolean): void {
    if (c.leaving) {
      c.x += c.dir * 6 * dt;
      c.alt += 5 * dt;
      if (c.alt > 30 || c.x < -10 || c.x > W + 10) c.dead = true;
      return;
    }
    if (c.alt > 0) {
      const d = c.goal - c.x;
      c.x += Math.sign(d) * Math.min(Math.abs(d), 7 * dt);
      c.alt = Math.abs(d) < 0.2 ? 0 : Math.min(c.alt, Math.abs(c.goal - c.x) * 0.5);
      if (c.alt === 0) {
        const hd = this.herds.find((h) => h.id === c.herdId);
        hd?.owner?.guardHerd(c.x);
      }
      return;
    }
    const hd = this.herds.find((h) => h.id === c.herdId);
    // Chased off, full, or nothing left to eat
    if (!hd || hd.size <= 3 || c.t > DAY * 0.7 || c.hp < c.maxHp * 0.6) {
      c.leaving = true;
      c.dir = this.sim.rng.chance(0.5) ? 1 : -1;
      return;
    }
    if (!engaged) hd.size = Math.max(3, hd.size - dt * 0.05);
  }

  private nearestSurfaceAnt(x: number, range: number): Ant | null {
    let best: Ant | null = null;
    let bd = range;
    for (const col of this.sim.colonies) {
      for (const a of col.ants) {
        if (a.dead || a.under || a.intent === 'fly' || a.intent === 'trapped') continue;
        const d = Math.abs(a.x - x);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
    }
    return best;
  }

  update(dt: number): void {
    const s = this.sim;
    const r = s.rng;
    const season = s.season;
    const winter = season === 3;
    const m = s.intervalMul;

    let gone = false;
    for (const f of this.food) {
      f.age += dt;
      if (f.age > f.life || f.amount <= 0) f.gone = true;
      if (f.gone) gone = true;
    }
    if (gone) this.food = this.food.filter((f) => !f.gone);

    // Aphids breed and drip honeydew while ants look after them, and dwindle when nobody does
    for (const hd of this.herds) {
      hd.tendT += dt;
      if (winter) continue;
      const tended = hd.tendT < 60;
      hd.size = tended ? Math.min(30, hd.size + dt * 0.02) : Math.max(3, hd.size - dt * 0.004);
      hd.honey = Math.min(hd.size * 2, hd.honey + hd.size * (tended ? 0.012 : 0.004) * dt);
    }

    for (const p of this.plants) {
      if (p.grow < 1) {
        p.grow = Math.min(1, p.grow + dt / (DAY * 0.6));
        continue;
      }
      if ((p.kind !== 'tree' && p.kind !== 'berry') || winter) continue;
      p.dropT -= dt;
      if (p.dropT > 0) continue;
      const base = p.kind === 'tree' ? [75, 42, 30, 1e9][season] : 50;
      p.dropT = base * m * r.range(0.7, 1.3);
      if (this.food.length > 70) continue;
      const spread = p.kind === 'tree' ? 9 * p.size : 3;
      this.addFood(p.x + r.range(-spread, spread), p.kind === 'tree' ? 'fruit' : 'berry');
    }

    if (!winter && s.player) {
      this.carcT -= dt;
      if (this.carcT <= 0) {
        this.carcT = (60 * m * r.range(0.7, 1.3)) / s.biome.carrion;
        if (this.food.length < 70) this.addFood(r.int(5, W - 6), 'carcass');
      }
      // Seeds fall all autumn, and grasses shed a few in summer
      if (season === 1 || season === 2) {
        this.seedT -= dt;
        if (this.seedT <= 0) {
          this.seedT = ((season === 2 ? 35 : 80) * m * r.range(0.7, 1.3)) / s.biome.seeds;
          const flowers = this.plants.filter((p) => p.kind === 'flower');
          if (flowers.length) this.addFood(r.pick(flowers).x + r.range(-2, 2), 'seeds');
        }
      }
      this.bugT -= dt;
      if (this.bugT <= 0) {
        const mb = 0.55 * this.rate('beetle');
        const mc = 0.45 * this.rate('caterpillar');
        this.bugT = (110 * r.range(0.7, 1.3)) / (mb + mc);
        if (!s.weather.raining && this.critters.length < 4) this.spawnCritter(r.chance(mb / (mb + mc)) ? 'beetle' : 'caterpillar');
      }
      if (s.day >= 4) {
        this.birdT -= dt;
        if (this.birdT <= 0) this.birdT = s.light > 0.6 && !s.weather.raining && this.spawnBird() ? (DAY * r.range(1, 2)) / this.rate('bird') : 25;
      }
      if (s.day >= 4) {
        this.centT -= dt;
        if (this.centT <= 0) {
          this.centT = (DAY * r.range(2.5, 4)) / this.rate('centipede');
          this.spawnCentipede();
        }
      }
      if (season < 2 && this.herds.some((h) => h.owner)) {
        this.ladyT -= dt;
        if (this.ladyT <= 0) {
          this.ladyT = (DAY * r.range(1.2, 2.2)) / this.rate('ladybird');
          this.spawnLadybird();
        }
      }
      if (s.day >= 3) {
        this.spiderT -= dt;
        if (this.spiderT <= 0) {
          this.spiderT = (DAY * r.range(1.6, 3) * (s.opts.abundance === 'plenty' ? 1.3 : 1)) / this.rate('spider');
          this.spawnCritter('spider');
          s.emit('A wolf spider is prowling the surface!', 'bad', 'spider');
        }
      }
    }

    for (const c of this.critters) {
      if (c.dead) continue;
      const info = CRITTER_INFO[c.kind];
      c.t += dt;
      const engaged = c.attackers.length > 0;
      if (c.kind === 'centipede') this.updateCentipede(c, dt, engaged);
      else if (c.kind === 'bird') this.updateBird(c, dt);
      else if (c.kind === 'ladybird') this.updateLadybird(c, dt, engaged);
      else if (c.kind === 'spider' && !c.leaving) {
        if (c.kills >= 6 || c.t > 110) {
          c.leaving = true;
          c.dir = c.x < W / 2 ? -1 : 1;
        } else if (!engaged) {
          c.scanT -= dt;
          if (c.scanT <= 0) {
            c.scanT = 0.4;
            const prey = this.nearestSurfaceAnt(c.x, 90);
            if (prey) {
              c.dir = prey.x > c.x ? 1 : -1;
              if (Math.abs(prey.x - c.x) < 1.4 && !prey.foeAnt && !prey.foeCritter) {
                prey.colony.interrupt(prey);
                prey.foeCritter = c;
                prey.intent = 'fight';
                s.alarm(prey);
              }
            }
          }
        }
      }
      if ((!engaged || c.leaving) && c.kind !== 'centipede' && c.kind !== 'bird' && c.kind !== 'ladybird') c.x += c.dir * info.speed * (c.leaving ? 1.5 : 1) * dt;
      if (engaged && info.atk > 0) {
        c.biteT -= dt;
        if (c.biteT <= 0) {
          c.biteT = info.bite;
          const a = r.pick(c.attackers);
          if (!a.dead) {
            a.hp -= info.atk * r.range(0.7, 1.3);
            if (a.hp <= 0) {
              a.colony.die(a, KILLS[c.kind] ?? 'killed by a critter');
              c.kills++;
            }
          }
        }
      }
      if (!c.under && (c.x < -6 || c.x > W + 6)) c.dead = true;
    }
    if (this.critters.some((c) => c.dead)) this.critters = this.critters.filter((c) => !c.dead);
  }
}

import {
  W, H, AIR, DIRT, TUNNEL, idx, DX, DY, DAY, SEASON_DAYS, HARD_CAP, clampCol,
  ROLE_QUEEN, ROLE_NURSERY, ROLE_FOOD, ROLE_MIDDEN, ROLE_GRANARY,
} from './config';
import { Ant, TASKS, CASTE_HP, CASTE_ATK, LOAD_NONE, LOAD_SUGAR, LOAD_PROTEIN, LOAD_BROOD, LOAD_CORPSE, LOAD_SEED } from './ant';
import type { Caste, Task, Leg, Band } from './ant';
import type { Species } from './species';
import type { Sim, Corpse } from './sim';
import type { FoodSource, Herd } from './ecology';
import { planChamber, planTunnel, planFounding, planReach } from './planner';
import { highGround } from './danger';

/** In winter the colony huddles and eats this share of its usual food. */
const WINTER_EAT = 0.22;

/** Stand marker for a dig target reached from the surface (the very first shaft cells). */
export const SURFACE = -2;
const WORKER_CARRY = 3;
/** Sugar one replete holds when full. */
const REPLETE_CAP = 30;
/** Sim seconds an egg, larva and pupa each take at the ideal temperature (before species/caste multipliers). */
const BROOD_TIME = [10, 13, 10];
/** Temperature each brood stage likes best: pupae warmest. */
const BROOD_BEST = [25, 27, 29];
/** Protein a worker larva eats over its whole stage. */
const LARVA_PROTEIN = 1.2;
/** Fraction of carried soil loads that actually build up the mound. */
const MOUND_SHARE = 0.12;
/** How much each age band leans toward each task, in TASKS order (dig, forage, nurse, clean, guard). */
const BAND_LEAN: Record<Band, number[]> = {
  nurse: [0, -0.2, 0.3, 0.05, -0.2],
  builder: [0.2, 0, 0, 0.15, 0],
  forager: [0, 0.3, -0.35, 0, 0.15],
};

/** How fast brood develops at a temperature, for a stage that likes `best` degrees. */
export const warmth = (t: number, best = 27): number => 0.3 + 0.7 * Math.exp(-(((t - best) / 11) ** 2));

export interface Project {
  id: number;
  kind: 'shaft' | 'tunnel' | 'chamber';
  role: number;
  /** Cells to dig, in dig order. */
  cells: number[];
  /** Centreline cells, used as branch points for new tunnels. */
  spine: number[];
  cursor: number;
  workers: number;
  maxWorkers: number;
  queenOnly: boolean;
  /** Keeper-requested: workers take it first. */
  priority: boolean;
  done: boolean;
  /** Tunnel already had a chance at an end chamber. */
  capped: boolean;
  /** Tunnel end point and heading, or chamber centre. */
  ex: number;
  ey: number;
  dx: number;
  dy: number;
}

export interface Brood {
  cell: number;
  stage: number;
  t: number;
  caste: Caste;
  /** A worker-laid egg, which can only become a male. */
  male?: boolean;
  carrier: Ant | null;
  claimed: Ant | null;
  wet: number;
  starve: number;
  ox: number;
  oy: number;
  dead: boolean;
  /** A nursery that suits this stage noticeably better than where it lies now. */
  goal: Project | null;
}

export type Focus = 'balanced' | 'forage' | 'expand' | 'defend';

export const FOCUS: Record<Focus, { dig: number; forage: number; guard: number; label: string; desc: string }> = {
  balanced: { dig: 1, forage: 1, guard: 1, label: 'Balanced', desc: 'Workers split their time evenly.' },
  forage: { dig: 0.6, forage: 1.7, guard: 0.8, label: 'Forage', desc: 'More foragers. Fill the stores fast.' },
  expand: { dig: 1.8, forage: 0.8, guard: 0.7, label: 'Expand', desc: 'Dig more tunnels and chambers.' },
  defend: { dig: 0.7, forage: 0.85, guard: 3, label: 'Defend', desc: 'Guards at the entrance, more soldiers.' },
};

interface Raid {
  target: Colony;
  phase: 'gather' | 'march';
  t: number;
  start: number;
  rally: number;
  size: number;
}

interface Threat {
  under: boolean;
  at: number;
  x: number;
}

export class Colony {
  ants: Ant[] = [];
  brood: Brood[] = [];
  readonly projects: Project[] = [];
  active: Project[] = [];
  /** Entrances this colony dug. */
  readonly roots: number[] = [];
  queen: Ant;
  queenAlive = true;
  queenChamber: Project | null = null;
  settled = false;
  sugar = 30;
  protein = 20;
  cap = 60;
  midden = 0;
  hunger = 0;
  focus: Focus = 'balanced';
  /** Multiplier on egg interval (the rival uses it for difficulty). */
  layScale = 1;
  readonly known = new Set<FoodSource>();
  /** Food trail along the surface, laid by laden ants on the way home. */
  readonly trail = new Float32Array(W);
  /** Home-range scent: where this colony's ants walk, marked as theirs. */
  readonly home = new Float32Array(W);
  tandems = 0;
  /** Food coming in per second, smoothed over a few hours. */
  income = 0;
  private lastGathered = 0;
  /** Antlion pits a nestmate has fallen into: the others step round them now. */
  readonly knownPits = new Set<number>();
  /** Army ants are on the way: everyone stays in. */
  lockdown = false;
  /** Where the brood is being carried to get it out of the army ants' reach. */
  evac: Project | null = null;
  /** Fire ants sitting out a flood in a living raft, and the column it floats to. */
  rafting = false;
  raftX = -1;
  private raftT = 0;
  readonly counts: Record<Task, number> = { none: 0, dig: 0, forage: 0, nurse: 0, clean: 0, guard: 0, raid: 0 };
  raid: Raid | null = null;
  alateQueue = 0;
  flownYear = -1;
  flying = false;
  /** Winters survived. A colony only raises alates once it is mature. */
  winters = 0;
  readonly stats = { peak: 1, born: 0, lost: 0, kills: 0, gathered: 0, dug: 0, shared: 0, trapped: 0, rescued: 0, rafts: 0, starved: 0 };
  /** The keeper's mother colony on this map: never an enemy [v1.6]. */
  kin = false;
  /** The queen is dead and the workers are raising a last brood of males before the colony fades. */
  orphaned = false;
  private orphanT = 0;
  /** Seconds the winged ants have been waiting for good flying weather. */
  private alateWait = 0;
  /** Upper shaft cells, where idle ants wait to take food off returning foragers. */
  vestibule: number[] = [];
  /** Sugar in transit in workers' crops (part of the colony's stores, really). */
  cropSugar = 0;
  /** Idle ants already waiting in the vestibule. */
  private waiting = 0;
  /** The food each finder found, so she can lead a tandem run back to it. */
  private readonly lastFind = new Map<Ant, FoodSource>();
  threat: Threat | null = null;
  workerCount = 0;
  soldierCount = 0;
  alateCount = 0;
  repleteCount = 0;
  broodToMove = 0;
  corpsesPending = 0;
  foodChambers: Project[] = [];
  nurseryChambers: Project[] = [];
  middenChambers: Project[] = [];
  /** Temperature at each nursery and how much brood lies in it, refreshed each second. */
  private nurseryTemp: number[] = [];
  private nurseryLoad: number[] = [];
  /** Average development speed of the brood where it lies (1 = ideal warmth). */
  broodWarmth = 0;
  /** How long each task (TASKS order) has gone badly short-handed; it sharpens the stimulus. */
  private readonly neglect = new Float32Array(TASKS.length);
  /** Ants each task needs (TASKS order), refreshed every second. */
  private readonly want = new Float32Array(TASKS.length);
  /** Chambers planned per role. */
  readonly roomCount = [0, 0, 0, 0, 0, 0];
  /** Seeds in the granaries: they keep, but must be cracked before anyone can eat them. */
  seeds = 0;
  seedCap = 0;
  granaryChambers: Project[] = [];
  foundT: number;
  layT = 0;
  clutch = 0;
  private archT = 0;
  private rebalT = 0;
  private digSlots = 0;
  private scouts = 0;
  private starveWarned = false;

  constructor(readonly sim: Sim, readonly species: Species, readonly isPlayer: boolean, readonly name: string, col: number) {
    this.queen = this.spawn('queen', false, clampCol(col));
    this.queen.intent = 'found';
    this.foundT = sim.rng.range(1.5, 3);
  }

  get world() {
    return this.sim.world;
  }

  get rng() {
    return this.sim.rng;
  }

  get pop(): number {
    return this.ants.length;
  }

  get alive(): boolean {
    return this.queenAlive || this.ants.length > 0;
  }

  /** The keeper's colony and its mother colony leave each other alone. */
  friendly(o: Colony): boolean {
    return (this.kin && o.isPlayer) || (o.kin && this.isPlayer);
  }

  get stored(): number {
    return this.sugar + this.protein;
  }

  strength(): number {
    return (this.workerCount + this.soldierCount * 3) * this.species.atk * Math.sqrt(this.species.hp / 10);
  }

  mainRoot(): number {
    return this.roots.length ? this.roots[0] : -1;
  }

  broodStats(): { eggs: number; larvae: number; pupae: number } {
    const n = [0, 0, 0];
    for (const b of this.brood) n[b.stage]++;
    return { eggs: n[0], larvae: n[1], pupae: n[2] };
  }

  // ── main loop ───────────────────────────────────────────────────────

  update(dt: number): void {
    const w = this.world;
    if (!this.queenChamber) this.foundT -= dt;
    let died = false;
    for (let k = 0; k < this.ants.length; k++) {
      const a = this.ants[k];
      if (a.dead) {
        died = true;
        continue;
      }
      a.age += dt;
      if (a.age > a.phys * a.life) a.phys = a.age / a.life;
      if (a.taskT > 0) a.taskT -= dt;
      if (a.age > a.life) {
        this.die(a, 'old age');
        died = true;
        continue;
      }
      if (a.under && w.water[a.at] && a.caste !== 'queen' && !this.rafting) {
        a.wet += dt;
        if (a.wet > 35) {
          this.die(a, 'drowned');
          died = true;
          continue;
        }
      } else if (a.wet > 0) a.wet = Math.max(0, a.wet - dt * 2);
      this.updateAnt(a, dt);
      if (a.dead) died = true;
    }
    if (died) this.ants = this.ants.filter((a) => !a.dead);
    this.updateBrood(dt);
    this.updateQueen(dt);
    this.eat(dt);
    // Trails fade within a couple of hours unless laden ants keep laying them; the home range lasts days
    const fade = 1 - dt * 0.06;
    const trail = this.trail;
    const home = this.home;
    for (let x = 0; x < W; x++) {
      if (trail[x] > 0) trail[x] = Math.max(0, trail[x] * fade - dt * 0.002);
      if (home[x] > 0) home[x] = Math.max(0, home[x] - dt * 0.0012);
    }
    this.rebalT -= dt;
    if (this.rebalT <= 0) {
      this.rebalT = 1;
      this.rebalance();
    }
    this.archT -= dt;
    if (this.archT <= 0) {
      this.archT = 1.2;
      this.architect();
    }
  }

  spawn(caste: Caste, under: boolean, at: number): Ant {
    const s = this.sim;
    const sp = this.species;
    const a = new Ant(s.nextAntId++, this, caste, s.rng);
    a.under = under;
    a.at = at;
    a.x = this.px(under, at);
    a.y = this.py(under, at);
    a.maxHp = a.hp = sp.hp * CASTE_HP[caste];
    a.atk = sp.atk * CASTE_ATK[caste];
    a.life = caste === 'queen' || caste === 'alate'
      ? Infinity
      : sp.life * DAY * s.rng.range(0.8, 1.2) * (caste === 'soldier' ? 1.2 : 1);
    if (caste === 'alate') a.male = s.rng.chance(0.5);
    this.ants.push(a);
    return a;
  }

  die(a: Ant, cause: string, killer: Colony | null = null): void {
    if (a.dead) return;
    this.interrupt(a);
    this.leaveJob(a);
    a.dead = true;
    if (a.brood) {
      a.brood.claimed = null;
      a.brood = null;
    }
    if (a.corpse) {
      a.corpse.claimed = null;
      a.corpse = null;
    }
    a.food = null;
    this.stats.lost++;
    if (cause === 'starvation') this.stats.starved++;
    if (killer) killer.stats.kills++;
    const s = this.sim;
    if (a.under) s.corpses.push({ at: a.at, nest: s.nestOwner(a.at), claimed: null, age: 0, gone: false });
    else s.eco.addFood(clampCol(a.x), 'corpse');
    // A replete bursts, and the honey in her is lost
    if (a.caste === 'replete') this.sugar = Math.max(0, this.sugar - this.sugar * Math.min(1, REPLETE_CAP / this.cap));
    if (a === this.queen) {
      this.queenAlive = false;
      // Without her the colony winds down; a big one lays a last brood of males first
      this.orphaned = this.workerCount >= 30;
      this.orphanT = DAY * 1.5;
      for (const o of this.ants) o.life = Math.min(o.life, o.age + DAY * this.rng.range(this.orphaned ? 1.4 : 0.5, 2));
      if (!this.orphaned) for (const b of this.brood) this.killBrood(b);
      this.alateQueue = 0;
      if (this.raid) this.endRaid();
      s.onQueenDeath(this, cause);
    }
  }

  /** How quickly a cell digs: the biome's soil, or rotting wood that carpenter ants chew through and others find tough. */
  private digRate(cell: number): number {
    if (this.world.wood[cell]) return this.species.id === 'camponotus' ? 2.4 : 0.7;
    return this.sim.biome.dig;
  }

  /** Let go of whatever she's carrying out on the surface: food is lost, a corpse falls where she is. */
  dropLoad(a: Ant): void {
    if (a.load === LOAD_CORPSE) this.sim.eco.addFood(clampCol(a.x), 'corpse');
    a.load = LOAD_NONE;
    a.loadAmt = 0;
  }

  /** Send a few workers up to chase a pest off one of our aphid herds. */
  guardHerd(x: number): void {
    let n = 3;
    for (const a of this.ants) {
      if (n <= 0) break;
      if (a.dead || (a.caste !== 'worker' && a.caste !== 'soldier') || a.intent === 'fight' || a.load !== LOAD_NONE || a.task === 'raid' || Math.abs(a.x - x) > 30) continue;
      this.interrupt(a);
      this.leaveJob(a);
      a.intent = 'toThreat';
      this.travelSurface(a, clampCol(x));
      n--;
    }
  }

  /** Stop whatever the ant is doing right now (fights, raids). Keeps any food it holds. */
  interrupt(a: Ant): void {
    this.resetLegs(a);
    a.wait = 0;
    this.release(a);
    if (a.herd) {
      a.herd.visitors = Math.max(0, a.herd.visitors - 1);
      a.herd = null;
    }
    if (a.load === LOAD_BROOD && a.brood) {
      const b = a.brood;
      b.carrier = null;
      if (a.under) b.cell = a.at;
      else this.killBrood(b);
      a.brood = null;
      a.load = LOAD_NONE;
    } else if (a.brood) {
      a.brood.claimed = null;
      a.brood = null;
    }
    if (a.corpse) {
      a.corpse.claimed = null;
      a.corpse = null;
    }
  }

  // ── ants ────────────────────────────────────────────────────────────

  private px(under: boolean, p: number): number {
    return (under ? p % W : p) + 0.5;
  }

  private py(under: boolean, p: number): number {
    return under ? Math.floor(p / W) + 0.5 : this.world.top[p] - 0.5;
  }

  private speed(a: Ant): number {
    const s = this.sim;
    let v = (a.caste === 'queen' ? 4.5 : a.under ? 6 : 8) * this.species.speed * (a.caste === 'replete' ? 0.35 : 1);
    if (a.caste === 'soldier') v *= 0.85;
    if (a.intent === 'idle' || a.intent === 'rest') v *= 0.4;
    if (a.carry > 0 || a.load !== LOAD_NONE) v *= 0.85;
    if (a.under && this.world.water[a.at]) v *= 0.5;
    if (!a.under && (s.weather.raining || s.isWinter)) v *= 0.75;
    return v;
  }

  private updateAnt(a: Ant, dt: number): void {
    if (a.intent === 'fight') {
      if (a.foeAnt || a.foeCritter) return;
      a.intent = 'idle';
    }
    if (a.intent === 'fly') {
      a.y -= dt * 7;
      a.x += Math.sin(this.sim.time * 3 + a.id) * dt * 3;
      a.hx = 0;
      a.hy = -1;
      if (a.y < -30) a.dead = true; // flown away: gone, but not a loss
      return;
    }
    if (a.legs.length) {
      this.move(a, dt);
      return;
    }
    if (a.wait > 0) {
      a.wait -= dt;
      if (a.wait > 0) return;
      if (a.intent === 'digging') {
        this.finishDig(a);
        return;
      }
    }
    this.decide(a);
  }

  private move(a: Ant, dt: number): void {
    let budget = this.speed(a) * dt;
    while (budget > 0 && a.legs.length) {
      const leg = a.legs[a.legI];
      const p = leg.pts[a.ptI];
      const tx = this.px(leg.under, p);
      const ty = this.py(leg.under, p);
      const dx = tx - a.x;
      const dy = ty - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) {
        // Ease the heading round so ants don't snap between directions
        a.hx += (dx / d - a.hx) * 0.35;
        a.hy += (dy / d - a.hy) * 0.35;
        const hl = Math.hypot(a.hx, a.hy) || 1;
        a.hx /= hl;
        a.hy /= hl;
      }
      if (d <= budget) {
        a.x = tx;
        a.y = ty;
        a.under = leg.under;
        a.at = p;
        a.walk += d;
        budget -= d;
        if (++a.ptI >= leg.pts.length) {
          a.ptI = 0;
          if (++a.legI >= a.legs.length) this.resetLegs(a);
          else if (this.plugged(leg, a.legs[a.legI])) {
            // A pebble sits in the entrance: wait for it to go
            this.resetLegs(a);
            a.wait = this.rng.range(1, 2.5);
            break;
          }
        }
        if (!leg.under && this.onSurfaceStep(a)) break;
      } else {
        a.x += (dx / d) * budget;
        a.y += (dy / d) * budget;
        a.walk += budget;
        budget = 0;
      }
    }
  }

  /** Underground in tunnels this colony dug (not lingering in an enemy nest after a raid). */
  private inOwnNest(a: Ant): boolean {
    return a.under && this.sim.nestOwner(a.at) === this;
  }

  /** Does going from one leg to the next pass through a plugged entrance? */
  private plugged(from: Leg, to: Leg): boolean {
    if (from.under === to.under || !this.sim.plugs.length) return false;
    return this.sim.isPlugged(to.under ? to.pts[0] : from.pts[from.pts.length - 1]);
  }

  /** Called whenever an ant reaches a surface column: lays trail, spots food. Returns true if it re-planned. */
  private onSurfaceStep(a: Ant): boolean {
    const x = a.at;
    this.home[x] = Math.min(1, this.home[x] + 0.02);
    if (a.load === LOAD_SUGAR || a.load === LOAD_PROTEIN || a.load === LOAD_SEED) this.trail[x] = Math.min(1, this.trail[x] + 0.05 + 0.12 * a.trailQ);
    const danger = this.sim.danger;
    const pit = danger.pitCol[x];
    if (pit >= 0 && (a.caste === 'worker' || a.caste === 'soldier') && a.intent !== 'fight' && danger.trap(a, pit)) return true;
    if (a.intent !== 'scout' && a.intent !== 'patrol') return false;
    const f = this.sim.eco.foodNear(x, 2.5);
    if (!f) return false;
    const fresh = !this.known.has(f);
    this.known.add(f);
    // Scouts are out to find something new: they note what they pass and only stop for a fresh find the colony can use
    const useful = f.type === 1 || (!this.proteinShort && this.stored < this.cap * 0.97);
    if (useful && ((a.intent === 'scout' && fresh) || (a.intent === 'patrol' && a.task === 'forage'))) {
      a.food = f;
      a.fresh = fresh;
      a.intent = 'toFood';
      this.travelSurface(a, f.x);
      return true;
    }
    return false;
  }

  private decide(a: Ant): void {
    const r = this.rng;
    switch (a.intent) {
      case 'found':
        if (this.foundT <= 0) {
          if (planFounding(this, a.at)) a.intent = 'work';
          else {
            // Old tunnels underfoot: walk on and look again
            this.foundT = 1;
            this.travelSurface(a, clampCol(a.at + (r.chance(0.5) ? 1 : -1) * r.int(12, 24)));
          }
        } else {
          this.travelSurface(a, clampCol(a.at + r.int(-6, 6)));
          a.wait = r.range(0.2, 0.8);
        }
        return;
      case 'toDig': {
        const t = a.target;
        const there = a.stand === SURFACE ? !a.under && a.at === t % W : a.under && a.at === a.stand;
        if (t < 0 || !there || this.world.cells[t] !== DIRT) {
          this.release(a);
          a.intent = 'work';
          return;
        }
        a.intent = 'digging';
        a.wait = (a.caste === 'queen' ? 0.35 : 0.55) / (this.species.dig * this.digRate(t));
        a.hx = (t % W) + 0.5 - a.x;
        a.hy = Math.floor(t / W) + 0.5 - a.y;
        const hl = Math.hypot(a.hx, a.hy) || 1;
        a.hx /= hl;
        a.hy /= hl;
        return;
      }
      case 'digging':
        this.finishDig(a);
        return;
      case 'dump':
        this.dump(a);
        return;
      case 'work':
        if (!this.assign(a)) {
          this.leaveJob(a);
          a.intent = 'idle';
        }
        return;
      case 'patrol':
      case 'scout':
        a.intent = 'home';
        a.wait = r.range(0.3, 1.5);
        return;
      case 'home':
        a.intent = 'idle';
        if (!a.under || !this.inOwnNest(a)) {
          const c = this.randomNestCell();
          if (c >= 0) this.travelUnder(a, c);
          else a.wait = 1;
        }
        return;
      case 'rest':
        this.queenRest(a);
        return;
      case 'toFood':
        this.arriveFood(a);
        return;
      case 'carryFood':
        this.deliverFood(a);
        return;
      case 'tandem':
        this.arriveFood(a);
        return;
      case 'toHerd':
        this.milk(a);
        return;
      case 'share':
        // The kiss is over: the receiver takes the sugar down, the forager heads back out
        if (a.load === LOAD_SUGAR) {
          a.intent = 'carryFood';
          this.travelUnder(a, this.storeCell());
        } else a.intent = 'idle';
        return;
      case 'toBrood':
        this.pickBrood(a);
        return;
      case 'carryBrood':
        this.dropBrood(a);
        return;
      case 'toCorpse':
        this.pickCorpse(a);
        return;
      case 'carryCorpse':
        this.dropCorpse(a);
        return;
      case 'hang':
        this.repleteIdle(a);
        return;
      case 'toFlight':
        // Only take off once out in the open air
        if (a.under) this.travelSurface(a, clampCol((this.mainRoot() % W) + r.range(-6, 6)));
        else a.intent = 'fly';
        return;
      case 'trapped':
        this.sim.danger.endTrap(a);
        return;
      case 'raft':
        if (this.rafting) a.wait = r.range(1.5, 3);
        else a.intent = 'home';
        return;
      case 'toThreat':
      case 'fight':
      case 'fly':
      case 'idle':
        a.intent = 'idle';
        this.idle(a);
        return;
    }
  }

  private idle(a: Ant): void {
    const s = this.sim;
    if (a.caste === 'queen') {
      if (this.settled) {
        a.intent = 'rest';
        this.queenRest(a);
      } else if (this.queenChamber?.done) this.settleQueen(a);
      else if (!this.assign(a)) a.wait = 0.5;
      return;
    }
    // Army ants on the way: nobody wanders about outside, and spoil and the dead wait until they've gone
    if (this.lockdown) {
      if (!a.under) {
        a.intent = 'home';
        return;
      }
      if (a.carry > 0 || a.load === LOAD_CORPSE) {
        a.wait = 2;
        return;
      }
    }
    // Finish delivering whatever is in the mandibles first
    if (a.load === LOAD_SUGAR || a.load === LOAD_PROTEIN || a.load === LOAD_SEED) {
      a.intent = 'carryFood';
      this.travelUnder(a, this.storeCell(a.load));
      return;
    }
    if (a.load === LOAD_BROOD && a.brood) {
      a.intent = 'carryBrood';
      this.travelUnder(a, this.nurseryCell(a.brood));
      return;
    }
    if (a.load === LOAD_CORPSE) {
      this.carryCorpseAway(a);
      return;
    }
    if (a.carry > 0) {
      a.intent = 'dump';
      this.travelSurface(a, this.dumpCol(a));
      return;
    }
    if (a.caste === 'alate') {
      this.alateIdle(a);
      return;
    }
    if (a.caste === 'replete') {
      this.repleteIdle(a);
      return;
    }
    if (a.task === 'raid') {
      this.raidIdle(a);
      return;
    }
    if (a.taskT <= 0) this.pickTask(a);
    let ok = false;
    switch (a.task) {
      case 'dig':
        ok = this.assign(a);
        break;
      case 'forage':
        ok = this.startForage(a);
        break;
      case 'nurse':
        ok = this.startNurse(a) || this.tend(a);
        break;
      case 'clean':
        ok = this.startClean(a);
        break;
      case 'guard':
        ok = this.guard(a);
        break;
      default:
        break;
    }
    if (ok) return;
    if (a.task !== 'none') {
      a.task = 'none';
      a.taskT = s.rng.range(2, 6);
    }
    if (!a.under || !this.inOwnNest(a)) {
      a.intent = 'home';
      return;
    }
    // A few idle ants drift up to the vestibule to meet returning foragers
    if (this.vestibule.length && this.waiting < 4 + this.counts.forage * 0.15 && s.world.dist[a.at] > 14 && s.rng.chance(0.2)) {
      this.waiting++;
      this.travelUnder(a, s.rng.pick(this.vestibule));
      return;
    }
    if (!s.isWinter && !s.weather.raining && this.workerCount > 4 && s.rng.chance(0.012) && this.roots.length) {
      a.intent = 'patrol';
      this.travelSurface(a, this.patrolCol());
      return;
    }
    this.wanderStep(a, -1);
    a.wait = s.rng.range(0.3, 1.6) * (s.isWinter ? 2.5 : 1);
  }

  /**
   * Response thresholds: each job gives off a stimulus (how far short the colony is of the ants it needs) and she
   * takes up the one that most beats her own threshold for it, nudged by her age band. Doing a job lowers her
   * threshold for it and doing others raises it, so specialists emerge on their own.
   */
  private pickTask(a: Ant): void {
    const s = this.sim;
    if (a.caste === 'soldier') {
      a.task = 'guard';
      a.taskT = 60;
      return;
    }
    const want = this.want;
    const lean = BAND_LEAN[a.band];
    let best = -1;
    let bs = 0;
    for (let k = 0; k < TASKS.length; k++) {
      const w = want[k];
      if (w <= 0.01) continue;
      // A job left undone smells stronger and stronger until somebody takes it
      const short = Math.min(1, Math.max(0, (w - this.counts[TASKS[k]]) / Math.max(1, w)));
      const sc = short * (1 + this.neglect[k]) - a.th[k] + lean[k] + s.rng.next() * 0.08;
      if (sc > bs) {
        bs = sc;
        best = k;
      }
    }
    const t: Task = best < 0 ? 'none' : TASKS[best];
    if (best >= 0) {
      this.counts[t]++;
      for (let k = 0; k < TASKS.length; k++) a.th[k] = Math.max(0.01, Math.min(0.95, a.th[k] + (k === best ? -0.025 : 0.004)));
      if (a.done[best] < 65535) a.done[best]++;
    }
    // Pressed into foraging young, she grows up overnight and won't go back to the nursery
    if (t === 'forage' && a.phys < 0.6) a.phys = 0.6;
    a.task = t;
    a.taskT = t === 'none' ? s.rng.range(4, 10) : s.rng.range(25, 60);
  }

  /** How many ants each task needs right now (TASKS order), and how long each has gone short-handed. */
  private updateWants(): void {
    const s = this.sim;
    const n = Math.max(1, this.workerCount);
    const f = FOCUS[this.focus];
    const winter = s.isWinter;
    const night = s.darkness > 0.35;
    const w = this.want;
    w[0] = winter ? 0 : Math.min(this.digSlots, n * 0.45) * f.dig;
    const herds = s.eco.herds.some((hd) => hd.owner === this && hd.access >= 0 && hd.honey > 2);
    w[1] = winter || (s.weather.raining && !herds) ? 0 : n * this.forageNeed() * f.forage * (night ? 0.35 : 1) * (s.weather.raining ? 0.4 : 1);
    w[2] = Math.min(n * 0.3, this.broodToMove * 0.8 + this.brood.length * 0.06);
    w[3] = Math.min(n * 0.1, this.corpsesPending);
    w[4] = (this.threat ? n * 0.25 : n * 0.03) * f.guard * (this.soldierCount > n * 0.1 ? 0.5 : 1);
    for (let k = 0; k < TASKS.length; k++) {
      const short = w[k] > 0.01 ? (w[k] - this.counts[TASKS[k]]) / Math.max(1, w[k]) : 0;
      this.neglect[k] = short > 0.25 ? Math.min(3, this.neglect[k] + 0.05) : this.neglect[k] * 0.8;
    }
  }

  /** Protein is running short for the brood and queen. */
  get proteinShort(): boolean {
    return this.protein < Math.max(8, this.brood.length * 0.4);
  }

  private forageNeed(): number {
    const full = this.stored / this.cap;
    if (full > 0.97 && !this.proteinShort) return 0.03;
    let need = 0.15 + (1 - full) * 0.3;
    if (this.sugar < this.cap * 0.15) need += 0.1;
    // Less than two days of food in store: all hands to foraging
    if (this.stored < (this.workerCount * this.species.appetite + 1.5) * 2) need += 0.15;
    if (this.proteinShort) need += 0.2;
    // Autumn: lay in stores for the winter
    if (this.sim.season === 2 && this.stored < this.cap * 0.8) need += 0.1;
    return need;
  }

  /** One step to a random neighbouring tunnel cell, optionally only within a chamber role. */
  private wanderStep(a: Ant, role: number): void {
    const w = this.world;
    const x = a.at % W;
    const y = (a.at / W) | 0;
    const opts: number[] = [];
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k];
      const ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = idx(nx, ny);
      if (w.cells[n] !== TUNNEL || w.dist[n] < 0) continue;
      if (role >= 0 && w.room[n] !== role) continue;
      if (a.caste === 'queen' && w.water[n]) continue;
      if (k >= 4 && w.cells[idx(nx, y)] !== TUNNEL && w.cells[idx(x, ny)] !== TUNNEL) continue;
      opts.push(n);
    }
    if (opts.length) {
      a.legs = [{ under: true, pts: [this.rng.pick(opts)] }];
      a.legI = 0;
      a.ptI = 0;
    }
  }

  private patrolCol(): number {
    const d = 6 + this.rng.next() * 50;
    return clampCol((this.mainRoot() % W) + (this.rng.chance(0.5) ? d : -d));
  }

  private dumpCol(a: Ant): number {
    const base = a.under ? this.world.rootOf(a.at) % W : a.at;
    const d = 4 + Math.floor(this.rng.next() ** 2 * 36);
    return clampCol(base + (this.rng.chance(0.5) ? d : -d));
  }

  randomNestCell(): number {
    const w = this.world;
    for (let k = 0; k < 10; k++) {
      const p = this.rng.pick(this.projects);
      if (!p || p.cursor === 0) continue;
      const c = this.rng.pick(p.cells);
      if (w.cells[c] === TUNNEL && w.dist[c] >= 0) return c;
    }
    const r = this.mainRoot();
    return r >= 0 && this.world.dist[r] >= 0 ? r : -1;
  }

  /** A random dry floor cell of a chamber (tunnel with no tunnel below). */
  floorCell(p: Project): number {
    const w = this.world;
    let any = -1;
    for (let k = 0; k < 20; k++) {
      const i = this.rng.pick(p.cells);
      if (w.cells[i] !== TUNNEL || w.dist[i] < 0) continue;
      if (any < 0 || !w.water[i]) any = i;
      if (w.cells[i + W] !== TUNNEL && !w.water[i]) return i;
    }
    return any >= 0 ? any : this.randomNestCell();
  }

  // ── travel ──────────────────────────────────────────────────────────

  private resetLegs(a: Ant): void {
    a.legs = [];
    a.legI = 0;
    a.ptI = 0;
  }

  travelSurface(a: Ant, col: number): void {
    this.resetLegs(a);
    let from = a.at;
    if (a.under) {
      const up = this.world.routeToRoot(a.at);
      if (!up) {
        a.wait = 0.5;
        return;
      }
      a.legs.push({ under: true, pts: up });
      from = up[up.length - 1] % W;
    }
    a.legs.push({ under: false, pts: span(from, clampCol(col)) });
  }

  travelUnder(a: Ant, cell: number): void {
    const w = this.world;
    this.resetLegs(a);
    if (cell < 0) {
      a.wait = 0.5;
      return;
    }
    if (a.under) {
      const r = w.route(a.at, cell);
      if (r) {
        a.legs.push({ under: true, pts: r });
        return;
      }
    }
    const down = w.routeToRoot(cell);
    if (!down) {
      a.wait = 0.5;
      return;
    }
    down.reverse();
    const entry = down[0] % W;
    if (a.under) {
      const up = w.routeToRoot(a.at);
      if (!up) {
        a.wait = 0.5;
        return;
      }
      a.legs.push({ under: true, pts: up });
      a.legs.push({ under: false, pts: span(up[up.length - 1] % W, entry) });
    } else {
      a.legs.push({ under: false, pts: span(a.at, entry) });
    }
    a.legs.push({ under: true, pts: down });
  }

  // ── digging ─────────────────────────────────────────────────────────

  addProject(
    kind: Project['kind'], role: number, cells: number[], spine: number[],
    ex: number, ey: number, dx: number, dy: number,
  ): Project {
    const s = this.sim;
    const p: Project = {
      id: s.nextProjectId++, kind, role, cells, spine, cursor: 0, workers: 0,
      maxWorkers: kind === 'chamber' ? 6 : kind === 'tunnel' ? 3 : 2,
      queenOnly: false, priority: false, done: false, capped: false, ex, ey, dx, dy,
    };
    for (const c of cells) this.world.planOwner[c] = p.id + 1;
    s.projectOwner[p.id] = this;
    this.projects.push(p);
    this.active.push(p);
    return p;
  }

  /** Forget a project nobody has started digging. */
  dropProject(p: Project): void {
    for (const c of p.cells) if (this.world.planOwner[c] === p.id + 1) this.world.planOwner[c] = 0;
    this.projects.splice(this.projects.indexOf(p), 1);
    this.active = this.active.filter((q) => q !== p);
  }

  private assign(a: Ant): boolean {
    let p = a.job;
    if (p && p.done) {
      this.leaveJob(a);
      p = null;
    }
    // A project she can't get at (an urgent one included) mustn't stop her digging the next one
    const tried = new Set<Project>();
    for (let k = 0; k < 4; k++) {
      if (!p) {
        p = this.pickProject(a, tried);
        if (!p) return false;
        a.job = p;
        p.workers++;
      }
      const t = this.findFrontier(p, a, false);
      if (t >= 0) {
        this.goDig(a, t);
        return true;
      }
      this.leaveJob(a);
      tried.add(p);
      p = null;
    }
    return false;
  }

  private pickProject(a: Ant, skip?: Set<Project>): Project | null {
    // The founding queen works through her plan in order: shaft, then chamber
    if (a.caste === 'queen') return this.active.find((p) => p.queenOnly) ?? null;
    let best: Project | null = null;
    let bs = Infinity;
    for (const p of this.active) {
      if (p.done || p.queenOnly || p.workers >= p.maxWorkers || skip?.has(p)) continue;
      const sc = p.workers / p.maxWorkers + this.rng.next() * 0.3 - (p.priority ? 1 : 0);
      if (sc < bs) {
        bs = sc;
        best = p;
      }
    }
    return best;
  }

  private goDig(a: Ant, t: number): void {
    const s = this.standFor(t);
    this.world.reservedBy[t] = a.id;
    a.target = t;
    a.stand = s;
    a.intent = 'toDig';
    if (s === SURFACE) this.travelSurface(a, t % W);
    else this.travelUnder(a, s);
  }

  private release(a: Ant): void {
    if (a.target >= 0 && this.world.reservedBy[a.target] === a.id) this.world.reservedBy[a.target] = -1;
    a.target = -1;
  }

  private leaveJob(a: Ant): void {
    this.release(a);
    if (a.job) {
      a.job.workers--;
      a.job = null;
    }
  }

  /** A connected tunnel cell an ant can stand in to dig t, SURFACE if dug from above, -1 if none. */
  private standFor(t: number): number {
    const w = this.world;
    const x = t % W;
    const y = (t / W) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k];
      const ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = idx(nx, ny);
      if (w.cells[n] !== TUNNEL || w.dist[n] < 0) continue;
      if (k >= 4 && w.cells[idx(nx, y)] !== TUNNEL && w.cells[idx(x, ny)] !== TUNNEL) continue;
      return n;
    }
    if (y > 0 && w.cells[t - W] === AIR) return SURFACE;
    return -1;
  }

  private advance(p: Project): void {
    const c = this.world.cells;
    while (p.cursor < p.cells.length && c[p.cells[p.cursor]] !== DIRT) p.cursor++;
    if (p.cursor >= p.cells.length) this.complete(p);
  }

  /** Next diggable cell of a project, -1 if none. nearOnly limits it to cells right by the ant. */
  private findFrontier(p: Project, a: Ant, nearOnly: boolean): number {
    const w = this.world;
    this.advance(p);
    if (p.done) return -1;
    const end = Math.min(p.cells.length, p.cursor + 160);
    let pending = 0;
    for (let k = p.cursor; k < end; k++) {
      const t = p.cells[k];
      if (w.cells[t] !== DIRT) continue;
      if (w.reservedBy[t] >= 0) {
        pending++;
        continue;
      }
      if (nearOnly && (Math.abs((t % W) + 0.5 - a.x) > 2.6 || Math.abs(Math.floor(t / W) + 0.5 - a.y) > 2.6)) continue;
      if (this.standFor(t) === -1) continue;
      return t;
    }
    // Started, but everything left is unreachable: call it finished rather than stall forever
    if (!nearOnly && pending === 0 && p.cursor > 0 && end === p.cells.length) this.complete(p);
    return -1;
  }

  private finishDig(a: Ant): void {
    const p = a.job;
    const t = a.target;
    if (!p || t < 0) {
      a.intent = 'work';
      return;
    }
    this.release(a);
    if (this.world.cells[t] === DIRT) {
      if (this.world.dig(t, p.role)) this.roots.push(t);
      this.stats.dug++;
      // The queen packs her soil into the walls; workers haul it out
      if (a.caste !== 'queen') a.carry++;
    }
    this.advance(p);
    if (!p.done && (a.caste === 'queen' || a.carry < WORKER_CARRY)) {
      const n = this.findFrontier(p, a, true);
      if (n >= 0) {
        this.goDig(a, n);
        return;
      }
    }
    if (a.carry > 0) {
      a.intent = this.lockdown ? 'idle' : 'dump';
      if (this.lockdown) a.wait = 2;
      else this.travelSurface(a, this.dumpCol(a));
      return;
    }
    a.intent = 'work';
  }

  private complete(p: Project): void {
    if (p.done) return;
    p.done = true;
    this.active = this.active.filter((q) => q !== p);
  }

  private dump(a: Ant): void {
    if (a.under) {
      this.travelSurface(a, this.dumpCol(a));
      return;
    }
    const r = this.rng;
    for (let k = 0; k < a.carry; k++) if (r.chance(MOUND_SHARE)) this.world.addMound(a.at, r);
    a.carry = 0;
    if (a.load === LOAD_CORPSE) {
      this.sim.eco.addFood(a.at, 'corpse');
      a.load = LOAD_NONE;
    }
    a.intent = a.job ? 'work' : 'idle';
  }

  // ── planning ────────────────────────────────────────────────────────

  private settleQueen(q: Ant): void {
    const ch = this.queenChamber!;
    this.leaveJob(q);
    q.intent = 'rest';
    this.travelUnder(q, this.nearestCell(ch, ch.ex, ch.ey + 1));
    this.settled = true;
    this.layT = 2;
    this.clutch = 4;
  }

  private queenRest(q: Ant): void {
    if (q.under && this.world.room[q.at] !== ROLE_QUEEN && this.queenChamber) {
      this.travelUnder(q, this.nearestCell(this.queenChamber, this.queenChamber.ex, this.queenChamber.ey + 1));
      return;
    }
    this.wanderStep(q, ROLE_QUEEN);
    q.wait = this.rng.range(1.5, 4.5);
  }

  private nearestCell(p: Project, x: number, y: number): number {
    let best = -1;
    let bd = Infinity;
    for (const c of p.cells) {
      if (this.world.cells[c] !== TUNNEL || this.world.water[c]) continue;
      const d = ((c % W) + 0.5 - x) ** 2 + (Math.floor(c / W) + 0.5 - y) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best >= 0 ? best : this.floorCell(p);
  }

  /** What the next chamber should be, from what the colony is short of. */
  private nextRole(): number {
    const r = this.rng;
    const n = this.roomCount;
    if (n[ROLE_NURSERY] === 0) return ROLE_NURSERY;
    if (n[ROLE_FOOD] === 0) return ROLE_FOOD;
    // Room to store a winter's food comes first
    if (this.cap < this.winterNeed() && r.chance(0.75)) return ROLE_FOOD;
    if (this.brood.length > n[ROLE_NURSERY] * 40 && r.chance(0.7)) return ROLE_NURSERY;
    if (this.stored / this.cap > 0.6 && r.chance(0.7)) return ROLE_FOOD;
    if (this.midden > n[ROLE_MIDDEN] * 40 + 15 && r.chance(0.6)) return ROLE_MIDDEN;
    // A granary once seeds start coming in, and another when it fills
    const seedy = this.sim.season === 2 || this.seeds > 0 || [...this.known].some((f) => f.kind === 'seeds');
    if (seedy && this.workerCount >= 30 && (n[ROLE_GRANARY] === 0 || this.seeds > this.seedCap * 0.8) && r.chance(0.6)) return ROLE_GRANARY;
    // Otherwise keep roughly two nurseries for every food store, with the odd midden
    const v = r.next();
    if (v < 0.15) return ROLE_MIDDEN;
    return n[ROLE_NURSERY] <= n[ROLE_FOOD] * 1.5 ? ROLE_NURSERY : ROLE_FOOD;
  }

  /** Colony-level planner: grows the nest roughly in step with the workforce. */
  private architect(): void {
    const s = this.sim;
    if (!this.settled || !this.queenAlive || s.isWinter) return;
    const workers = this.workerCount;
    if (workers < 1) return;
    let plain = 0;
    for (const p of this.active) if (!p.priority) plain++;
    if (plain >= Math.min(10, 1 + Math.floor(workers / 6))) return;
    // A tiny colony still gets its first nursery and food store, however little it has dug
    const basics = this.roomCount[ROLE_NURSERY] > 0 && this.roomCount[ROLE_FOOD] > 0;
    // ...and so does somewhere to put the winter's food, whatever's been dug already
    if (basics && this.cap >= this.winterNeed() && this.stats.dug >= 160 + workers * 12 * (this.focus === 'expand' ? 1.5 : 1)) return;
    const r = this.rng;

    const bare = this.projects.filter((p) => p.done && p.kind === 'tunnel' && !p.capped);
    if (bare.length && (this.roomCount[ROLE_NURSERY] === 0 || r.chance(0.5))) {
      const t = r.pick(bare);
      t.capped = true;
      const role = this.nextRole();
      if (planChamber(this, t.ex, t.ey, t.dx, t.dy, r.range(4.5, 8), r.range(2.6, 3.8), role, false)) {
        this.roomCount[role]++;
        return;
      }
    }
    const srcs = this.projects.filter((p) => p.done && p.kind !== 'chamber');
    for (let k = 0; k < 6 && srcs.length; k++) if (planTunnel(this, r.pick(srcs))) return;
  }

  // ── food ────────────────────────────────────────────────────────────

  private startForage(a: Ant): boolean {
    const s = this.sim;
    if (s.isWinter) return false;
    // Aphids first when sugar is wanted: safe underground, rain or shine
    const hd = this.proteinShort && !s.weather.raining ? null : this.pickHerd();
    if (hd && (s.weather.raining || s.rng.chance(0.7))) {
      hd.visitors++;
      a.herd = hd;
      a.intent = 'toHerd';
      this.travelUnder(a, hd.access);
      return true;
    }
    if (s.weather.raining || !this.roots.length) return false;
    // Army ants coming: everyone stays in, unless the colony is starving and there's food well away from them
    const famine = this.famine;
    if (this.lockdown && (!famine || !s.danger.safe(this.mainRoot() % W))) return false;
    const site = this.pickSite();
    // Keep a few scouts out even when food is known, so new finds keep coming in; more when only sugar is known and the brood
    // needs protein, and many more when the colony is starving
    const hunt = this.proteinShort && site?.type !== 1;
    const share = famine ? 0.2 : hunt ? 0.15 : 0.05;
    const scout = !this.lockdown && this.scouts < 2 + this.workerCount * share && (!site || s.rng.chance(famine ? 0.4 : hunt ? 0.7 : 0.25));
    if (site && !scout) {
      a.food = site;
      a.intent = 'toFood';
      this.travelSurface(a, site.x);
      return true;
    }
    if (!scout) return false;
    this.scouts++;
    const dir = s.rng.chance(0.5) ? 1 : -1;
    a.intent = 'scout';
    this.travelSurface(a, clampCol((this.mainRoot() % W) + dir * s.rng.range(15, 170)));
    return true;
  }

  /** One of our aphid herds with honeydew to spare, the fullest first. */
  private pickHerd(): Herd | null {
    let best: Herd | null = null;
    let bs = 2;
    for (const hd of this.sim.eco.herds) {
      if (hd.owner !== this || hd.access < 0) continue;
      const spare = hd.honey - hd.visitors * this.species.carry * 1.5;
      if (spare > bs) {
        bs = spare;
        best = hd;
      }
    }
    return best;
  }

  /** Stroke the aphids with her antennae until they give up a drop of honeydew, and take it home in her crop. */
  private milk(a: Ant): void {
    const hd = a.herd;
    a.herd = null;
    if (hd) hd.visitors = Math.max(0, hd.visitors - 1);
    if (!hd || !a.under || a.at !== hd.access || hd.honey < 0.5) {
      a.intent = 'idle';
      return;
    }
    const take = Math.min(hd.honey, this.species.carry * 1.5);
    hd.honey -= take;
    hd.tendT = 0;
    a.load = LOAD_SUGAR;
    a.loadAmt = take;
    a.relayed = true;
    a.intent = 'carryFood';
    this.travelUnder(a, this.storeCell());
  }

  /** Claim aphid herds our tunnels pass close to, and dig over to them. */
  private checkHerds(): void {
    const s = this.sim;
    const w = this.world;
    for (const hd of s.eco.herds) {
      if (hd.owner && hd.owner !== this) continue;
      const hx = hd.cell % W;
      const hy = Math.floor(hd.cell / W);
      if (!hd.owner) {
        let near = false;
        for (let dy = -7; dy <= 7 && !near; dy++) {
          for (let dx = -7; dx <= 7; dx++) {
            const x = hx + dx;
            const y = hy + dy;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const c = idx(x, y);
            if (w.cells[c] === TUNNEL && w.dist[c] >= 0 && s.nestOwner(c) === this) {
              near = true;
              break;
            }
          }
        }
        if (!near) continue;
        hd.owner = this;
        if (this.isPlayer) s.emit('Your diggers have found root aphids! They will tunnel over and milk them for honeydew.', 'good');
      }
      hd.access = -1;
      for (let k = -1; k < 8 && hd.access < 0; k++) {
        const c = k < 0 ? hd.cell : idx(hx + DX[k], hy + DY[k]);
        if (w.cells[c] === TUNNEL && w.dist[c] >= 0) hd.access = c;
      }
      if (hd.access < 0 && (!hd.dig || hd.dig.done) && !s.isWinter) hd.dig = planReach(this, hd.cell);
    }
  }

  /** Food the colony gets through in a day, queen included. */
  get daily(): number {
    return (this.workerCount + this.soldierCount * 1.5 + this.repleteCount) * this.species.appetite + 1.5;
  }

  /** Out of food, or nearly: survival comes before everything. */
  get famine(): boolean {
    return this.hunger > 0 || this.stored < this.daily * 0.5;
  }

  private pickSite(): FoodSource | null {
    const home = this.mainRoot() % W;
    const s = this.sim;
    // Sugar runs out first and it's what keeps the workers alive: when it's nearly gone, it comes before protein
    const wantSugar = this.sugar < this.daily * 0.6;
    const wantProtein = !wantSugar && (this.proteinShort || this.protein < this.sugar * 0.4 || this.stored > this.cap * 0.95);
    // No point fetching sugar into stores that are already full of it
    const noRoom = this.stored >= this.cap * 0.97;
    let best: FoodSource | null = null;
    let bs = -Infinity;
    for (const f of this.known) {
      if (f.gone || f.amount <= 0) {
        this.known.delete(f);
        continue;
      }
      if (noRoom && f.type === 0) continue;
      // Army ants about: only food well away from the column
      if (this.lockdown && !s.danger.safe(f.x)) continue;
      // A big colony mass-recruits: a strong trail to food pulls in far more foragers than a faint one
      const scent = this.workerCount >= 100 ? this.trail[f.x] * 30 : 0;
      const fit = wantSugar ? f.type === 0 : wantProtein === (f.type === 1);
      const sc = -Math.abs(f.x - home) + Math.min(f.amount, 30) * 0.5 + (fit ? 40 : 0) + scent + this.home[f.x] * 8 + this.rng.next() * 10;
      if (sc > bs) {
        bs = sc;
        best = f;
      }
    }
    return best;
  }

  private arriveFood(a: Ant): void {
    const f = a.food;
    a.food = null;
    if (f && a.fresh) this.lastFind.set(a, f);
    if (!f || f.gone || f.amount <= 0 || a.under || Math.abs(f.x - a.at) > 3) {
      if (f && (f.gone || f.amount <= 0)) this.known.delete(f);
      a.intent = 'idle';
      return;
    }
    const take = Math.min(f.amount, this.species.carry);
    f.amount -= take;
    if (f.amount <= 0) f.gone = true;
    a.load = f.kind === 'seeds' ? LOAD_SEED : f.type === 0 ? LOAD_SUGAR : LOAD_PROTEIN;
    a.loadAmt = take;
    // Rich food the colony needs gets a strong trail; a scrap of something it has plenty of, a faint one
    const wanted = f.type === 1 ? this.proteinShort || this.protein < this.sugar : this.stored < this.cap * 0.8;
    a.trailQ = Math.min(1, f.amount / 25) * (wanted ? 1 : 0.4);
    a.intent = 'carryFood';
    a.relayed = false;
    // Sugar goes to whoever is waiting just inside; protein and seeds all the way to the store
    const relay = a.load === LOAD_SUGAR && this.vestibule.length > 0 && this.counts.none > 2;
    this.travelUnder(a, relay ? this.rng.pick(this.vestibule) : this.storeCell(a.load));
  }

  /** Tandem run: the finder goes back to her food with a follower close behind, tapping her with its antennae. */
  private tandem(a: Ant): void {
    const f = this.lastFind.get(a);
    this.lastFind.delete(a);
    if (!f || f.gone || f.amount <= 1) return;
    const b = this.receiver(a);
    if (!b) return;
    this.resetLegs(b);
    b.food = f;
    b.intent = 'tandem';
    b.wait = 0.6;
    this.travelSurface(b, f.x);
    this.tandems++;
  }

  /** An idle nestmate close by, free to take a crop-full off a forager. */
  private receiver(a: Ant): Ant | null {
    for (const b of this.ants) {
      if (b === a || b.dead || !b.under || b.caste !== 'worker' || b.intent !== 'idle' || b.task !== 'none' || b.load !== LOAD_NONE || b.carry > 0) continue;
      if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) <= 3.5) return b;
    }
    return null;
  }

  /** Trophallaxis: the forager regurgitates her crop into a nestmate's, and both pause face to face. */
  private share(a: Ant, b: Ant): void {
    this.resetLegs(b);
    b.load = LOAD_SUGAR;
    b.loadAmt = a.loadAmt;
    b.relayed = true;
    a.load = LOAD_NONE;
    a.loadAmt = 0;
    a.intent = b.intent = 'share';
    a.wait = b.wait = 1.1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    a.hx = dx / d;
    a.hy = dy / d;
    b.hx = -a.hx;
    b.hy = -a.hy;
    this.stats.shared++;
  }

  private deliverFood(a: Ant): void {
    if (!a.under) {
      a.intent = 'idle';
      return;
    }
    // A small colony recruits one at a time: the finder leads a nestmate back to her food
    if (a.fresh && a.food === null && this.workerCount < 100) this.tandem(a);
    a.fresh = false;
    if (a.load === LOAD_SUGAR && !a.relayed && this.world.room[a.at] !== ROLE_FOOD) {
      a.relayed = true;
      const b = this.receiver(a);
      if (b) this.share(a, b);
      else this.travelUnder(a, this.storeCell());
      return;
    }
    const room = Math.max(0, this.cap - this.stored);
    if (a.load === LOAD_SUGAR) this.sugar += Math.min(room, a.loadAmt);
    else if (a.load === LOAD_SEED && this.granaryChambers.length) this.seeds = Math.min(this.seedCap, this.seeds + a.loadAmt);
    else {
      // Protein goes straight to the queen and larvae, so it gets in even when sugar has filled the stores
      this.protein += a.loadAmt;
      this.sugar = Math.max(0, this.sugar - Math.max(0, this.stored - this.cap));
      this.protein = Math.min(this.protein, this.cap);
    }
    this.stats.gathered += a.loadAmt;
    a.load = LOAD_NONE;
    a.loadAmt = 0;
    a.intent = 'idle';
  }

  private storeCell(load = LOAD_SUGAR): number {
    const rooms = load === LOAD_SEED && this.granaryChambers.length ? this.granaryChambers : this.foodChambers;
    const ch = rooms.length ? this.rng.pick(rooms) : this.queenChamber;
    return ch ? this.floorCell(ch) : this.randomNestCell();
  }

  /** Start as an established nest rather than a lone queen: shaft and royal chamber dug, a workforce and some stores [v1.6]. */
  establish(workers: number, sugar: number, protein: number): boolean {
    const q = this.queen;
    if (!planFounding(this, q.at)) return false;
    const w = this.world;
    for (const p of [...this.active]) {
      for (const cell of p.cells) if (w.cells[cell] === DIRT && w.dig(cell, p.role)) this.roots.push(cell);
      this.advance(p);
    }
    w.rebuildTree();
    const ch = this.queenChamber!;
    const floor = this.floorCell(ch);
    if (floor < 0) return false;
    this.resetLegs(q);
    q.under = true;
    q.at = floor;
    q.x = this.px(true, floor);
    q.y = this.py(true, floor);
    q.intent = 'rest';
    this.settled = true;
    this.layT = 2;
    this.winters = 1;
    for (let k = 0; k < workers; k++) {
      const a = this.spawn('worker', true, this.floorCell(ch));
      a.age = this.rng.range(0, a.life * 0.5);
      a.phys = a.age / a.life;
    }
    this.sugar = sugar;
    this.protein = protein;
    return true;
  }

  /** Food it takes to see the colony through a winter, with a margin. */
  winterNeed(): number {
    const n = this.workerCount + this.soldierCount * 1.5 + this.alateCount + this.repleteCount;
    return (n * this.species.appetite + 1.5) * WINTER_EAT * SEASON_DAYS * 1.25;
  }

  private eat(dt: number): void {
    const s = this.sim;
    const n = this.workerCount + this.soldierCount * 1.5 + this.alateCount + this.repleteCount;
    const rate = ((n * this.species.appetite + (this.queenAlive ? 1.5 : 0)) / DAY) * (s.isWinter ? WINTER_EAT : 1);
    this.sugar -= rate * dt;
    if (this.sugar < 0) {
      // Burn protein when out of sugar
      this.protein += this.sugar * 0.7;
      this.sugar = 0;
      if (this.protein < 0) {
        this.protein = 0;
        this.hunger += dt;
        return;
      }
    }
    this.hunger = Math.max(0, this.hunger - dt * 3);
  }

  // ── brood ───────────────────────────────────────────────────────────

  /** The cause is only for the record: the playtest harness counts brood losses by it. */
  killBrood(b: Brood, _cause = ''): void {
    b.dead = true;
    if (b.carrier) {
      const c = b.carrier;
      c.brood = null;
      c.load = LOAD_NONE;
      if (c.intent === 'carryBrood') {
        this.resetLegs(c);
        c.intent = 'idle';
      }
      b.carrier = null;
    }
    if (b.claimed) {
      b.claimed.brood = null;
      b.claimed = null;
    }
  }

  /** An old queen slows down: after her second year she lays half again as slowly each year. */
  get queenSlowing(): number {
    const years = this.queen.age / (DAY * SEASON_DAYS * 4);
    return 1 + Math.max(0, years - 2) * 0.5;
  }

  /** Orphaned workers lay unfertilised eggs, which can only become males: a last gasp for the colony's genes [v1.6]. */
  private updateOrphans(dt: number): void {
    const s = this.sim;
    this.orphanT -= dt;
    if (this.orphanT <= 0 || s.isWinter) return;
    this.layT -= dt;
    if (this.layT > 0) return;
    this.layT = 14;
    const males = this.brood.filter((b) => b.male).length + this.ants.filter((a) => a.male).length;
    if (males >= 10 || this.workerCount < 10 || this.protein < 1 || !this.nurseryChambers.length) return;
    const cell = this.floorCell(this.rng.pick(this.nurseryChambers));
    if (cell < 0) return;
    this.protein -= 0.5;
    const r = this.rng;
    this.brood.push({
      cell, stage: 0, t: 0, caste: 'alate', carrier: null, claimed: null, wet: 0, starve: 0,
      ox: r.range(-0.35, 0.35), oy: r.range(-0.1, 0.25), dead: false, goal: null, male: true,
    });
  }

  private updateQueen(dt: number): void {
    if (this.orphaned && !this.queenAlive) {
      this.updateOrphans(dt);
      return;
    }
    if (!this.settled || !this.queenAlive) return;
    const s = this.sim;
    if (s.isWinter) return;
    this.layT -= dt;
    if (this.layT > 0) return;
    const fed = this.protein >= 0.5 && this.sugar >= 0.3;
    // Attendants feed the queen, so a big colony keeps her laying faster; protein is the real limit
    const boost = 1 + Math.min(1.5, this.workerCount / 260);
    // She lays to what the colony can feed: thin stores slow her down, and in autumn she eases off until the winter larder is full
    const daily = this.daily;
    const short = this.stored < daily * 1.5 && this.income * DAY < daily;
    let thrift = this.workerCount >= 40 && short ? 2 : 1;
    if (s.season === 2 && this.stored < this.winterNeed()) thrift *= 2;
    this.layT = this.clutch > 0 ? 1.5 : (this.species.layInterval * this.layScale * thrift * this.queenSlowing * (fed ? 1 : 4)) / boost;
    if (this.ants.length + this.brood.length >= HARD_CAP) return;
    if (this.clutch > 0) this.clutch--;
    else {
      if (!fed) return;
      this.protein -= 0.3;
      this.sugar -= 0.2;
    }
    const r = this.rng;
    let caste: Caste = 'worker';
    if (this.alateQueue > 0) {
      caste = 'alate';
      this.alateQueue--;
    } else if (this.workerCount >= 15 && r.chance(this.species.soldierShare * (this.focus === 'defend' ? 1.8 : 1))) caste = 'soldier';
    const q = this.queen;
    const cell = q.under && this.world.cells[q.at] === TUNNEL ? q.at : this.floorCell(this.queenChamber!);
    if (cell < 0) return;
    this.brood.push({
      cell, stage: 0, t: 0, caste, carrier: null, claimed: null, wet: 0, starve: 0,
      ox: r.range(-0.35, 0.35), oy: r.range(-0.1, 0.25), dead: false, goal: null,
    });
  }

  private updateBrood(dt: number): void {
    const w = this.world;
    const s = this.sim;
    const sp = this.species;
    const founding = this.workerCount < 8 && !this.nurseryChambers.length;
    let changed = false;
    for (const b of this.brood) {
      if (b.dead) {
        changed = true;
        continue;
      }
      // A raft of fire ants holds its brood up out of the water
      if (!b.carrier && w.water[b.cell] && !this.rafting) {
        b.wet += dt;
        if (b.wet > 14) {
          this.killBrood(b);
          changed = true;
          continue;
        }
      } else if (b.wet > 0) b.wet = Math.max(0, b.wet - dt);
      const dur = BROOD_TIME[b.stage] * sp.brood * (b.caste === 'soldier' ? 1.3 : b.caste === 'alate' ? 1.6 : 1);
      // Brood grows fastest at its favourite temperature and crawls along in cold soil; a founding queen broods her first clutch herself
      let k = warmth(s.tempAt(b.carrier ? b.carrier.y : b.cell / W), BROOD_BEST[b.stage]);
      if (founding) k = Math.max(k, 0.85);
      if (b.stage === 1) {
        const need = ((LARVA_PROTEIN * (b.caste === 'worker' ? 1 : 2)) / dur) * dt * k;
        if (this.protein >= need) {
          this.protein -= need;
          b.starve = 0;
        } else {
          b.starve += dt;
          if (b.starve > 50) {
            this.killBrood(b);
            changed = true;
          }
          continue;
        }
      }
      b.t += dt * k;
      if (b.t < dur) continue;
      b.t = 0;
      if (++b.stage <= 2) continue;
      // Ecloses
      let cell = b.cell;
      if (b.carrier?.under) cell = b.carrier.at;
      this.killBrood(b);
      changed = true;
      if (w.cells[cell] === TUNNEL) {
        const n = this.spawn(b.caste, true, cell);
        if (b.male) n.male = true;
        n.wait = 1;
        this.stats.born++;
      }
    }
    if (changed) this.brood = this.brood.filter((b) => !b.dead);
  }

  private needsMove(b: Brood): boolean {
    if (b.carrier || b.claimed || b.dead) return false;
    const w = this.world;
    if (w.water[b.cell]) return true;
    // Army ants coming: everything above the deepest chamber goes down into it
    if (this.evac) return w.planOwner[b.cell] !== this.evac.id + 1 && Math.floor(b.cell / W) < this.evac.ey;
    if (b.goal) return true;
    return this.nurseryChambers.length > 0 && w.room[b.cell] !== ROLE_NURSERY;
  }

  /** The nursery whose temperature suits this brood's stage best, a little less keen on crowded ones. */
  private bestNursery(b: Brood | null): Project | null {
    let best: Project | null = null;
    let bs = -Infinity;
    for (let k = 0; k < this.nurseryChambers.length; k++) {
      const p = this.nurseryChambers[k];
      const sc = (b ? warmth(this.nurseryTemp[k], BROOD_BEST[b.stage]) : 0) - (this.nurseryLoad[k] / p.cells.length) * 0.1 + this.rng.next() * 0.04;
      if (sc > bs) {
        bs = sc;
        best = p;
      }
    }
    return best;
  }

  private nurseryCell(b: Brood | null = null): number {
    if (this.evac) {
      const c = this.floorCell(this.evac);
      if (c >= 0 && !this.world.water[c]) return c;
    }
    if (this.nurseryChambers.length) {
      const goal = b?.goal ?? this.bestNursery(b);
      for (let k = 0; k < 4; k++) {
        const c = this.floorCell(k === 0 && goal ? goal : this.rng.pick(this.nurseryChambers));
        if (c >= 0 && !this.world.water[c]) return c;
      }
    }
    return this.queenChamber ? this.floorCell(this.queenChamber) : this.randomNestCell();
  }

  private startNurse(a: Ant): boolean {
    if (!a.under) return false;
    let best: Brood | null = null;
    let bd = Infinity;
    for (const b of this.brood) {
      if (!this.needsMove(b)) continue;
      const d = Math.abs((b.cell % W) + 0.5 - a.x) + Math.abs(Math.floor(b.cell / W) + 0.5 - a.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    if (!best) return false;
    best.claimed = a;
    a.brood = best;
    a.intent = 'toBrood';
    this.travelUnder(a, best.cell);
    return true;
  }

  /** Nurses with nothing to move hang around the nursery. */
  private tend(a: Ant): boolean {
    if (!this.nurseryChambers.length || !a.under) return false;
    if (this.world.room[a.at] === ROLE_NURSERY) {
      this.wanderStep(a, ROLE_NURSERY);
      a.wait = this.rng.range(0.5, 2.5);
    } else {
      a.intent = 'idle';
      this.travelUnder(a, this.nurseryCell());
    }
    return true;
  }

  private pickBrood(a: Ant): void {
    const b = a.brood;
    if (!b || b.dead || b.carrier || !a.under || a.at !== b.cell) {
      if (b && b.claimed === a) b.claimed = null;
      a.brood = null;
      a.intent = 'idle';
      return;
    }
    b.claimed = null;
    b.carrier = a;
    a.load = LOAD_BROOD;
    a.intent = 'carryBrood';
    this.travelUnder(a, this.nurseryCell(b));
  }

  private dropBrood(a: Ant): void {
    const b = a.brood;
    a.brood = null;
    a.load = LOAD_NONE;
    a.intent = 'idle';
    if (!b || b.dead) return;
    b.carrier = null;
    b.goal = null;
    b.cell = a.under ? a.at : b.cell;
    // Hauling brood about is real work
    this.sugar = Math.max(0, this.sugar - 0.02);
    b.ox = this.rng.range(-0.35, 0.35);
    b.oy = this.rng.range(-0.1, 0.25);
  }

  // ── the dead ────────────────────────────────────────────────────────

  private startClean(a: Ant): boolean {
    if (!a.under) return false;
    let best: Corpse | null = null;
    let bd = Infinity;
    for (const c of this.sim.corpses) {
      if (c.gone || c.claimed || c.nest !== this) continue;
      const d = Math.abs((c.at % W) + 0.5 - a.x) + Math.abs(Math.floor(c.at / W) + 0.5 - a.y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (!best) return false;
    best.claimed = a;
    a.corpse = best;
    a.intent = 'toCorpse';
    this.travelUnder(a, best.at);
    return true;
  }

  private pickCorpse(a: Ant): void {
    const c = a.corpse;
    a.corpse = null;
    if (!c || c.gone || !a.under || a.at !== c.at) {
      if (c && c.claimed === a) c.claimed = null;
      a.intent = 'idle';
      return;
    }
    c.gone = true;
    a.load = LOAD_CORPSE;
    this.carryCorpseAway(a);
  }

  private carryCorpseAway(a: Ant): void {
    if (this.middenChambers.length) {
      a.intent = 'carryCorpse';
      this.travelUnder(a, this.floorCell(this.rng.pick(this.middenChambers)));
    } else {
      a.intent = 'dump';
      this.travelSurface(a, this.dumpCol(a));
    }
  }

  private dropCorpse(a: Ant): void {
    if (a.under && this.world.room[a.at] === ROLE_MIDDEN) {
      this.midden++;
      a.load = LOAD_NONE;
      a.intent = 'idle';
      return;
    }
    a.intent = 'dump';
    this.travelSurface(a, this.dumpCol(a));
  }

  // ── defence and war ─────────────────────────────────────────────────

  private findThreat(): Threat | null {
    const s = this.sim;
    if (!this.settled || !this.roots.length) return null;
    const home = this.mainRoot() % W;
    let best: Threat | null = null;
    let bd = Infinity;
    for (const c of s.colonies) {
      if (c === this || this.friendly(c)) continue;
      const theirs = c.roots.length ? c.mainRoot() % W : -1;
      for (const a of c.ants) {
        if (a.dead || a.intent === 'fly') continue;
        if (a.under) {
          if (s.nestOwner(a.at) === this) return { under: true, at: a.at, x: a.x };
          continue;
        }
        // Near the nest, or anywhere in our scent-marked home range, but not on their own doorstep:
        // marching guards one by one onto another colony's turf just feeds them to it
        const d = Math.abs(a.x - home);
        if (theirs >= 0 && Math.abs(a.x - theirs) < d) continue;
        if ((d < 45 || this.home[clampCol(a.x)] > 0.6) && d < bd) {
          bd = d;
          best = { under: false, at: a.at, x: a.x };
        }
      }
    }
    for (const cr of s.eco.critters) {
      if (cr.dead || cr.leaving) continue;
      const d = Math.abs(cr.x - home);
      const range = cr.kind === 'spider' ? 60 : this.workerCount >= 15 ? 35 : 0;
      if (d < range && d < bd) {
        bd = d;
        best = { under: false, at: clampCol(cr.x), x: cr.x };
      }
    }
    return best;
  }

  /** Army ants on the way: call everyone in, and carry the brood down to the deepest chamber [v1.7]. */
  private prepareForArmy(): void {
    this.lockdown = this.sim.danger.threatens(this);
    this.evac = null;
    if (!this.lockdown) return;
    for (const p of this.projects) {
      if (p.kind !== 'chamber' || p.cursor < p.cells.length * 0.4 || p.role === ROLE_MIDDEN) continue;
      if (!this.evac || p.ey > this.evac.ey) this.evac = p;
    }
    for (const a of this.ants) {
      if (a.dead || a.under || a.caste === 'queen' || a.caste === 'alate') continue;
      if (a.intent === 'fight' || a.intent === 'fly' || a.intent === 'trapped' || a.intent === 'raft' || a.intent === 'home' || a.intent === 'carryFood') continue;
      // A starving colony's foragers keep going to food well away from the column
      if (a.intent === 'toFood' && a.food && this.famine && this.sim.danger.safe(a.food.x)) continue;
      // Already on the way in
      if (a.legs.length && a.legs[a.legs.length - 1].under) continue;
      this.interrupt(a);
      this.leaveJob(a);
      if (a.load === LOAD_CORPSE) this.dropLoad(a);
      a.intent = 'home';
      this.travelUnder(a, this.randomNestCell());
    }
  }

  /** Fire ants caught by a flood link legs into a living raft and float the queen to high ground [v1.7]. */
  private checkRaft(): void {
    if (!this.species.rafts || !this.settled || !this.queenAlive) return;
    const s = this.sim;
    const w = this.world;
    const q = this.queen;
    if (!this.rafting) {
      let wetBrood = 0;
      for (const b of this.brood) if (!b.dead && !b.carrier && w.water[b.cell]) wetBrood++;
      if (!(q.under && w.water[q.at]) && wetBrood < 6) return;
      this.rafting = true;
      this.raftT = 0;
      const root = this.mainRoot();
      this.raftX = highGround(s, root >= 0 ? root % W : clampCol(q.x), 25);
      for (const a of this.ants) {
        if (a.dead || !a.under || a.caste === 'alate' || a.load === LOAD_BROOD) continue;
        // The queen and every ant caught in the water float up together
        if (a !== q && !w.water[a.at]) continue;
        this.interrupt(a);
        this.leaveJob(a);
        a.intent = 'raft';
        this.travelSurface(a, clampCol(this.raftX + this.rng.range(-1.5, 1.5)));
      }
      this.stats.rafts++;
      if (this.isPlayer) {
        s.emit('The nest is flooding! The fire ants link legs into a living raft and float the queen to high ground.', 'info');
        s.milestone('raft');
      }
      return;
    }
    this.raftT++;
    const qc = this.queenChamber;
    const wet = qc ? qc.cells.some((c) => w.water[c]) : false;
    if (this.raftT < 20 || wet || s.weather.raining) return;
    // The water has gone down: back into the nest
    this.rafting = false;
    for (const a of this.ants) {
      if (a.dead || a.intent !== 'raft') continue;
      this.resetLegs(a);
      a.wait = 0;
      if (a === q && qc) {
        a.intent = 'rest';
        this.travelUnder(a, this.floorCell(qc));
      } else a.intent = 'home';
    }
  }

  /** Alarm pheromone: nestmates close to a fresh alarm drop what they're doing and run to it. */
  private answerAlarms(): void {
    const s = this.sim;
    // A young colony can't spare workers for a brawl: only the ants already there fight
    const spare = Math.floor((this.workerCount + this.soldierCount) * 0.12);
    for (const al of s.alarms) {
      if (al.colony !== this || al.answered) continue;
      al.answered = true;
      if (this.lockdown && !al.under) continue;
      // ...unless it's in the nest itself, where everyone turns out for the brood
      const inside = al.under && s.nestOwner(al.at) === this;
      if (spare < 3 && !inside) continue;
      // Out on the surface they only turn out to defend their own patch near the nest
      if (!al.under && this.roots.length && Math.abs(al.x - (this.mainRoot() % W)) > 45 && this.home[clampCol(al.x)] < 0.5) continue;
      let n = inside ? 3 + al.power * 2 : Math.min(spare, 2 + al.power);
      for (const a of this.ants) {
        if (n <= 0) break;
        if (a.dead || a.under !== al.under || a.caste === 'queen' || a.caste === 'alate' || a.caste === 'replete' || a.task === 'raid') continue;
        if (a.intent === 'fight' || a.load === LOAD_BROOD || (a.caste === 'worker' && a.load !== LOAD_NONE)) continue;
        const d = al.under ? Math.abs(a.x - al.x) + Math.abs(a.y - al.y) : Math.abs(a.x - al.x);
        if (d > (al.under ? 10 : 16) || d < 1) continue;
        this.interrupt(a);
        this.leaveJob(a);
        a.intent = 'toThreat';
        if (al.under) this.travelUnder(a, al.at);
        else this.travelSurface(a, clampCol(al.x));
        n--;
      }
    }
  }

  /** A new threat: interrupt guards (and some workers if the nest itself is breached). */
  private mobilize(): void {
    const t = this.threat!;
    if (t.under && this.isPlayer) this.sim.emit('Enemy ants have broken into the nest!', 'bad');
    const calm = (a: Ant): boolean => a.intent === 'idle' || a.intent === 'patrol' || a.intent === 'home';
    for (const a of this.ants) {
      if (a.dead || a.caste === 'queen' || a.caste === 'alate' || a.caste === 'replete' || a.task === 'raid') continue;
      if (a.caste === 'soldier' || a.task === 'guard') {
        if (calm(a)) this.interrupt(a);
      } else if (t.under && a.load !== LOAD_BROOD && this.rng.chance(0.55)) {
        this.interrupt(a);
        this.leaveJob(a);
        a.task = 'guard';
        a.taskT = 30;
        a.intent = 'idle';
      }
    }
  }

  private guard(a: Ant): boolean {
    const t = this.threat;
    const s = this.sim;
    if (t) {
      a.intent = 'toThreat';
      if (t.under) this.travelUnder(a, t.at);
      else this.travelSurface(a, clampCol(t.x));
      return true;
    }
    if (a.caste !== 'soldier' && this.focus !== 'defend') return false;
    const root = this.mainRoot();
    if (root < 0) return false;
    if (s.rng.chance(0.35) && !s.weather.raining && !s.isWinter && !this.lockdown) {
      a.intent = 'patrol';
      this.travelSurface(a, clampCol((root % W) + s.rng.range(-22, 22)));
      return true;
    }
    const shaft = this.projects[0];
    if (!shaft) return false;
    const c = s.rng.pick(shaft.spine);
    if (this.world.cells[c] !== TUNNEL || this.world.dist[c] < 0) return false;
    a.intent = 'idle';
    this.travelUnder(a, c);
    a.wait = s.rng.range(1, 4);
    return true;
  }

  canRaid(target: Colony | null): boolean {
    return !!target && !this.raid && target.queenAlive && this.queenAlive && this.settled && this.workerCount + this.soldierCount >= 10 && !this.sim.weather.raining;
  }

  launchRaid(target: Colony): boolean {
    if (!this.canRaid(target) || !target.roots.length) return false;
    const pool = this.ants.filter((a) => !a.dead && (a.caste === 'soldier' || a.caste === 'worker') && a.load !== LOAD_BROOD);
    pool.sort((a, b) => (a.caste === 'soldier' ? 0 : 1) - (b.caste === 'soldier' ? 0 : 1) || this.rng.next() - 0.5);
    const size = Math.min(pool.length, 140, Math.max(8, Math.round(this.soldierCount + this.workerCount * 0.3)));
    for (let k = 0; k < size; k++) {
      const a = pool[k];
      this.interrupt(a);
      this.leaveJob(a);
      a.task = 'raid';
      a.taskT = 999;
      a.intent = 'idle';
    }
    const home = this.mainRoot() % W;
    const there = target.mainRoot() % W;
    this.raid = { target, phase: 'gather', t: 0, start: this.sim.time, rally: clampCol(home + Math.sign(there - home) * 9), size };
    return true;
  }

  endRaid(): void {
    for (const a of this.ants) {
      if (a.task !== 'raid') continue;
      a.task = 'none';
      a.taskT = 0;
      if (a.intent !== 'fight') {
        this.resetLegs(a);
        a.intent = 'home';
      }
    }
    this.raid = null;
  }

  private updateRaid(): void {
    const r = this.raid!;
    r.t = this.sim.time - r.start;
    let alive = 0;
    for (const a of this.ants) if (a.task === 'raid') alive++;
    if (r.phase === 'gather' && r.t >= 25) {
      r.phase = 'march';
      for (const a of this.ants) if (a.task === 'raid' && a.intent !== 'fight') this.interrupt(a);
    }
    // Nobody fights on in a downpour, with the tunnels filling up
    const washout = this.sim.weather.intensity > 0.5;
    if (!r.target.queenAlive || alive < r.size * 0.35 || r.t > 170 || washout) {
      const won = !r.target.queenAlive;
      this.endRaid();
      if (this.isPlayer) this.sim.emit(won ? 'The raiders are coming home victorious.' : washout ? 'The rain has washed out the raid. The raiders are heading home.' : 'The raid has failed. Survivors are retreating.', won ? 'good' : 'bad');
      else if (this.sim.player?.queenAlive) this.sim.emit('The enemy raid has been beaten back!', 'good');
    }
  }

  private raidIdle(a: Ant): void {
    const r = this.raid;
    if (!r) {
      a.task = 'none';
      a.intent = 'home';
      return;
    }
    a.intent = 'toThreat';
    if (r.phase === 'gather') {
      this.travelSurface(a, clampCol(r.rally + this.rng.range(-3, 3)));
      a.wait = this.rng.range(0.5, 1.5);
      return;
    }
    const q = r.target.queen;
    if (q.under) this.travelUnder(a, q.at);
    else this.travelSurface(a, clampCol(q.x));
  }

  // ── repletes ────────────────────────────────────────────────────────

  /** A replete hangs from a food store's ceiling and stays put. */
  private repleteIdle(a: Ant): void {
    const w = this.world;
    if (a.under && w.room[a.at] === ROLE_FOOD && w.cells[a.at - W] !== TUNNEL) {
      a.intent = 'hang';
      a.wait = this.rng.range(15, 30);
      return;
    }
    a.intent = 'idle';
    const c = this.ceilingCell();
    if (c >= 0) this.travelUnder(a, c);
    else a.wait = 2;
  }

  /** A food store cell with solid soil above, to hang from. */
  private ceilingCell(): number {
    const w = this.world;
    for (let k = 0; k < 20 && this.foodChambers.length; k++) {
      const c = this.rng.pick(this.rng.pick(this.foodChambers).cells);
      if (w.cells[c] === TUNNEL && w.dist[c] >= 0 && w.cells[c - W] !== TUNNEL && !w.water[c]) return c;
    }
    return -1;
  }

  /** When the stores brim with sugar, a young honeypot worker swells into a replete to hold more. */
  private makeRepletes(): void {
    if (!this.species.repletes || this.sim.isWinter || !this.foodChambers.length || this.sugar < this.cap * 0.7) return;
    let room = 0;
    for (const p of this.foodChambers) room += p.cells.length / 4;
    if (this.repleteCount >= room) return;
    const a = this.ants.find((b) => b.caste === 'worker' && b.under && b.phys < 0.3 && b.task === 'none' && b.load === LOAD_NONE && !b.dead);
    if (!a) return;
    this.interrupt(a);
    this.leaveJob(a);
    a.caste = 'replete';
    a.maxHp = a.hp = this.species.hp * CASTE_HP.replete;
    a.atk = this.species.atk * CASTE_ATK.replete;
    a.life *= 2;
    a.intent = 'idle';
    this.repleteCount++;
    if (this.isPlayer && this.repleteCount === 1) this.sim.emit('A worker has swollen into a replete, a living honey jar. She will hang in the food store.', 'good');
  }

  // ── alates ──────────────────────────────────────────────────────────

  private alateIdle(a: Ant): void {
    // Knocked off course during the flight (a fight, a spider): set off again
    if (this.flying) {
      a.intent = 'toFlight';
      this.travelSurface(a, clampCol((this.mainRoot() % W) + this.rng.range(-6, 6)));
      return;
    }
    if (!a.under) {
      a.intent = 'home';
      return;
    }
    this.wanderStep(a, -1);
    a.wait = this.rng.range(1, 3);
  }

  private checkAlates(): void {
    const s = this.sim;
    const orphan = this.orphaned && !this.queenAlive;
    if ((!this.queenAlive && !orphan) || !this.settled) return;
    const year = Math.floor(s.day / (SEASON_DAYS * 4));
    if (this.flying) {
      if (this.alateCount === 0) {
        this.flying = false;
        this.flownYear = year;
        if (orphan) {
          // The last of the colony's strength went into them: no more eggs
          this.orphanT = 0;
          if (this.isPlayer) {
            s.emit('Her sons have flown. The queen is gone, but her line carries on in them.', 'good');
            s.onSonsFlown();
          }
        } else s.onFlight(this);
      }
      return;
    }
    if (this.flownYear === year && !orphan) return;
    const alateBrood = this.brood.some((b) => b.caste === 'alate');
    if (!orphan && s.season === 1 && this.winters >= 1 && this.alateQueue === 0 && this.alateCount === 0 && !alateBrood && this.pop >= 250) {
      this.alateQueue = 16;
      if (this.isPlayer) s.emit('The colony is raising winged queens and males for a nuptial flight.', 'good');
    }
    const ready = this.alateCount > 0 && this.alateQueue === 0 && !alateBrood && !s.isWinter && this.roots.length > 0;
    if (!ready) {
      this.alateWait = 0;
      return;
    }
    // They wait for a warm, humid, still day after rain; after a long wait any fair day will do
    this.alateWait++;
    if (this.alateWait === 1 && this.isPlayer && !orphan && !s.flightWeather) s.emit('The winged ants are ready. They are waiting for a warm, still day just after rain.', 'info');
    const fair = s.darkness < 0.05 && !s.weather.raining;
    // Orphans can't wait for the weather: the workers are dying
    if (fair && (s.flightWeather || this.alateWait > (orphan ? DAY * 0.25 : DAY * 1.2))) {
      this.flying = true;
      for (const a of this.ants) {
        if (a.caste !== 'alate' || a.dead) continue;
        this.interrupt(a);
        a.intent = 'toFlight';
        this.travelSurface(a, clampCol((this.mainRoot() % W) + this.rng.range(-6, 6)));
      }
      if (this.isPlayer) s.emit(s.flightWeather ? 'Warm and humid after the rain: perfect flying weather. Winged ants are pouring out of the nest!' : 'Nuptial flight! Winged ants are pouring out of the nest.', 'good');
    }
  }

  // ── bookkeeping ─────────────────────────────────────────────────────

  private rebalance(): void {
    const s = this.sim;
    const w = this.world;
    for (const t in this.counts) this.counts[t as Task] = 0;
    let workers = 0;
    let soldiers = 0;
    let alates = 0;
    let repletes = 0;
    let scouts = 0;
    this.cropSugar = 0;
    this.waiting = 0;
    this.income = this.income * 0.98 + (this.stats.gathered - this.lastGathered) * 0.02;
    this.lastGathered = this.stats.gathered;
    for (const k of this.lastFind.keys()) if (k.dead || k.load === LOAD_NONE) this.lastFind.delete(k);
    for (const a of this.ants) {
      if (a.dead) continue;
      if (a.load === LOAD_SUGAR && a.under) this.cropSugar += a.loadAmt;
      if (a.under && a.intent === 'idle' && a.task === 'none' && w.dist[a.at] >= 0 && w.dist[a.at] <= 14) this.waiting++;
      if (a.caste === 'worker') workers++;
      else if (a.caste === 'soldier') soldiers++;
      else if (a.caste === 'alate') alates++;
      else if (a.caste === 'replete') repletes++;
      this.counts[a.task]++;
      if (a.intent === 'scout') scouts++;
    }
    this.workerCount = workers;
    this.soldierCount = soldiers;
    this.alateCount = alates;
    this.repleteCount = repletes;
    this.scouts = scouts;
    this.stats.peak = Math.max(this.stats.peak, this.pop);

    this.foodChambers = [];
    this.nurseryChambers = [];
    this.middenChambers = [];
    this.granaryChambers = [];
    let storeCells = 0;
    let seedCells = 0;
    for (const p of this.projects) {
      if (p.kind !== 'chamber' || p.cursor === 0) continue;
      if (p.role === ROLE_FOOD) {
        this.foodChambers.push(p);
        for (const c of p.cells) if (w.cells[c] === TUNNEL) storeCells++;
      } else if (p.role === ROLE_NURSERY && p.cursor > p.cells.length * 0.4) this.nurseryChambers.push(p);
      else if (p.role === ROLE_MIDDEN) this.middenChambers.push(p);
      else if (p.role === ROLE_GRANARY) {
        this.granaryChambers.push(p);
        for (const c of p.cells) if (w.cells[c] === TUNNEL) seedCells++;
      }
    }
    this.cap = 50 + storeCells * 5 + this.repleteCount * REPLETE_CAP;
    this.makeRepletes();
    this.seedCap = seedCells * 6;
    this.seeds = Math.min(this.seeds, this.seedCap);
    // Majors with big heads mill seeds into food; workers manage a little; nobody bothers while protein is plentiful
    if (this.seeds > 0 && this.protein < this.cap * 0.5) {
      const k = Math.min(this.seeds, this.soldierCount * (this.species.id === 'pheidole' ? 0.12 : 0.04) + this.workerCount * 0.004);
      this.seeds -= k;
      this.protein += k;
    }
    if (this.stored > this.cap) {
      // Sugar spills first; protein is what the brood can't do without
      this.sugar = Math.max(0, this.cap - this.protein);
      this.protein = Math.min(this.protein, this.cap);
    }
    this.digSlots = 0;
    for (const p of this.active) if (!p.queenOnly) this.digSlots += p.maxWorkers;
    const shaft = this.projects[0];
    this.vestibule = shaft ? shaft.spine.filter((c) => w.cells[c] === TUNNEL && w.dist[c] >= 3 && w.dist[c] <= 12) : [];
    // Nurses chase warmth: brood that would grow noticeably faster in another nursery wants moving there
    this.nurseryTemp = this.nurseryChambers.map((p) => s.tempAt(p.ey));
    this.nurseryLoad = this.nurseryChambers.map(() => 0);
    const nurseryIdx = new Map(this.nurseryChambers.map((p, k) => [p.id + 1, k]));
    for (const b of this.brood) {
      const k = nurseryIdx.get(w.planOwner[b.cell]);
      if (k !== undefined) this.nurseryLoad[k]++;
    }
    this.broodToMove = 0;
    let warm = 0;
    for (const b of this.brood) {
      const here = warmth(s.tempAt(b.cell / W), BROOD_BEST[b.stage]);
      warm += here;
      b.goal = null;
      if (!b.carrier && this.nurseryChambers.length > 1) {
        const p = this.bestNursery(b);
        if (p && warmth(this.nurseryTemp[this.nurseryChambers.indexOf(p)], BROOD_BEST[b.stage]) > here + 0.12) b.goal = p;
      }
      if (this.needsMove(b)) this.broodToMove++;
    }
    this.broodWarmth = this.brood.length ? warm / this.brood.length : 0;
    this.corpsesPending = 0;
    for (const c of s.corpses) if (c.nest === this && !c.claimed && !c.gone) this.corpsesPending++;

    const prev = this.threat;
    this.threat = this.findThreat();
    if (this.threat && (!prev || (this.threat.under && !prev.under))) this.mobilize();

    if (this.hunger > 20 && this.ants.length) {
      // Ants last a while on an empty crop: the losses build slowly, which leaves the keeper time to help
      const n = Math.floor(this.ants.length * 0.004 * Math.min(2.5, this.hunger / 80)) + (this.rng.chance(0.25) ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const a = this.rng.pick(this.ants);
        if (a !== this.queen && !a.dead) this.die(a, 'starvation');
      }
      if (this.hunger > DAY * 1.2 && this.queenAlive) this.die(this.queen, 'starvation');
      if (this.isPlayer && !this.starveWarned) {
        this.starveWarned = true;
        s.emit('Your colony is starving! Drop some sugar or let them forage.', 'bad');
      }
    } else if (this.hunger === 0) this.starveWarned = false;

    this.answerAlarms();
    this.prepareForArmy();
    this.checkRaft();
    this.checkHerds();
    this.updateWants();
    if (this.raid) this.updateRaid();
    this.checkAlates();
    if (!this.isPlayer) this.focus = this.threat ? 'defend' : this.stored < this.cap * 0.25 ? 'forage' : 'balanced';
  }
}

function span(a: number, b: number): number[] {
  const out: number[] = [];
  const s = b >= a ? 1 : -1;
  for (let x = a; x !== b + s; x += s) out.push(x);
  return out;
}

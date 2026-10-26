import { W, DAY, SEASON_DAYS, clampCol } from './config';
import type { Sim } from './sim';
import type { Colony } from './colony';
import type { Ant } from './ant';

/** An antlion's sand pit. Ants that blunder in slide down to its jaws unless a nestmate pulls them out [v1.7]. */
export interface Pit {
  x: number;
  /** Seconds until the antlion is hungry again after a meal. */
  sated: number;
  caught: number;
  /** The ant struggling in the pit right now. */
  victim: Ant | null;
}

/**
 * A raiding column of army ants sweeping across the meadow. It eats whatever it
 * catches on the surface, and pours into any open entrance it crosses to carry off
 * the brood near the top of the nest. A pebble in the entrance turns it away.
 */
export interface Swarm {
  /** The front of the column. */
  x: number;
  dir: number;
  len: number;
  /** The nest it is raiding, and seconds left before it moves on. */
  raiding: Colony | null;
  stall: number;
  root: number;
  /** Rows below the entrance the raiders have got to. */
  reach: number;
  /** Player brood taken and ants killed, for the report when it leaves. */
  took: number;
  killed: number;
  /** Entrances already raided or turned away. */
  passed: number[];
}

/** How fast the column moves, in cells a second. */
const SWARM_SPEED = 1.5;
/** How deep the raiders get below an entrance. Brood deeper than this is safe. */
export const SWARM_REACH = 20;
const SWARM_RAID = 24;
/** How long an ant struggles in a pit before the antlion wins. */
const TRAP_TIME = 7;

/** Antlion pits and the army ant swarm: the dangers that aren't single creatures. */
export class Dangers {
  pits: Pit[] = [];
  /** Pit index per surface column, -1 if none. */
  readonly pitCol = new Int16Array(W).fill(-1);
  swarm: Swarm | null = null;
  armyYear = -1;
  private tick = 0;

  constructor(private readonly sim: Sim) {}

  /** A few pits in open, sunny ground away from trees. */
  generate(n: number): void {
    const s = this.sim;
    const r = s.rng;
    for (let k = 0; k < 200 && this.pits.length < n; k++) {
      const x = r.int(14, W - 15);
      if (this.pits.some((p) => Math.abs(p.x - x) < (n > 4 ? 18 : 30))) continue;
      if (s.world.logs.some(([a, b]) => x > a - 4 && x < b + 4)) continue;
      if (s.eco.plants.some((p) => p.kind !== 'flower' && Math.abs(p.x - x) < (p.kind === 'tree' || p.kind === 'wood' ? 9 : 4))) continue;
      this.pits.push({ x, sated: 0, caught: 0, victim: null });
    }
    this.indexPits();
  }

  indexPits(): void {
    this.pitCol.fill(-1);
    this.pits.forEach((p, k) => {
      this.pitCol[p.x] = k;
    });
  }

  /** An ant steps into a pit. Returns true if she's caught. */
  trap(a: Ant, k: number): boolean {
    const p = this.pits[k];
    if (!p || p.sated > 0 || p.victim) return false;
    const c = a.colony;
    // A forager watching her step mostly gets round the rim, a loaded one slips more easily, and once a nestmate
    // has fallen in the colony knows to go round
    if (!this.sim.rng.chance(c.knownPits.has(p.x) ? 0.01 : a.load ? 0.2 : 0.1)) return false;
    c.knownPits.add(p.x);
    c.interrupt(a);
    if (a.load) c.dropLoad(a);
    a.intent = 'trapped';
    a.wait = TRAP_TIME;
    a.x = p.x + 0.5;
    p.victim = a;
    // Her struggling and alarm scent bring nestmates to pull her out
    this.sim.alarm(a);
    if (c.isPlayer && c.stats.trapped++ === 0) this.sim.emit('An ant has slid into an antlion pit! Nestmates nearby will try to pull her out.', 'bad');
    return true;
  }

  /** The struggle is over: a nestmate pulls her free, she scrambles out, or the antlion drags her under. */
  endTrap(a: Ant): void {
    const s = this.sim;
    const c = a.colony;
    const p = this.pits.find((q) => q.victim === a);
    if (p) p.victim = null;
    const helper = c.ants.some((b) => b !== a && !b.dead && !b.under && b.intent !== 'trapped' && b.caste !== 'alate' && Math.abs(b.x - a.x) < 2.2);
    if (helper ? s.rng.chance(0.85) : s.rng.chance(0.2)) {
      a.intent = 'idle';
      if (helper) {
        c.stats.rescued++;
        if (c.isPlayer) s.milestone('rescue');
      }
      return;
    }
    if (p) {
      p.caught++;
      p.sated = 150;
    }
    c.die(a, 'caught by an antlion');
  }

  everySecond(): void {
    const s = this.sim;
    for (const p of this.pits) {
      if (p.sated > 0) p.sated = Math.max(0, p.sated - 1);
      // A spider or the swarm got to her first
      if (p.victim && (p.victim.dead || p.victim.intent !== 'trapped')) p.victim = null;
    }
    // Digging fills a pit in: no antlion keeps a pit on top of a nest entrance
    const before = this.pits.length;
    this.pits = this.pits.filter((p) => p.victim || !s.colonies.some((c) => c.roots.some((r) => Math.abs((r % W) - p.x) < 4)));
    if (this.pits.length !== before) this.indexPits();

    // Army ants come through once in a summer, when there's a colony worth raiding
    const p = s.player;
    const year = Math.floor(s.day / (SEASON_DAYS * 4));
    if (!this.swarm && p && p.queenAlive && s.season === 1 && year > this.armyYear && p.pop >= 80 && s.rng.chance(1 / (DAY * 2))) {
      this.armyYear = year;
      const dir = s.rng.chance(0.5) ? 1 : -1;
      this.swarm = { x: dir > 0 ? -70 : W + 70, dir, len: 32, raiding: null, stall: 0, root: -1, reach: 0, took: 0, killed: 0, passed: [] };
      s.emit(`Army ants! A raiding column is sweeping in from the ${dir > 0 ? 'west' : 'east'}. Pebbles (U) keep them out of an entrance; brood deep in the nest is safe.`, 'bad', 'raid');
    }
  }

  /** Sandbox: a column sets off now, from the side away from the player's nest. */
  summon(): boolean {
    const s = this.sim;
    if (this.swarm) return false;
    const home = s.player?.roots.length ? s.player.mainRoot() % W : W / 2;
    const dir = home > W / 2 ? 1 : -1;
    this.swarm = { x: dir > 0 ? -70 : W + 70, dir, len: 32, raiding: null, stall: 0, root: -1, reach: 0, took: 0, killed: 0, passed: [] };
    s.emit(`Army ants! A raiding column is sweeping in from the ${dir > 0 ? 'west' : 'east'}.`, 'bad', 'raid');
    return true;
  }

  update(dt: number): void {
    const sw = this.swarm;
    if (!sw) return;
    if (sw.raiding) {
      this.raid(sw, dt);
      return;
    }
    sw.x += sw.dir * SWARM_SPEED * dt;
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 0.5;
    const s = this.sim;
    const lo = Math.min(sw.x, sw.x - sw.dir * sw.len);
    const hi = Math.max(sw.x, sw.x - sw.dir * sw.len);
    for (const c of s.colonies) {
      for (const a of c.ants) {
        if (a.dead || a.under || a.intent === 'fly' || a.x < lo || a.x > hi) continue;
        if (a.caste === 'queen') {
          // Her guard closes round her: she's stung, but a column passing over won't finish her
          a.hp -= 0.6;
          if (a.hp <= 0) c.die(a, 'swarmed by army ants');
          continue;
        }
        if (!s.rng.chance(0.12)) continue;
        if (c.isPlayer) sw.killed++;
        c.die(a, 'swarmed by army ants');
      }
    }
    for (const c of s.eco.critters) {
      if (c.dead || c.under || c.x < lo || c.x > hi) continue;
      if (c.kind === 'bird') c.leaving = true;
      else if (c.alt === 0) c.dead = true;
    }
    for (const f of s.eco.food) {
      if (f.gone || f.x < lo || f.x > hi) continue;
      f.amount -= 5;
      if (f.amount <= 0) f.gone = true;
    }
    // Any open entrance under the column: in they go
    for (const c of s.colonies) {
      for (const root of c.roots) {
        const rx = root % W;
        if (rx < lo || rx > hi || sw.passed.includes(root)) continue;
        sw.passed.push(root);
        if (s.isPlugged(root)) {
          if (c.isPlayer) s.emit('The pebble held: the army ants flowed past the plugged entrance.', 'good');
          continue;
        }
        sw.raiding = c;
        sw.root = root;
        sw.stall = SWARM_RAID;
        sw.reach = 0;
        if (c.isPlayer) s.emit('Army ants are pouring into the nest! They will carry off any brood near the top.', 'bad', 'raid');
        return;
      }
    }
    if ((sw.dir > 0 && sw.x - sw.len > W + 4) || (sw.dir < 0 && sw.x + sw.len < -4)) {
      this.swarm = null;
      const p = s.player;
      if (p?.queenAlive) {
        const lost = sw.took + sw.killed;
        s.emit(lost ? `The army ants have moved on. They took ${sw.took} brood and ${sw.killed} ants.` : 'The army ants have moved on, and the colony lost nothing.', lost ? 'info' : 'good');
        if (sw.took === 0) s.milestone('army');
      }
    }
  }

  /** Raiders work their way down from the entrance, taking brood and stinging any ant in the way. */
  private raid(sw: Swarm, dt: number): void {
    const s = this.sim;
    const c = sw.raiding!;
    sw.stall -= dt;
    sw.reach = Math.min(SWARM_REACH, sw.reach + dt * 1.4);
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.5;
      const rx = sw.root % W;
      const floor = s.world.top[rx] + sw.reach;
      for (const b of c.brood) {
        if (b.dead) continue;
        const x = b.carrier ? b.carrier.x : (b.cell % W) + 0.5;
        const y = b.carrier ? b.carrier.y : Math.floor(b.cell / W);
        if (y > floor || Math.abs(x - rx) > 32 || !s.rng.chance(0.25)) continue;
        if (c.isPlayer) sw.took++;
        c.killBrood(b, 'army');
      }
      // Workers mostly flee deeper with what they can carry; soldiers stand and fight, and wear the raiders down
      let fighters = 0;
      for (const a of c.ants) {
        if (a.dead || !a.under || a.y > floor || Math.abs(a.x - rx) > 32) continue;
        if (a.caste === 'soldier') fighters++;
        if (a.caste === 'queen') {
          // She's mobbed but her attendants shield her; it takes a long raid to kill her
          a.hp -= 0.25;
          if (a.hp <= 0) c.die(a, 'killed by army ants');
          continue;
        }
        if (!s.rng.chance(a.caste === 'soldier' ? 0.012 : 0.006)) continue;
        if (c.isPlayer) sw.killed++;
        c.die(a, 'killed by army ants');
      }
      sw.stall -= Math.min(4, fighters * 0.05);
    }
    if (sw.stall <= 0 || !c.alive) {
      sw.raiding = null;
      if (c.isPlayer && c.queenAlive) s.emit(sw.took ? `The army ants pull out of the nest with ${sw.took} brood.` : 'The army ants pull out of the nest empty-handed.', sw.took ? 'bad' : 'good');
    }
  }

  /** Is the swarm heading for this colony, close enough that it should get ready? */
  threatens(c: Colony): boolean {
    const sw = this.swarm;
    if (!sw) return false;
    if (sw.raiding === c) return true;
    // Coming this way, or still too close behind having passed
    return c.roots.some((r) => {
      const ahead = ((r % W) - sw.x) * sw.dir;
      return (ahead > -2 && ahead < 110 && !sw.passed.includes(r)) || this.near(r % W, 50);
    });
  }

  /** Can a forager get to this column and back before the column gets there? */
  safe(x: number): boolean {
    const sw = this.swarm;
    if (!sw) return true;
    const ahead = (x - sw.x) * sw.dir;
    return !this.near(x, 40) && !(ahead > 0 && ahead < 120);
  }

  /** Is this column under the swarm right now (so surface ants should keep away)? */
  near(x: number, margin: number): boolean {
    const sw = this.swarm;
    if (!sw) return false;
    const lo = Math.min(sw.x, sw.x - sw.dir * sw.len) - margin;
    const hi = Math.max(sw.x, sw.x - sw.dir * sw.len) + margin;
    return x >= lo && x <= hi;
  }
}

/** Highest ground near a column, where a raft of fire ants can sit out a flood. */
export function highGround(sim: Sim, col: number, span: number): number {
  const w = sim.world;
  let best = clampCol(col);
  for (let x = Math.max(2, col - span); x <= Math.min(W - 3, col + span); x++) if (w.top[x] < w.top[best] || (w.top[x] === w.top[best] && Math.abs(x - col) < Math.abs(best - col))) best = x;
  return best;
}

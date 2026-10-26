import { W, H, DX, DY, idx } from './config';
import { CRITTER_INFO, type Critter } from './ecology';
import type { Sim } from './sim';
import type { Ant } from './ant';

const STEP = 0.1;
/** Only so many ants can get at one enemy; the queen is crowded by her attendants. */
const maxBeset = (a: Ant): number => (a.caste === 'queen' ? 2 : 4);

/**
 * Fights between colonies and with critters. Ants are bucketed by tunnel cell
 * (underground) or column (surface); anything touching an enemy locks into a fight.
 */
export class Combat {
  private readonly headU = new Int32Array(W * H).fill(-1);
  private readonly headS = new Int32Array(W).fill(-1);
  private next = new Int32Array(4096);
  private readonly list: Ant[] = [];
  private readonly used: number[] = [];
  private t = 0;

  constructor(private readonly sim: Sim) {}

  update(dt: number): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t += STEP;
    const s = this.sim;
    const crit = s.eco.critters;
    for (const c of crit) c.attackers.length = 0;
    let live = 0;
    for (const col of s.colonies) if (col.ants.length) live++;
    if (live < 2 && crit.length === 0) return;

    const list = this.list;
    list.length = 0;
    for (const col of s.colonies) for (const a of col.ants) if (!a.dead && a.intent !== 'fly') list.push(a);
    if (this.next.length < list.length) this.next = new Int32Array(list.length * 2);
    const { headU, headS, next, used } = this;
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      if (a.under) {
        if (headU[a.at] === -1) used.push(a.at);
        next[k] = headU[a.at];
        headU[a.at] = k;
      } else {
        const cx = Math.max(0, Math.min(W - 1, Math.floor(a.x)));
        next[k] = headS[cx];
        headS[cx] = k;
      }
    }

    for (const a of list) a.beset = 0;
    for (const a of list) if (a.foeAnt && !a.foeAnt.dead) a.foeAnt.beset++;

    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      if (a.dead) continue;
      if (a.foeAnt && (a.foeAnt.dead || !this.near(a, a.foeAnt))) {
        a.foeAnt.beset--;
        a.foeAnt = null;
      }
      if (a.foeCritter) {
        const c = a.foeCritter;
        const far = c.under ? Math.abs(c.x - a.x) > 2 || Math.abs(c.y - a.y) > 2 : Math.abs(c.x - a.x) > CRITTER_INFO[c.kind].size + 1.2 || c.alt > 0.5;
        if (c.dead || a.under !== c.under || far) a.foeCritter = null;
      }
      if (!a.foeAnt && !a.foeCritter && a.caste !== 'alate' && a.intent !== 'trapped') {
        const e = live > 1 ? this.findEnemy(a) : null;
        if (e) {
          this.engage(a);
          a.foeAnt = e;
          e.beset++;
          if (!e.foeAnt && !e.foeCritter) {
            this.engage(e);
            e.foeAnt = a;
            a.beset++;
          }
        } else if (crit.length) {
          const c = this.findCritter(a, crit);
          if (c) {
            this.engage(a);
            a.foeCritter = c;
          }
        }
      }
      if (!a.foeAnt && !a.foeCritter) continue;
      if (a.intent !== 'fight') this.engage(a);
      if (a.foeCritter) a.foeCritter.attackers.push(a);
      a.hitT -= STEP;
      if (a.hitT > 0) continue;
      a.hitT = 0.6 + s.rng.next() * 0.5;
      // Defenders fight harder inside their own nest, and a little harder on their own scent-marked ground
      const home = a.under ? (s.nestOwner(a.at) === a.colony ? 1.5 : 1) : a.colony.home[Math.max(0, Math.min(W - 1, Math.floor(a.x)))] > 0.5 ? 1.15 : 1;
      const dmg = a.atk * home * s.rng.range(0.6, 1.4);
      if (a.foeAnt) {
        const f = a.foeAnt;
        f.hp -= f.caste === 'queen' ? dmg * 0.4 : dmg;
        if (f.hp <= 0) {
          f.colony.die(f, `killed by ${a.colony.species.name.toLowerCase()}s`, a.colony);
          a.foeAnt = null;
        }
      } else if (a.foeCritter) {
        const c = a.foeCritter;
        c.hp -= dmg;
        if (c.hp <= 0) {
          s.eco.killCritter(c, a.colony);
          a.foeCritter = null;
        }
      }
    }

    for (const c of used) headU[c] = -1;
    used.length = 0;
    headS.fill(-1);
  }

  private engage(a: Ant): void {
    if (a.intent === 'fight') return;
    a.colony.interrupt(a);
    a.intent = 'fight';
    this.sim.alarm(a);
  }

  private near(a: Ant, b: Ant): boolean {
    if (a.under !== b.under) return false;
    if (a.under) return Math.abs(a.x - b.x) <= 1.6 && Math.abs(a.y - b.y) <= 1.6;
    return Math.abs(a.x - b.x) <= 1.6;
  }

  private findEnemy(a: Ant): Ant | null {
    const { headU, headS, next, list } = this;
    if (a.under) {
      const x = a.at % W;
      const y = (a.at / W) | 0;
      for (let k = -1; k < 8; k++) {
        const nx = k < 0 ? x : x + DX[k];
        const ny = k < 0 ? y : y + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        for (let j = headU[idx(nx, ny)]; j !== -1; j = next[j]) {
          const b = list[j];
          if (b.colony !== a.colony && !b.dead && b.beset < maxBeset(b) && !a.colony.friendly(b.colony)) return b;
        }
      }
      return null;
    }
    const cx = Math.floor(a.x);
    for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || x >= W) continue;
      for (let j = headS[x]; j !== -1; j = next[j]) {
        const b = list[j];
        if (b.colony !== a.colony && !b.dead && Math.abs(b.x - a.x) <= 1.3 && b.beset < maxBeset(b) && !a.colony.friendly(b.colony)) return b;
      }
    }
    return null;
  }

  private findCritter(a: Ant, crit: Critter[]): Critter | null {
    const hunter = a.task === 'forage' || a.task === 'guard' || a.task === 'raid' || a.caste === 'soldier' || a.intent === 'toThreat';
    for (const c of crit) {
      // Nobody fights a bird, or anything up in the air
      if (c.dead || c.kind === 'bird' || c.alt > 0.5 || c.under !== a.under) continue;
      if (c.under) {
        if (Math.abs(c.x - a.x) > 1.5 || Math.abs(c.y - a.y) > 1.5) continue;
        if (a.caste !== 'queen') return c;
        continue;
      }
      const info = CRITTER_INFO[c.kind];
      if (Math.abs(c.x - a.x) > info.size * 0.6 + 0.8) continue;
      if (c.kind === 'spider' || c.kind === 'ladybird' || (hunter && a.colony.workerCount >= 8)) return c;
    }
    return null;
  }
}

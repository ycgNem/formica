import { W, H, GROUND, DAY, SEASON_DAYS, SEASONS, DIRT, TUNNEL, ROLE_QUEEN, idx, clampCol } from './config';
import { Rng } from './rng';
import { World } from './world';
import { Colony, type Project } from './colony';
import { Ecology, critterY } from './ecology';
import { Weather } from './weather';
import { Combat } from './combat';
import { SPECIES, SPECIES_LIST, type SpeciesId } from './species';
import { planToward } from './planner';
import { makeZones, type Zone } from './layout';
import { Dangers } from './danger';
import { BIOMES, type Biome, type BiomeId } from './biome';
import { withTraits, type Lineage } from './lineage';
import type { Ant } from './ant';

export interface GameOptions {
  species: SpeciesId;
  rival: 'none' | 'calm' | 'aggressive';
  abundance: 'scarce' | 'normal' | 'plenty';
  /** Saves from before biomes are meadows. */
  biome?: BiomeId;
  seed: number;
  name: string;
  /** A daughter colony: inherited traits and the mother colony next door [v1.6]. */
  lineage?: Lineage;
  /** Free tools and a spawn menu, for playing around. */
  sandbox?: boolean;
}

/** One point on the colony graphs. */
export interface Sample {
  /** Game time, seconds. */
  t: number;
  pop: number;
  brood: number;
  sugar: number;
  protein: number;
  /** Ants lost since the last sample. */
  lost: number;
  rival: number;
  kin: number;
}

export type Tone = 'info' | 'good' | 'bad';
export type EventKind = 'toast' | 'milestone' | 'gameover' | 'victory' | 'raid' | 'rain' | 'spider' | 'dawn' | 'season';

export interface GameEvent {
  text: string;
  tone: Tone;
  kind: EventKind;
  day: number;
  /** The goal id for milestone events. */
  ref?: string;
}

export interface Corpse {
  at: number;
  nest: Colony | null;
  claimed: Ant | null;
  age: number;
  gone: boolean;
}

export interface Cover {
  x: number;
  until: number;
}

/** Alarm pheromone where an ant was attacked. It calls nearby nestmates to help, and fades in seconds. */
export interface Alarm {
  colony: Colony;
  under: boolean;
  at: number;
  x: number;
  y: number;
  t: number;
  power: number;
  answered: boolean;
}

/** A pebble sitting in an entrance cell. */
export interface Plug {
  root: number;
  until: number;
}

export interface Marker {
  x: number;
  y: number;
  project: Project;
}

export const MILESTONES = [
  { id: 'first', title: 'First workers', desc: 'Raise your first worker ant.', reward: 15 },
  { id: 'pop50', title: 'Growing family', desc: 'Reach 50 ants.', reward: 20 },
  { id: 'store', title: 'Full pantry', desc: 'Have 100 food in store at once.', reward: 20 },
  { id: 'rain', title: 'Weathered', desc: 'Come through a rainstorm.', reward: 10 },
  { id: 'hunter', title: 'Big game', desc: 'Bring down a beetle, caterpillar or spider.', reward: 20 },
  { id: 'pop500', title: 'Thriving', desc: 'Reach 500 ants.', reward: 40 },
  { id: 'winter', title: 'Overwintered', desc: 'Survive your first winter.', reward: 40 },
  { id: 'rival', title: 'Conqueror', desc: 'Kill a rival queen.', reward: 60 },
  { id: 'pop1000', title: 'Superorganism', desc: 'Reach 1,000 ants.', reward: 80 },
  { id: 'flight', title: 'Nuptial flight', desc: 'Survive a winter, then have 250+ ants in summer and send out winged queens.', reward: 100 },
  { id: 'rescue', title: 'No ant left behind', desc: 'Pull a nestmate out of an antlion pit.', reward: 20 },
  { id: 'army', title: 'Held the line', desc: 'Come through an army ant raid without losing any brood.', reward: 50 },
  { id: 'raft', title: 'Living raft', desc: 'As fire ants, float the queen out of a flooded nest.', reward: 30 },
  { id: 'heir', title: 'Dynasty', desc: 'Found a daughter colony after a nuptial flight, and raise it to 50 ants.', reward: 40 },
  { id: 'sons', title: 'Last gasp', desc: 'Lose the queen with 30+ workers left, and see her sons fly.', reward: 10 },
];

export type ToolId = 'inspect' | 'sugar' | 'protein' | 'leaf' | 'plug' | 'bush' | 'aphids' | 'dig' | 'squish';

export const TOOLS: { id: ToolId; name: string; key: string; cost: number; desc: string }[] = [
  { id: 'inspect', name: 'Inspect', key: 'V', cost: 0, desc: 'Click an ant or creature to follow it. Drag to look around.' },
  { id: 'sugar', name: 'Sugar', key: 'Q', cost: 5, desc: 'Drop sugar water on the surface. Sugar keeps workers alive.' },
  { id: 'protein', name: 'Mealworm', key: 'W', cost: 8, desc: 'Drop a mealworm. Protein lets the queen lay and larvae grow.' },
  { id: 'leaf', name: 'Leaf', key: 'E', cost: 10, desc: 'Lay a leaf over an entrance to keep rain out for a day and a half.' },
  { id: 'plug', name: 'Pebble', key: 'U', cost: 15, desc: 'Plug one of your entrances for a few hours. Keeps raiders and rain out, but your own ants in.' },
  { id: 'bush', name: 'Berry bush', key: 'R', cost: 30, desc: 'Plant a bush that drops berries in every season but winter. Each one costs more than the last.' },
  { id: 'aphids', name: 'Aphids', key: 'I', cost: 25, desc: 'Release root aphids under a plant. Ants that tunnel to them can milk honeydew, even in the rain.' },
  { id: 'dig', name: 'Dig here', key: 'T', cost: 6, desc: 'Mark a spot underground. Workers tunnel toward it first.' },
  { id: 'squish', name: 'Squish', key: 'Y', cost: 10, desc: 'Squash up to four ants on the surface, or hurt a big creature. Careful: that includes your own ants!' },
];

/** How long a pebble plugs an entrance. */
const PLUG_TIME = DAY * 0.4;

const SEASON_TEXT = [
  'Spring has come. Food is returning to the meadow.',
  'Summer! Fruit is plentiful.',
  'Autumn. Seeds are falling. Stock up before winter.',
  'Winter. The colony huddles deep and lives off its stores.',
];

export class Sim {
  readonly rng: Rng;
  readonly biome: Biome;
  /** Landscape zones across the meadow, derived from the seed. */
  readonly zones: Zone[];
  readonly world: World;
  readonly eco: Ecology;
  readonly weather: Weather;
  readonly combat: Combat;
  /** Antlion pits and army ants. */
  readonly danger: Dangers;
  time = DAY * 0.12;
  colonies: Colony[] = [];
  player: Colony | null = null;
  rival: Colony | null = null;
  corpses: Corpse[] = [];
  covers: Cover[] = [];
  plugs: Plug[] = [];
  alarms: Alarm[] = [];
  markers: Marker[] = [];
  /** Berry bushes and aphid herds the keeper has added, which makes the next one dearer. */
  bushes = 0;
  herdsAdded = 0;
  /** Which colony owns each dig project, by project id. */
  projectOwner: Colony[] = [];
  nextProjectId = 0;
  nextAntId = 0;
  points = 40;
  readonly milestones = new Set<string>();
  /** Soil temperature in °C for each row, refreshed every second. */
  readonly temps = new Float32Array(H);
  readonly events: GameEvent[] = [];
  readonly log: GameEvent[] = [];
  over = false;
  overCause = '';
  won = false;
  rivalT = Infinity;
  rivalsBeaten = 0;
  /** The mother colony in a daughter game: a friendly neighbour. */
  kin: Colony | null = null;
  /** Seconds since the last shower ended. Winged ants fly the warm, humid day after rain. */
  sinceRain = DAY;
  /** How long the game over has been held off while an orphaned colony's sons get away. */
  private gasp = 0;
  /** The colony graphs. */
  history: Sample[] = [];
  /** Seconds between graph samples; doubles whenever the history fills, so a long game still fits. */
  histStep = DAY / 8;
  private histT = 0;
  histLost = 0;
  squishT = 0;
  /** Set at dawn; the app autosaves and clears it. */
  wantsSave = false;
  raidDay = -1;
  private overT = 0;
  private waterT = 0;
  private seepT = 0;
  private caveT = DAY;
  private treeT = 0;
  private secT = 0;
  private lastDay: number;
  private lastSeason: number;
  /** When each keeper hint may next be shown. */
  private readonly hintT = new Map<string, number>();

  constructor(readonly opts: GameOptions, readonly demo = false) {
    this.rng = new Rng(opts.seed);
    this.biome = BIOMES[opts.biome ?? 'meadow'];
    this.zones = makeZones(opts.seed, this.biome.zones);
    this.world = new World(this.rng, this.zones, this.biome.relief, this.biome.rocks);
    this.eco = new Ecology(this);
    this.weather = new Weather(this.rng);
    this.combat = new Combat(this);
    this.danger = new Dangers(this);
    this.eco.generate();
    this.placeLogs(this.biome.logs);
    this.danger.generate(this.biome.pits);
    this.lastDay = this.day;
    this.lastSeason = this.season;
    this.updateTemps();
  }

  /** Fallen logs on the woodland floor (driftwood on the riverbank), lying clear of the trees. */
  private placeLogs(n: number): void {
    const r = this.rng;
    const w = this.world;
    for (let k = 0, tries = 0; k < n && tries < 200; tries++) {
      const len = r.int(11, 18);
      const x0 = r.int(12, W - 12 - len);
      const mid = x0 + len / 2;
      if (this.eco.plants.some((p) => p.kind !== 'flower' && Math.abs(p.x - mid) < len / 2 + (p.kind === 'tree' || p.kind === 'wood' ? 6 : 2))) continue;
      if (w.logs.some(([a, b]) => x0 < b + 10 && x0 + len > a - 10)) continue;
      w.addLog(x0, len, r.int(2, 3));
      k++;
    }
    this.eco.plants = this.eco.plants.filter((p) => !w.logs.some(([a, b]) => p.x >= a - 1 && p.x <= b));
  }

  /** The deepest row worth digging to: on a riverbank, just above the water table. */
  get maxDigRow(): number {
    return this.biome.waterTable ? GROUND + this.biome.waterTable - 5 : H - 7;
  }

  // ── clock ───────────────────────────────────────────────────────────

  get day(): number {
    return Math.floor(this.time / DAY);
  }

  get dayFrac(): number {
    return (this.time % DAY) / DAY;
  }

  get season(): number {
    return Math.floor(this.day / SEASON_DAYS) % 4;
  }

  get seasonName(): string {
    return SEASONS[this.season];
  }

  get isWinter(): boolean {
    return this.season === 3;
  }

  /** 0 at midnight, 1 at noon. A third of each day is night. */
  get light(): number {
    return 0.5 + 0.5 * Math.cos(2 * Math.PI * (this.dayFrac - 0.4));
  }

  get darkness(): number {
    return Math.max(0, Math.min(1, (0.25 - this.light) / 0.25));
  }

  get amountMul(): number {
    return { scarce: 0.7, normal: 1, plenty: 1.3 }[this.opts.abundance];
  }

  get intervalMul(): number {
    return { scarce: 1.5, normal: 1, plenty: 0.75 }[this.opts.abundance];
  }

  // ── setup ───────────────────────────────────────────────────────────

  /** After loading, so the restored clock doesn't fire a dawn or season change. */
  syncClock(): void {
    this.lastDay = this.day;
    this.lastSeason = this.season;
    this.updateTemps();
  }

  /** Soil temperature (°C) at a row. */
  tempAt(row: number): number {
    return this.temps[Math.max(0, Math.min(H - 1, row | 0))];
  }

  /**
   * The ground warms and cools in a daily wave that fades and lags with depth (about ten cells), riding on a yearly
   * wave that reaches much deeper. So the shallows are hottest at midday, and deep soil is the warm place in winter.
   */
  private updateTemps(): void {
    const year = this.time / DAY / (SEASON_DAYS * 4);
    const surf = 16 + 10 * Math.cos(2 * Math.PI * (year - 0.375)) + this.biome.heat;
    const amp = Math.max(1, 3 + 0.3 * (surf - 4) + this.biome.swing);
    const rain = this.weather.intensity * 3;
    for (let y = 0; y < H; y++) {
      const d = Math.max(0, y - GROUND);
      const mean = 16 + 10 * Math.exp(-d / 90) * Math.cos(2 * Math.PI * (year - 0.375) - d / 90);
      this.temps[y] = mean + (amp * Math.cos(2 * Math.PI * (this.dayFrac - 0.58) - d / 10) - rain) * Math.exp(-d / 10);
    }
  }

  releaseQueen(col: number): Colony | null {
    if (this.player) return null;
    const lin = this.opts.lineage;
    const c = new Colony(this, withTraits(SPECIES[this.opts.species], lin?.traits), true, this.opts.name, col);
    this.player = c;
    this.colonies.push(c);
    if (this.opts.rival !== 'none' && !this.demo) this.rivalT = this.time + DAY * (this.opts.rival === 'aggressive' ? 0.9 : 1.5);
    const where = { meadow: 'in the meadow', woodland: 'on the woodland floor', dunes: 'on the dunes', riverbank: 'by the river' }[this.biome.id];
    const who = lin?.kin ? `Your queen, a daughter of ${lin.kin.name},` : 'Your queen';
    this.emit(`${who} lands ${where} and sheds her wings. She starts to dig.`, 'info');
    if (lin?.kin && !this.demo) this.spawnKin(clampCol(col), lin.kin);
    return c;
  }

  /** A daughter game's mother colony: an established nest a little way off, on the side away from where rivals land [v1.6]. */
  private spawnKin(home: number, kin: { name: string; species: SpeciesId }): void {
    const dir = home < W / 2 ? -1 : 1;
    let x = -1;
    for (let k = 0; k < 40 && x < 0; k++) {
      const c = Math.round(home + dir * this.rng.range(60, 110));
      if (c >= 25 && c <= W - 26 && this.world.siteClear(c, 12, 28)) x = c;
    }
    if (x < 0) return;
    const c = new Colony(this, SPECIES[kin.species], false, kin.name, x);
    c.kin = true;
    c.layScale = 1.2;
    if (!c.establish(70, 40, 16)) return;
    this.kin = c;
    this.colonies.push(c);
    this.emit(`${kin.name}, the colony she flew from, is a short walk to the ${dir < 0 ? 'west' : 'east'}. Kin don't fight.`, 'good');
  }

  /** Warm and humid, the day after rain, in daylight: when winged ants pour out of every nest at once. */
  get flightWeather(): boolean {
    return !this.weather.raining && !this.isWinter && this.sinceRain < DAY * 0.6 && this.tempAt(GROUND) >= 17;
  }

  private spawnRival(): void {
    const p = this.player!;
    const home = p.roots.length ? p.roots[0] % W : clampCol(p.queen.x);
    const east = home < W / 2;
    // Land on fresh ground, not in the ruins of the last rival's nest
    let x = -1;
    for (let k = 0; k < 30 && x < 0; k++) {
      const c = Math.round(east ? this.rng.range(Math.max(home + 140, W - 110), W - 25) : this.rng.range(25, Math.min(home - 140, 110)));
      if (this.world.siteClear(c, 12, 28)) x = c;
    }
    if (x < 0) {
      this.rivalT = this.time + DAY;
      return;
    }
    const others = SPECIES_LIST.filter((s) => s.id !== this.opts.species);
    const sp = this.rng.pick(others);
    const r = new Colony(this, sp, false, `${sp.name} colony`, x);
    r.layScale = this.opts.rival === 'aggressive' ? 0.95 : 1.3;
    this.rival = r;
    this.colonies.push(r);
    this.emit(`A ${sp.name.toLowerCase()} queen has landed to the ${east ? 'east' : 'west'}. A rival colony is starting.`, 'bad');
  }

  // ── main loop ───────────────────────────────────────────────────────

  update(dt: number): void {
    // The meadow waits for the keeper to release the queen
    if (this.over || !this.player) return;
    this.time += dt;
    if (this.overT > 0) {
      this.overT -= dt;
      // An orphaned colony's last males are still getting away: let them go first
      const p = this.player;
      if (this.overT <= 0 && p.orphaned && p.ants.length > 0 && this.gasp < DAY && (p.flying || p.alateCount > 0 || p.brood.some((b) => b.male && !b.dead))) {
        this.overT = 5;
        this.gasp += 5;
      }
      if (this.overT <= 0) {
        this.over = true;
        this.push({ text: this.overCause, tone: 'bad', kind: 'gameover', day: this.day + 1 });
        return;
      }
    }
    const wev = this.weather.update(dt, this.season, this.rng, this.biome.rain);
    this.sinceRain = this.weather.raining ? 0 : this.sinceRain + dt;
    if (wev === 'start') {
      this.emit(this.isWinter ? 'Snow is falling.' : 'Rain is coming. Water will pour into open entrances.', 'info', 'rain');
    } else if (wev === 'stop' && !this.isWinter && this.player?.settled && this.player.queenAlive) {
      this.milestone('rain');
    }
    this.treeT -= dt;
    if (this.treeT <= 0) {
      this.treeT = 0.5;
      this.world.rebuildTree();
    }
    this.waterT -= dt;
    if (this.waterT <= 0) {
      this.waterT += 0.08;
      if (this.weather.raining && !this.isWinter) this.rainInflow();
      if (this.world.waterCount) this.world.stepWater(this.rng);
    }
    if (this.biome.waterTable) {
      this.seepT -= dt;
      if (this.seepT <= 0) {
        this.seepT = 0.5;
        this.seep();
      }
    }
    this.eco.update(dt);
    for (const c of this.colonies) c.update(dt);
    this.combat.update(dt);
    this.danger.update(dt);
    if (this.alarms.length) {
      for (const al of this.alarms) al.t += dt;
      this.alarms = this.alarms.filter((al) => al.t < 8);
    }
    this.secT -= dt;
    if (this.secT <= 0) {
      this.secT = 1;
      this.everySecond();
    }
  }

  private rainInflow(): void {
    const p = this.weather.intensity * 0.15 * this.biome.flood;
    for (const r of this.world.roots) {
      const x = r % W;
      if (this.isCovered(x) || this.isPlugged(r)) continue;
      if (this.rng.chance(p)) this.world.addWater(r);
    }
  }

  isCovered(x: number): boolean {
    return this.covers.some((c) => Math.abs(c.x - x) <= 5);
  }

  /** An ant under attack gives off alarm pheromone; a fresh alarm close by just gets stronger. */
  alarm(a: Ant): void {
    for (const al of this.alarms) {
      if (al.colony === a.colony && al.under === a.under && Math.abs(al.x - a.x) < 4 && Math.abs(al.y - a.y) < 4) {
        al.power = Math.min(6, al.power + 1);
        if (al.t > 1.5) {
          al.t = 0;
          al.answered = false;
        }
        return;
      }
    }
    this.alarms.push({ colony: a.colony, under: a.under, at: a.at, x: a.x, y: a.y, t: 0, power: 1, answered: false });
  }

  /** Groundwater seeps into any tunnel dug below the water table, and the table rises in a storm. */
  private seep(): void {
    const w = this.world;
    if (this.isWinter) return;
    const row = GROUND + this.biome.waterTable - Math.round(this.weather.intensity * 6);
    const from = row * W;
    for (const c of this.colonies) {
      for (const p of c.projects) {
        for (const i of p.cells) if (i >= from && w.cells[i] === TUNNEL && !w.water[i] && this.rng.chance(0.12)) w.addWater(i);
      }
    }
  }

  /** Dry sand gives way: a short stretch of shallow tunnel fills in, and the colony has to dig it out again. */
  private caveIn(): void {
    const w = this.world;
    const r = this.rng;
    const busy = new Set<number>();
    for (const c of this.colonies) {
      for (const a of c.ants) if (a.under) busy.add(a.at);
      for (const b of c.brood) busy.add(b.cell);
    }
    for (const cp of this.corpses) busy.add(cp.at);
    for (const c of this.colonies) {
      if (!c.settled || !r.chance(c === this.player ? 0.8 : 0.5)) continue;
      for (let k = 0; k < 30; k++) {
        const p = r.pick(c.projects);
        if (!p || p.kind === 'shaft' || p.cursor === 0) continue;
        const at = r.pick(p.cells);
        const x = at % W;
        const depth = Math.floor(at / W) - w.top[x];
        if (w.cells[at] !== TUNNEL || depth < 3 || depth > 24 || w.room[at] === ROLE_QUEEN || busy.has(at)) continue;
        const fill = p.cells.filter((i) => w.cells[i] === TUNNEL && !busy.has(i) && Math.abs((i % W) - x) + Math.abs(Math.floor(i / W) - Math.floor(at / W)) <= 2);
        const rooms = fill.map((i) => w.room[i]);
        for (const i of fill) {
          w.setCell(i, DIRT);
          w.room[i] = 0;
          w.water[i] = 0;
        }
        w.markTreeDirty();
        w.rebuildTree();
        // Sand slumps, but never seals ants or brood off from the way out: they couldn't dig back, as nobody can reach the fall
        if ([...busy].some((i) => w.cells[i] === TUNNEL && w.dist[i] < 0)) {
          fill.forEach((i, k) => {
            w.setCell(i, TUNNEL);
            w.room[i] = rooms[k];
          });
          w.markTreeDirty();
          w.rebuildTree();
          continue;
        }
        // Anyone on her way through the fall turns back and finds another way
        const gone = new Set(fill);
        for (const col of this.colonies) {
          for (const a of col.ants) {
            if (!a.dead && a.legs.some((l) => l.under && l.pts.some((q) => gone.has(q)))) col.interrupt(a);
          }
        }
        // Back on the job list, ahead of everything else
        p.done = false;
        p.cursor = 0;
        p.priority = true;
        if (!c.active.includes(p)) c.active.push(p);
        if (c === this.player) this.emit('A sandy tunnel has caved in! Workers will dig it out again.', 'bad');
        break;
      }
    }
  }

  private sample(): void {
    const p = this.player!;
    const lost = p.stats.lost - this.histLost;
    this.histLost = p.stats.lost;
    const r = this.rival;
    const k = this.kin;
    this.history.push({
      t: Math.round(this.time), pop: p.pop, brood: p.brood.length, sugar: Math.round(p.sugar), protein: Math.round(p.protein), lost,
      rival: r && r.alive ? r.pop : 0, kin: k && k.alive ? k.pop : 0,
    });
    if (this.history.length < 400) return;
    // Halve the resolution: merge neighbouring samples, adding up the losses
    const out: Sample[] = [];
    for (let i = 0; i + 1 < this.history.length; i += 2) out.push({ ...this.history[i + 1], lost: this.history[i].lost + this.history[i + 1].lost });
    this.history = out;
    this.histStep *= 2;
  }

  isPlugged(root: number): boolean {
    for (const p of this.plugs) if (p.root === root) return true;
    return false;
  }

  private everySecond(): void {
    this.updateTemps();
    if (this.player && !this.demo && (this.histT -= 1) <= 0) {
      this.histT = this.histStep;
      this.sample();
    }
    if (this.biome.collapse) {
      // Sand caves in most after it dries out following rain
      this.caveT -= this.weather.raining ? 0.3 : 1;
      if (this.caveT <= 0) {
        this.caveT = DAY * this.rng.range(0.35, 0.7);
        this.caveIn();
      }
    }
    for (const c of this.corpses) if ((c.age += 1) > DAY * 1.5) c.gone = true;
    this.corpses = this.corpses.filter((c) => !c.gone);
    this.covers = this.covers.filter((c) => c.until > this.time);
    for (const hd of this.eco.herds) {
      if (hd.owner && !hd.owner.alive) {
        hd.owner = null;
        hd.access = -1;
      }
    }
    if (this.plugs.length) this.plugs = this.plugs.filter((p) => p.until > this.time);
    this.markers = this.markers.filter((m) => !m.project.done);
    if (this.day !== this.lastDay) {
      this.lastDay = this.day;
      this.onDawn();
    }
    if (this.season !== this.lastSeason) {
      const prev = this.lastSeason;
      this.lastSeason = this.season;
      this.emit(SEASON_TEXT[this.season], this.season === 3 ? 'bad' : 'info', 'season');
      if (prev === 3) {
        for (const c of this.colonies) if (c.queenAlive && c.settled) c.winters++;
        if (this.player?.queenAlive) this.milestone('winter');
      }
    }
    this.danger.everySecond();
    this.updateRival();
    this.checkMilestones();
    this.advise();
    this.colonies = this.colonies.filter((c) => c === this.player || c.alive);
  }

  /** Point a new keeper at the right tool when something goes wrong, without nagging. */
  private advise(): void {
    const p = this.player;
    if (!p || !p.settled || !p.queenAlive || this.demo) return;
    const hint = (id: string, text: string, again = DAY * 2): void => {
      if ((this.hintT.get(id) ?? 0) > this.time) return;
      this.hintT.set(id, this.time + again);
      this.emit(text, 'info');
    };
    if (p.protein < 0.5 && !this.isWinter) hint('protein', 'The queen has stopped laying: there is no protein. Drop a mealworm (W) or let foragers hunt insects.');
    if (this.weather.raining && !this.isWinter && this.world.waterCount > 12 && p.roots.some((r) => !this.isCovered(r % W) && !this.isPlugged(r))) {
      hint('flood', 'Rain is pouring into the nest. A leaf (E) or a pebble (U) over the entrance keeps it out.');
    }
    if (p.threat?.under) hint('breach', 'Enemies are inside! Switch Focus to Defend, or plug the entrance (U) to stop more getting in.', DAY);
    if (this.season === 2 && this.dayFrac > 0.5 && p.stored < (p.workerCount * p.species.appetite + 1.5) * 1.2) {
      hint('winter', 'Winter is close and the stores look thin. Set Focus to Forage, or drop some sugar (Q).', DAY * 3);
    }
  }

  private onDawn(): void {
    const p = this.player;
    if (!p || !p.queenAlive || this.demo) return;
    const inc = 8 + Math.floor(p.pop / 12);
    this.points += inc;
    this.emit(`Day ${this.day + 1}. +${inc} keeper points.`, 'info', 'dawn');
    this.wantsSave = true;
  }

  private updateRival(): void {
    const p = this.player;
    if (this.opts.rival === 'none' || !p || this.demo || !p.queenAlive) return;
    if (!this.rival) {
      if (this.time >= this.rivalT && p.roots.length) this.spawnRival();
      return;
    }
    const r = this.rival;
    if (!r.alive) {
      this.rival = null;
      this.rivalT = this.time + DAY * 4;
      this.emit('The last of the rival colony is gone. The meadow is yours, for now.', 'good');
      return;
    }
    // Once a day around noon the rival weighs up a raid
    if (this.day === this.raidDay || this.dayFrac < 0.4 || this.dayFrac > 0.6) return;
    this.raidDay = this.day;
    // A calm rival leaves you alone through your first winter; an aggressive one tests you early
    const aggressive = this.opts.rival === 'aggressive';
    if (this.day < (aggressive ? 6 : 12) || r.pop < 40 || !r.canRaid(p)) return;
    const ratio = r.strength() / Math.max(1, p.strength());
    if (ratio > (aggressive ? 1.3 : 2.2) && this.rng.chance(aggressive ? 0.55 : 0.25) && r.launchRaid(p)) {
      this.emit(`${r.species.name} raiders are massing to attack your nest!`, 'bad', 'raid');
    }
  }

  private checkMilestones(): void {
    const p = this.player;
    if (!p || this.demo) return;
    if (p.stats.born >= 1) this.milestone('first');
    if (p.pop >= 50) this.milestone('pop50');
    if (p.pop >= 50 && this.opts.lineage) this.milestone('heir');
    if (p.stored >= 100) this.milestone('store');
    if (p.pop >= 500) this.milestone('pop500');
    if (p.pop >= 1000) this.milestone('pop1000');
  }

  // ── events ──────────────────────────────────────────────────────────

  private push(e: GameEvent): void {
    this.events.push(e);
    this.log.unshift(e);
    if (this.log.length > 80) this.log.pop();
  }

  emit(text: string, tone: Tone = 'info', kind: EventKind = 'toast'): void {
    if (this.demo) return;
    this.push({ text, tone, kind, day: this.day + 1 });
  }

  milestone(id: string): void {
    if (this.demo || this.milestones.has(id)) return;
    const m = MILESTONES.find((x) => x.id === id);
    if (!m) return;
    this.milestones.add(id);
    this.points += m.reward;
    this.push({ text: `Goal complete: ${m.title} (+${m.reward})`, tone: 'good', kind: 'milestone', day: this.day + 1, ref: id });
  }

  onQueenDeath(c: Colony, cause: string): void {
    if (c === this.player) {
      this.overCause = `The queen has died (${cause}).`;
      this.overT = c.orphaned ? DAY * 1.5 : 3;
      this.emit(c.orphaned ? `Your queen has died (${cause}). Without her, the workers will lay a last brood of males to carry her line on.` : `Your queen has died (${cause}).`, 'bad');
    } else if (c.kin) {
      this.emit(`The queen of ${c.name}, your mother colony, has died (${cause}).`, 'bad');
    } else {
      this.emit(`The rival queen is dead (${cause})! Her colony will wither away.`, 'good');
      if (this.player?.queenAlive) {
        this.milestone('rival');
        this.rivalsBeaten++;
      }
    }
  }

  /** The orphaned colony's sons got away. */
  onSonsFlown(): void {
    if (this.milestones.has('sons')) return;
    this.overCause += ' Her sons flew to carry her line on.';
    this.milestone('sons');
  }

  onFlight(c: Colony): void {
    if (c !== this.player) return;
    this.milestone('flight');
    if (!this.won) {
      this.won = true;
      this.push({ text: 'Nuptial flight', tone: 'good', kind: 'victory', day: this.day + 1 });
    }
  }

  nestOwner(cell: number): Colony | null {
    const o = this.world.planOwner[cell];
    return o ? this.projectOwner[o - 1] ?? null : null;
  }

  // ── keeper actions ──────────────────────────────────────────────────

  /** What a tool costs right now. */
  toolCost(tool: ToolId): number {
    if (this.opts.sandbox) return 0;
    const def = TOOLS.find((t) => t.id === tool)!;
    return tool === 'bush' ? def.cost + 15 * this.bushes : tool === 'aphids' ? def.cost + 10 * this.herdsAdded : def.cost;
  }

  /** Apply a keeper tool at a world position. Returns an error message, or null on success. */
  useTool(tool: ToolId, wx: number, wy: number): string | null {
    if (tool === 'inspect') return null;
    const cost = this.toolCost(tool);
    if (cost > this.points) return 'Not enough keeper points';
    const col = clampCol(wx);
    const onSurface = wy < this.world.top[col] + 2.5;
    switch (tool) {
      case 'sugar':
      case 'protein': {
        if (!onSurface) return 'Drop food on the surface';
        const f = this.eco.addFood(col, tool, false);
        this.player?.known.add(f);
        break;
      }
      case 'leaf':
        if (!onSurface) return 'Lay leaves on the surface';
        this.covers.push({ x: col, until: this.time + DAY * 1.5 });
        break;
      case 'plug': {
        const p = this.player;
        let root = -1;
        for (const r of p?.roots ?? []) if (Math.abs((r % W) - wx) < 4 && (root < 0 || Math.abs((r % W) - wx) < Math.abs((root % W) - wx))) root = r;
        if (root < 0 || !onSurface) return 'Drop the pebble on one of your entrances';
        if (this.isPlugged(root)) return 'That entrance is already plugged';
        this.plugs.push({ root, until: this.time + PLUG_TIME });
        break;
      }
      case 'bush':
        if (!onSurface) return 'Plant it on the surface';
        if (this.eco.plants.some((p) => (p.kind === 'berry' || p.kind === 'tree' || p.kind === 'wood') && Math.abs(p.x - col) < 6)) return 'Too close to another plant';
        this.eco.plants.push({ x: col, kind: 'berry', size: 1, variant: 0, grow: 0, dropT: 20 });
        this.bushes++;
        break;
      case 'aphids': {
        if (!onSurface) return 'Release them on the surface, by a plant';
        const host = this.eco.plants.filter((p) => p.kind !== 'flower' && Math.abs(p.x - col) < 8).sort((a, b) => Math.abs(a.x - col) - Math.abs(b.x - col))[0];
        if (!host) return 'Aphids need a bush or tree to live on';
        if (this.eco.herds.length >= 12) return 'The meadow has all the aphids it can hold';
        if (!this.eco.addHerd(host.x, 12)) return 'There are aphids on those roots already';
        this.herdsAdded++;
        break;
      }
      case 'dig': {
        const p = this.player;
        if (!p || !p.settled) return 'Your colony needs a nest first';
        const x = Math.floor(wx);
        const y = Math.floor(wy);
        if (y < GROUND + 8 || y > H - 6 || x < 6 || x > W - 7) return "Can't dig there";
        if (this.world.cells[idx(x, y)] === TUNNEL) return 'That is already a tunnel';
        const proj = planToward(p, wx, wy);
        if (!proj) return 'No clear way to tunnel there';
        this.markers.push({ x: wx, y: wy, project: proj });
        break;
      }
      case 'squish': {
        if (this.squishT > this.time) return 'Your finger needs a moment';
        if (!onSurface) return "Your finger can't reach underground";
        this.squishT = this.time + 2;
        // Big creatures shrug off one squash; a bird just takes fright; a finger only fits so many ants
        for (const c of this.eco.critters) {
          if (c.dead || c.under || Math.hypot(c.x - wx, critterY(c, this.world.top) - 1 - wy) >= (c.kind === 'bird' ? 5 : 3.5)) continue;
          if (c.kind === 'bird') {
            c.leaving = true;
            c.dir = c.x < wx ? -1 : 1;
            continue;
          }
          c.hp -= 50;
          if (c.hp <= 0) this.eco.killCritter(c, null);
        }
        const hit: Ant[] = [];
        for (const col of this.colonies) {
          for (const a of col.ants) {
            if (a.dead || a.under || a.caste === 'queen' || a.intent === 'fly') continue;
            if (Math.hypot(a.x - wx, a.y - wy) < 2.6) hit.push(a);
          }
        }
        hit.sort((a, b) => Math.hypot(a.x - wx, a.y - wy) - Math.hypot(b.x - wx, b.y - wy));
        for (const a of hit.slice(0, 4)) a.colony.die(a, 'squished');
        break;
      }
    }
    this.points -= cost;
    return null;
  }
}

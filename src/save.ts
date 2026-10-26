import { W } from './config';
import { Sim, type GameOptions, type GameEvent, type Sample } from './sim';
import { Colony, type Project, type Focus } from './colony';
import { Ant, CASTE_HP, CASTE_ATK, type Caste, type Task } from './ant';
import { SPECIES, type SpeciesId } from './species';
import type { FoodSource, Plant, Critter, Herd } from './ecology';
import type { Swarm } from './danger';
import { BIOMES } from './biome';
import { withTraits } from './lineage';

const KEY = 'formica.save.v1';
const VERSION = 1;

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const bytesOf = (a: Int32Array | Uint8Array): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

interface AntSave {
  id: number; caste: Caste; under: boolean; at: number; x: number; y: number;
  age: number; life: number; hp: number; carry: number; load: number; loadAmt: number; task: Task;
  /** Physiological age, thresholds and task tallies (added in 1.2). */
  phys?: number; th?: number[]; done?: number[];
  /** Winged males (v1.6). */
  male?: boolean;
}

interface ColonySave {
  species: SpeciesId; isPlayer: boolean; name: string;
  sugar: number; protein: number; seeds?: number; midden: number; hunger: number; focus: Focus; layScale: number;
  settled: boolean; queenAlive: boolean; queenChamber: number; foundT: number; layT: number; clutch: number;
  alateQueue: number; flownYear: number; winters?: number; roots: number[]; roomCount: number[];
  /** Home-range scent per column, in hundredths. */
  home?: number[];
  /** The mother colony in a daughter game, and a colony whose queen died raising a last brood (v1.6). */
  kin?: boolean; orphaned?: boolean;
  stats: Colony['stats']; known: number[];
  projects: Omit<Project, 'workers'>[];
  ants: AntSave[];
  brood: { cell: number; stage: number; t: number; caste: Caste; wet: number; starve: number; male?: boolean }[];
}

interface SaveData {
  v: number;
  savedAt: number;
  opts: GameOptions;
  time: number;
  rng: number;
  points: number;
  milestones: string[];
  log: GameEvent[];
  rivalT: number;
  rivalsBeaten: number;
  won: boolean;
  nextProjectId: number;
  nextAntId: number;
  weather: { raining: boolean; intensity: number; t: number; next: number };
  world: { cells: string; room: string; water: string; top: string; planOwner: string; roots: number[] };
  eco: {
    food: FoodSource[]; plants: Plant[]; critters: Omit<Critter, 'attackers'>[]; nextId: number; bugT: number; carcT: number; spiderT: number; seedT: number;
    birdT?: number; centT?: number; ladyT?: number;
  };
  /** Antlion pits and army ants (v1.7). */
  danger?: { pits: { x: number; sated: number; caught: number }[]; armyYear: number; swarm: (Omit<Swarm, 'raiding'> & { raiding: number }) | null };
  covers: { x: number; until: number }[];
  plugs?: { root: number; until: number }[];
  bushes?: number;
  herdsAdded?: number;
  herds?: (Omit<Herd, 'owner' | 'dig' | 'visitors'> & { owner: number })[];
  raidDay?: number;
  corpses: { at: number; nest: number; age: number }[];
  colonies: ColonySave[];
  rival: number;
  kin?: number;
  sinceRain?: number;
  /** Colony graphs. */
  history?: Sample[];
  histStep?: number;
}

export interface SaveSummary {
  name: string;
  species: string;
  biome: string;
  day: number;
  pop: number;
  savedAt: number;
}

export function saveGame(sim: Sim): boolean {
  if (!sim.player || sim.demo || sim.over) return false;
  const w = sim.world;
  const cols = sim.colonies;
  const data: SaveData = {
    v: VERSION,
    savedAt: Date.now(),
    opts: sim.opts,
    time: sim.time,
    rng: sim.rng.state,
    points: sim.points,
    milestones: [...sim.milestones],
    log: sim.log.slice(0, 40),
    rivalT: Number.isFinite(sim.rivalT) ? sim.rivalT : -1,
    rivalsBeaten: sim.rivalsBeaten,
    won: sim.won,
    nextProjectId: sim.nextProjectId,
    nextAntId: sim.nextAntId,
    weather: { raining: sim.weather.raining, intensity: sim.weather.intensity, t: sim.weather.t, next: sim.weather.next },
    world: {
      cells: toB64(w.cells), room: toB64(w.room), water: toB64(w.water),
      top: toB64(bytesOf(w.top)), planOwner: toB64(bytesOf(w.planOwner)), roots: [...w.roots],
    },
    eco: {
      food: sim.eco.food.filter((f) => !f.gone),
      plants: sim.eco.plants,
      critters: sim.eco.critters.filter((c) => !c.dead).map(({ attackers: _a, ...c }) => c),
      nextId: sim.eco.nextId, bugT: sim.eco.bugT, carcT: sim.eco.carcT, spiderT: sim.eco.spiderT, seedT: sim.eco.seedT,
      birdT: sim.eco.birdT, centT: sim.eco.centT, ladyT: sim.eco.ladyT,
    },
    danger: {
      pits: sim.danger.pits.map(({ x, sated, caught }) => ({ x, sated, caught })),
      armyYear: sim.danger.armyYear,
      swarm: sim.danger.swarm ? { ...sim.danger.swarm, raiding: sim.danger.swarm.raiding ? cols.indexOf(sim.danger.swarm.raiding) : -1 } : null,
    },
    covers: sim.covers,
    plugs: sim.plugs,
    bushes: sim.bushes,
    herdsAdded: sim.herdsAdded,
    herds: sim.eco.herds.map(({ owner, dig: _d, visitors: _v, ...h }) => ({ ...h, owner: owner ? cols.indexOf(owner) : -1 })),
    raidDay: sim.raidDay,
    corpses: sim.corpses.filter((c) => !c.gone).map((c) => ({ at: c.at, nest: c.nest ? cols.indexOf(c.nest) : -1, age: c.age })),
    colonies: cols.map((c) => ({
      species: c.species.id, isPlayer: c.isPlayer, name: c.name,
      sugar: c.sugar, protein: c.protein, seeds: c.seeds, midden: c.midden, hunger: c.hunger, focus: c.focus, layScale: c.layScale,
      settled: c.settled, queenAlive: c.queenAlive, queenChamber: c.queenChamber ? c.queenChamber.id : -1,
      foundT: c.foundT, layT: c.layT, clutch: c.clutch, alateQueue: c.alateQueue, flownYear: c.flownYear, winters: c.winters,
      roots: [...c.roots], roomCount: [...c.roomCount], stats: { ...c.stats },
      home: Array.from(c.home, (v) => Math.round(v * 100)),
      kin: c.kin, orphaned: c.orphaned,
      known: [...c.known].filter((f) => !f.gone).map((f) => f.id),
      projects: c.projects.map(({ workers: _w, ...p }) => p),
      ants: c.ants.filter((a) => !a.dead && a.intent !== 'fly').map((a) => ({
        id: a.id, caste: a.caste, under: a.under, at: a.at, x: a.x, y: a.y,
        age: a.age, life: Number.isFinite(a.life) ? a.life : -1, hp: a.hp, carry: a.carry,
        load: a.load === 3 ? 0 : a.load, loadAmt: a.loadAmt, task: a.task === 'raid' ? 'none' : a.task,
        phys: +a.phys.toFixed(3), th: [...a.th].map((v) => +v.toFixed(3)), done: [...a.done], male: a.male || undefined,
      })),
      brood: c.brood.filter((b) => !b.dead).map((b) => ({
        cell: b.carrier?.under ? b.carrier.at : b.cell, stage: b.stage, t: b.t, caste: b.caste, wet: b.wet, starve: b.starve, male: b.male || undefined,
      })),
    })),
    rival: sim.rival ? cols.indexOf(sim.rival) : -1,
    kin: sim.kin ? cols.indexOf(sim.kin) : -1,
    sinceRain: sim.sinceRain,
    history: sim.history,
    histStep: sim.histStep,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function read(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d.v === VERSION ? d : null;
  } catch {
    return null;
  }
}

export function saveSummary(): SaveSummary | null {
  const d = read();
  if (!d) return null;
  const p = d.colonies.find((c) => c.isPlayer);
  return {
    name: d.opts.name,
    species: SPECIES[d.opts.species].name,
    biome: BIOMES[d.opts.biome ?? 'meadow'].name,
    day: Math.floor(d.time / 240) + 1,
    pop: p ? p.ants.length : 0,
    savedAt: d.savedAt,
  };
}

/** The saved game as text, for keeping a copy outside the browser. */
export function exportSave(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Put a copy back. Returns an error message, or null if it's in place and ready to continue. */
export function importSave(text: string): string | null {
  let d: SaveData;
  try {
    d = JSON.parse(text) as SaveData;
  } catch {
    return "That file isn't a Formica save.";
  }
  if (!d || typeof d !== 'object' || !Array.isArray(d.colonies) || !d.opts || !d.world) return "That file isn't a Formica save.";
  if (d.v !== VERSION) return 'That save is from a different version of the game.';
  try {
    localStorage.setItem(KEY, text);
  } catch {
    return "The browser wouldn't store it (storage is full or blocked).";
  }
  return null;
}

export function deleteSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}

export function loadGame(): Sim | null {
  const d = read();
  if (!d) return null;
  try {
    const sim = new Sim(d.opts);
    const w = sim.world;
    w.cells.set(fromB64(d.world.cells));
    w.room.set(fromB64(d.world.room));
    w.water.set(fromB64(d.world.water));
    w.top.set(new Int32Array(fromB64(d.world.top).buffer));
    w.planOwner.set(new Int32Array(fromB64(d.world.planOwner).buffer));
    w.roots.length = 0;
    w.roots.push(...d.world.roots);
    w.markTreeDirty();
    w.rebuildTree();
    w.rebuildWaterList();

    sim.time = d.time;
    sim.rng.state = d.rng;
    sim.points = d.points;
    for (const m of d.milestones) sim.milestones.add(m);
    sim.log.push(...d.log);
    sim.rivalT = d.rivalT < 0 ? Infinity : d.rivalT;
    sim.rivalsBeaten = d.rivalsBeaten;
    sim.won = d.won;
    sim.nextProjectId = d.nextProjectId;
    sim.nextAntId = d.nextAntId;
    Object.assign(sim.weather, d.weather);
    const e = sim.eco;
    e.food = d.eco.food;
    e.plants = d.eco.plants;
    // Critters from before v1.7 lack the tunnel and flight fields
    const fresh: Partial<Critter> = { under: false, at: -1, y: 0, path: [], trail: [], alt: 0, goal: 0, herdId: -1 };
    e.critters = d.eco.critters.map((c) => ({ ...fresh, ...c, attackers: [] }));
    e.birdT = d.eco.birdT ?? e.birdT;
    e.centT = d.eco.centT ?? e.centT;
    e.ladyT = d.eco.ladyT ?? e.ladyT;
    e.nextId = d.eco.nextId;
    e.bugT = d.eco.bugT;
    e.carcT = d.eco.carcT;
    e.spiderT = d.eco.spiderT;
    e.seedT = d.eco.seedT;
    sim.covers = d.covers;
    sim.plugs = d.plugs ?? [];
    sim.bushes = d.bushes ?? 0;
    sim.herdsAdded = d.herdsAdded ?? 0;
    sim.raidDay = d.raidDay ?? -1;

    const foodById = new Map(e.food.map((f) => [f.id, f]));
    for (const cs of d.colonies) {
      // The player's line keeps its inherited traits
      const sp = cs.isPlayer ? withTraits(SPECIES[cs.species], d.opts.lineage?.traits) : SPECIES[cs.species];
      const c = new Colony(sim, sp, cs.isPlayer, cs.name, W / 2);
      sim.nextAntId = d.nextAntId; // the constructor's placeholder queen must not consume an id
      c.ants = [];
      Object.assign(c, {
        sugar: cs.sugar, protein: cs.protein, seeds: cs.seeds ?? 0, midden: cs.midden, hunger: cs.hunger, focus: cs.focus, layScale: cs.layScale,
        settled: cs.settled, queenAlive: cs.queenAlive, foundT: cs.foundT, layT: cs.layT, clutch: cs.clutch,
        alateQueue: cs.alateQueue, flownYear: cs.flownYear,
        // Older saves didn't count winters: a colony past day 12 has seen one
        winters: cs.winters ?? (d.time >= 240 * 12 ? 1 : 0),
        kin: cs.kin ?? false, orphaned: cs.orphaned ?? false,
      });
      if (cs.home) cs.home.forEach((v, i) => (c.home[i] = v / 100));
      c.roots.push(...cs.roots);
      cs.roomCount.forEach((v, i) => (c.roomCount[i] = v));
      Object.assign(c.stats, cs.stats);
      for (const id of cs.known) {
        const f = foodById.get(id);
        if (f) c.known.add(f);
      }
      for (const ps of cs.projects) {
        const p: Project = { ...ps, workers: 0 };
        c.projects.push(p);
        if (!p.done) c.active.push(p);
        sim.projectOwner[p.id] = c;
        if (p.id === cs.queenChamber) c.queenChamber = p;
      }
      for (const as of cs.ants) {
        const a = new Ant(as.id, c, as.caste, sim.rng);
        Object.assign(a, {
          under: as.under, at: as.at, x: as.x, y: as.y, age: as.age, life: as.life < 0 ? Infinity : as.life,
          hp: as.hp, carry: as.carry, load: as.load, loadAmt: as.loadAmt, task: as.task,
          phys: as.phys ?? (Number.isFinite(a.life) ? as.age / (as.life < 0 ? Infinity : as.life) : 0),
        });
        if (as.th) a.th.set(as.th);
        if (as.done) a.done.set(as.done);
        a.maxHp = sp.hp * CASTE_HP[as.caste];
        a.atk = sp.atk * CASTE_ATK[as.caste];
        a.intent = as.caste === 'queen' ? (cs.settled ? 'rest' : cs.queenChamber >= 0 ? 'work' : 'found') : 'idle';
        a.taskT = 0;
        a.male = as.male ?? false;
        c.ants.push(a);
        if (as.caste === 'queen') c.queen = a;
      }
      if (!cs.queenAlive) c.queen.dead = true;
      for (const b of cs.brood) {
        c.brood.push({ ...b, carrier: null, claimed: null, ox: sim.rng.range(-0.35, 0.35), oy: sim.rng.range(-0.1, 0.25), dead: false, goal: null });
      }
      sim.colonies.push(c);
      if (cs.isPlayer) sim.player = c;
    }
    if (d.rival >= 0) sim.rival = sim.colonies[d.rival] ?? null;
    if (d.kin !== undefined && d.kin >= 0) sim.kin = sim.colonies[d.kin] ?? null;
    sim.sinceRain = d.sinceRain ?? sim.sinceRain;
    sim.history = d.history ?? [];
    sim.histStep = d.histStep ?? sim.histStep;
    sim.histLost = sim.player?.stats.lost ?? 0;
    // Saves from before aphids keep the herds the new world generated
    if (d.herds) sim.eco.herds = d.herds.map((h) => ({ ...h, owner: h.owner >= 0 ? sim.colonies[h.owner] ?? null : null, dig: null, visitors: 0 }));
    sim.corpses = d.corpses.map((c) => ({ at: c.at, nest: c.nest >= 0 ? sim.colonies[c.nest] ?? null : null, claimed: null, age: c.age, gone: false }));
    // Older saves keep the pits the new world generated
    if (d.danger) {
      const dg = sim.danger;
      dg.pits = d.danger.pits.map((p) => ({ ...p, victim: null }));
      dg.indexPits();
      dg.armyYear = d.danger.armyYear;
      const sw = d.danger.swarm;
      dg.swarm = sw ? { ...sw, raiding: sw.raiding >= 0 ? sim.colonies[sw.raiding] ?? null : null } : null;
    }
    sim.syncClock();
    return sim;
  } catch (err) {
    console.error('Could not load save', err);
    return null;
  }
}

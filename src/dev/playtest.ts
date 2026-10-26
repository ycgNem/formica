/**
 * Headless playtest harness: runs whole games without a browser, with a scripted
 * keeper, and checks the sim's invariants as it goes. Build and run with
 * `npm run playtest -- [seeds] [days] [strategy] [species] [rival] [abundance]`.
 */
import { W, H, DAY, TUNNEL } from '../config';
import { Sim, MILESTONES, type GameOptions } from '../sim';
import { Colony } from '../colony';
import type { SpeciesId } from '../species';
import type { BiomeId } from '../biome';

declare const process: { argv: string[]; exitCode?: number };

export type Strategy = 'idle' | 'feeder' | 'greedy' | 'smart';

interface Report {
  seed: number;
  species: string;
  days: number;
  end: string;
  peak: number;
  pop: number;
  firstWorker: number;
  pop50: number;
  pop250: number;
  flight: number;
  points: number;
  goals: number;
  deaths: Record<string, number>;
  issues: string[];
  brood: Record<string, number>;
  rain: number;
  maxWater: number;
  raidsOnUs: number;
  ourRaids: number;
  rivalPeak: number;
  missing: string[];
  /** Recruitment and sharing counts: tandem runs led, crops shared. */
  social: Record<string, number>;
  ms: number;
}

function check(sim: Sim, issues: Set<string>): void {
  const w = sim.world;
  for (const c of sim.colonies) {
    for (const k of ['sugar', 'protein', 'hunger', 'cap'] as const) {
      const v = c[k];
      if (!Number.isFinite(v)) issues.add(`${c.name}.${k} is ${v}`);
      else if (v < -1e-6) issues.add(`${c.name}.${k} negative (${v.toFixed(3)})`);
    }
    if (c.stored > c.cap + 1e-3) issues.add(`${c.name} stores over cap (${c.stored.toFixed(1)}/${c.cap})`);
    const workers = new Map<number, number>();
    for (const a of c.ants) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) issues.add(`ant position NaN (${a.intent})`);
      if (a.x < -2 || a.x > W + 2 || (a.intent !== 'fly' && (a.y < -40 || a.y > H + 1))) issues.add(`ant out of world (${a.intent} ${a.x.toFixed(1)},${a.y.toFixed(1)})`);
      if (a.under && w.cells[a.at] !== TUNNEL) issues.add(`ant underground in non-tunnel cell (${a.intent})`);
      if (!Number.isFinite(a.hp)) issues.add('ant hp NaN');
      if (a.job) workers.set(a.job.id, (workers.get(a.job.id) ?? 0) + 1);
      if (a.target >= 0 && w.reservedBy[a.target] !== a.id && a.intent === 'toDig') issues.add('digger lost its reservation');
    }
    for (const p of c.projects) {
      if (p.workers < 0) issues.add(`project workers negative (${p.kind})`);
      const real = workers.get(p.id) ?? 0;
      if (real !== p.workers) issues.add(`project worker count drift (${p.kind} says ${p.workers}, really ${real})`);
    }
    for (const b of c.brood) {
      if (!b.carrier && w.cells[b.cell] !== TUNNEL) issues.add('brood lying in non-tunnel cell');
    }
  }
  if (!Number.isFinite(sim.points)) issues.add('points NaN');
}

/** A simple keeper who spends points the way a careful player might. */
export function keeper(sim: Sim, strategy: Strategy): void {
  const p = sim.player;
  if (!p || !p.queenAlive || strategy === 'idle') return;
  const home = p.roots.length ? p.roots[0] % W : Math.round(p.queen.x);
  const side = (d: number): number => Math.max(5, Math.min(W - 6, home + d));
  const top = (x: number): number => sim.world.top[x] - 1;
  // Leaf over the entrance whenever it rains
  if (sim.weather.raining && !sim.isWinter && !sim.isCovered(home) && sim.points >= 10) sim.useTool('leaf', home, top(home));
  if (strategy === 'feeder' || strategy === 'smart') {
    if (p.sugar < p.cap * 0.25 && sim.points >= 5 && !sim.eco.food.some((f) => f.kind === 'sugar' && Math.abs(f.x - home) < 20)) sim.useTool('sugar', side(8), top(side(8)));
    if (p.protein < p.cap * 0.2 && sim.points >= 8 && !sim.eco.food.some((f) => f.kind === 'protein' && Math.abs(f.x - home) < 20)) sim.useTool('protein', side(-8), top(side(-8)));
  }
  if (strategy === 'smart') {
    // Defend when threatened, raid back when clearly stronger, plant a couple of bushes
    const r = sim.rival;
    p.focus = p.threat ? 'defend' : p.stored < p.cap * 0.4 ? 'forage' : 'expand';
    if (r && r.alive && !p.raid && p.canRaid(r) && p.workerCount >= 30 && p.strength() > r.strength() * 1.4) p.launchRaid(r);
    // Pebble the entrance while a raid is on its way
    if (r?.raid?.target === p && p.roots.length && !sim.isPlugged(p.roots[0]) && sim.points >= 15) sim.useTool('plug', home, top(home));
    // ...and every entrance when army ants are coming
    const sw = sim.danger.swarm;
    if (sw && sim.danger.threatens(p)) {
      for (const root of p.roots) {
        const ahead = ((root % W) - sw.x) * sw.dir;
        if (ahead > 0 && ahead < 40 && !sim.isPlugged(root) && sim.points >= 15) sim.useTool('plug', root % W, top(root % W));
      }
    }
    const bushes = sim.eco.plants.filter((q) => q.kind === 'berry').length;
    if (bushes < 3 && sim.points >= 60) sim.useTool('bush', side(14 + bushes * 7), top(side(14 + bushes * 7)));
  }
  if (strategy === 'greedy') {
    // Spend everything on food right by the entrance
    while (sim.points >= 8) {
      const x = side(sim.rng.chance(0.5) ? 6 : -6);
      if (sim.useTool(p.protein < p.sugar ? 'protein' : 'sugar', x, top(x))) break;
    }
  }
}

function run(opts: GameOptions, days: number, strategy: Strategy): Report {
  const t0 = Date.now();
  const seenAl = new WeakSet<object>();
  let alarms = 0;
  const critters: Record<string, number> = {};
  const sim = new Sim(opts);
  if (noDanger) {
    // Same world and RNG stream, minus the v1.7 dangers: for telling their effect apart
    sim.danger.pits = [];
    sim.danger.indexPits();
    sim.danger.armyYear = Infinity;
    sim.eco.birdT = sim.eco.centT = sim.eco.ladyT = Infinity;
  }
  const deaths: Record<string, number> = {};
  const where: Record<string, number> = {};
  const notes: string[] = [];
  const die = Colony.prototype.die;
  Colony.prototype.die = function (this: Colony, a, cause, killer = null) {
    if (!a.dead && this.isPlayer) deaths[cause] = (deaths[cause] ?? 0) + 1;
    if (!a.dead && this.isPlayer && trace && killer) where[`${a.under ? (sim.nestOwner(a.at) === this ? 'ourNest' : sim.nestOwner(a.at) ? 'theirNest' : 'tunnel') : 'surface'}:${a.intent}:${a.task}`] = (where[`${a.under ? (sim.nestOwner(a.at) === this ? 'ourNest' : sim.nestOwner(a.at) ? 'theirNest' : 'tunnel') : 'surface'}:${a.intent}:${a.task}`] ?? 0) + 1;
    if (!a.dead && this.isPlayer && cause === 'drowned' && notes.length < 4) {
      notes.push(`drowned d${(sim.time / DAY).toFixed(1)} rain=${sim.weather.raining} roots=${this.roots.map((r) => `${r % W}${sim.isCovered(r % W) ? 'c' : ''}${sim.isPlugged(r) ? 'p' : ''}`)} at=${a.at % W},${Math.floor(a.at / W)} ${a.intent}/${a.task} water=${sim.world.waterCount}`);
    }
    die.call(this, a, cause, killer);
  };
  const issues = new Set<string>();
  sim.releaseQueen(Math.round(W * (0.3 + sim.rng.next() * 0.4)));
  const rep: Report = {
    seed: opts.seed, species: opts.species, days: 0, end: 'running', peak: 0, pop: 0, firstWorker: -1, pop50: -1, pop250: -1, flight: -1,
    points: 0, goals: 0, deaths, issues: [], brood: {}, rain: 0, maxWater: 0, raidsOnUs: 0, ourRaids: 0, rivalPeak: 0, missing: [], social: {}, ms: 0,
  };
  const kb = (Colony.prototype as unknown as { killBrood: (b: { wet: number; starve: number; dead: boolean }, cause?: string) => void }).killBrood;
  (Colony.prototype as unknown as { killBrood: typeof kb }).killBrood = function (this: Colony, b, cause) {
    if (!b.dead && this.isPlayer) {
      const why = cause || ((b as unknown as { stage: number }).stage > 2 ? 'hatched' : b.wet > 14 ? 'drowned' : b.starve > 50 ? 'starved' : this.queenAlive ? 'other' : 'orphaned');
      rep.brood[why] = (rep.brood[why] ?? 0) + 1;
    }
    kb.call(this, b, cause);
  };
  const dt = 1 / 20;
  const steps = Math.round((days * DAY) / dt);
  let crash = '';
  for (let k = 0; k < steps; k++) {
    try {
      sim.update(dt);
    } catch (e) {
      crash = String((e as Error).stack ?? e).split('\n').slice(0, 4).join(' | ');
      break;
    }
    if (k % 20 === 0) {
      keeper(sim, strategy);
      const p = sim.player!;
      const day = sim.time / DAY;
      if (rep.firstWorker < 0 && p.stats.born > 0) rep.firstWorker = +day.toFixed(2);
      if (rep.pop50 < 0 && p.pop >= 50) rep.pop50 = +day.toFixed(2);
      if (rep.pop250 < 0 && p.pop >= 250) rep.pop250 = +day.toFixed(2);
      if (rep.flight < 0 && sim.milestones.has('flight')) rep.flight = +day.toFixed(2);
      for (const e of sim.events.splice(0)) {
        if (e.kind === 'gameover') rep.end = e.text;
        if (e.kind === 'rain') rep.rain++;
        if (e.kind === 'raid') rep.raidsOnUs++;
      }
      rep.maxWater = Math.max(rep.maxWater, sim.world.waterCount);
      if (sim.rival) rep.rivalPeak = Math.max(rep.rivalPeak, sim.rival.pop);
      if (trace && k % Math.round(DAY / 4 / dt) === 0) {
        const kinds = sim.eco.critters.map((c) => c.kind).join(',');
        const near = sim.eco.food.filter((f) => !f.gone && Math.abs(f.x - (p.roots.length ? p.roots[0] % W : 0)) < 40).map((f) => `${f.kind[0]}${Math.round(f.amount)}`).join('');
        const unr = p.ants.filter((a) => a.under && sim.world.dist[a.at] < 0).length;
        const pr = p as unknown as { digSlots: number };
        console.error(`d${day.toFixed(2)} act${p.active.length}/${p.active.filter((q) => q.priority).length}/${p.projects.length} slots${pr.digSlots} cap${p.cap} wn${p.winterNeed().toFixed(0)} dug${p.stats.dug} focus${p.focus} pts${Math.round(sim.points)} unrouted${unr} roots${p.roots.map((r) => `${r % W}:${sim.world.dist[r]}${sim.isPlugged(r) ? 'p' : ''}${sim.isCovered(r % W) ? 'c' : ''}`)} near[${near}] pop${p.pop} w${p.workerCount} brood${p.brood.length} sugar${p.sugar.toFixed(0)} prot${p.protein.toFixed(1)} known${p.known.size} forage${p.counts.forage} out${p.ants.filter((a) => !a.under).length} deaths${JSON.stringify(deaths)} crit[${kinds}] rival${sim.rival?.pop ?? '-'} raid${p.raid?.phase ?? '-'} rraid${sim.rival?.raid?.phase ?? '-'} threat${p.threat ? (p.threat.under ? 'U' : 'S') : '-'} tasks${JSON.stringify(p.counts)} intents${JSON.stringify(p.ants.reduce((m: Record<string, number>, a) => ((m[a.intent] = (m[a.intent] ?? 0) + 1), m), {}))} where${JSON.stringify(where)}`);
      }
      for (const c of sim.eco.critters) if (!seenAl.has(c)) {
        seenAl.add(c);
        critters[c.kind] = (critters[c.kind] ?? 0) + 1;
      }
      for (const al of sim.alarms) if (al.colony === p && !seenAl.has(al)) {
        seenAl.add(al);
        alarms++;
      }
    }
    if (k % 200 === 0) check(sim, issues);
    if (sim.over) break;
  }
  Colony.prototype.die = die;
  (Colony.prototype as unknown as { killBrood: typeof kb }).killBrood = kb;
  for (const e of sim.events.splice(0)) if (e.kind === 'gameover') rep.end = e.text;
  const p = sim.player!;
  rep.missing = MILESTONES.filter((m) => !sim.milestones.has(m.id)).map((m) => m.id);
  rep.days = +(sim.time / DAY).toFixed(2);
  if (crash) rep.end = `CRASH ${crash}`;
  else if (!sim.over) rep.end = p.queenAlive ? 'alive' : 'queen dead';
  rep.peak = p.stats.peak;
  rep.pop = p.pop;
  rep.points = sim.points;
  rep.goals = sim.milestones.size;
  rep.social = { tandems: p.tandems, shared: p.stats.shared, alarms, rescued: p.stats.rescued, trapped: p.stats.trapped, ...critters, armyYear: sim.danger.armyYear };
  rep.issues = [...issues, ...notes];
  rep.ms = Date.now() - t0;
  return rep;
}

// Probe scripts import keeper() and skip the command line run
const main = /playtest\.(mjs|ts)$/.test(process.argv[1] ?? '');
const [seedsArg = '3', daysArg = '24', strat = 'feeder', species = 'lasius', rival = 'calm', abundance = 'normal', flags = ''] = main ? process.argv.slice(2) : [];
const noDanger = flags.includes('nodanger');
const trace = flags.includes('trace');
const biomeArg = (/biome=(\w+)/.exec(flags)?.[1] ?? 'meadow') as BiomeId;
const seeds = main ? Number(seedsArg) : 0;
const only = /only=(\d+)/.exec(flags);
for (let i = 0; i < seeds; i++) {
  if (only && i !== Number(only[1])) continue;
  const seed = 1000 + i * 7919;
  const r = run({ species: species as SpeciesId, rival: rival as GameOptions['rival'], abundance: abundance as GameOptions['abundance'], biome: biomeArg, seed, name: 'Test' }, Number(daysArg), strat as Strategy);
  console.log(JSON.stringify(r));
}

import type { Colony, Project, Brood } from './colony';
import type { FoodSource, Critter, Herd } from './ecology';
import type { Corpse } from './sim';
import type { Rng } from './rng';

export type Caste = 'queen' | 'worker' | 'soldier' | 'alate' | 'replete';
export type Task = 'none' | 'dig' | 'forage' | 'nurse' | 'clean' | 'guard' | 'raid';
export type Intent =
  | 'found' | 'work' | 'toDig' | 'digging' | 'dump' | 'idle' | 'patrol' | 'home' | 'rest'
  | 'scout' | 'toFood' | 'carryFood' | 'toBrood' | 'carryBrood' | 'toCorpse' | 'carryCorpse'
  | 'toThreat' | 'fight' | 'toFlight' | 'fly' | 'share' | 'toHerd' | 'hang' | 'tandem' | 'trapped' | 'raft';

export const LOAD_NONE = 0;
export const LOAD_SUGAR = 1;
export const LOAD_PROTEIN = 2;
export const LOAD_BROOD = 3;
export const LOAD_CORPSE = 4;
export const LOAD_SEED = 5;

export const INTENT_TEXT: Record<Intent, string> = {
  found: 'Looking for a nest site',
  work: 'Looking for work',
  toDig: 'Heading to the dig face',
  digging: 'Digging',
  dump: 'Hauling soil out',
  idle: 'Resting',
  patrol: 'Patrolling',
  home: 'Heading home',
  rest: 'Tending her eggs',
  scout: 'Scouting for food',
  toFood: 'Going to food',
  carryFood: 'Bringing food home',
  toBrood: 'Fetching brood',
  carryBrood: 'Carrying brood',
  toCorpse: 'Fetching the dead',
  carryCorpse: 'Carrying the dead to the midden',
  toThreat: 'Rushing to fight',
  fight: 'Fighting!',
  toFlight: 'Climbing out to fly',
  fly: 'Flying away',
  share: 'Sharing food mouth to mouth',
  toHerd: 'Going to milk the aphids',
  hang: 'Hanging from the ceiling, full of honey',
  tandem: 'Following a nestmate to food (tandem run)',
  trapped: 'Caught in an antlion pit!',
  raft: 'Holding on in a living raft',
};

export const TASK_TEXT: Record<Task, string> = {
  none: 'Unassigned',
  dig: 'Digger',
  forage: 'Forager',
  nurse: 'Nurse',
  clean: 'Undertaker',
  guard: 'Guard',
  raid: 'Raider',
};

export const CASTE_TEXT: Record<Caste, string> = {
  queen: 'Queen',
  worker: 'Worker',
  soldier: 'Soldier',
  alate: 'Winged alate',
  replete: 'Replete',
};

/** Health and bite of each caste, relative to a worker of the same species. */
export const CASTE_HP: Record<Caste, number> = { queen: 20, worker: 1, soldier: 3, alate: 1.5, replete: 2 };
export const CASTE_ATK: Record<Caste, number> = { queen: 1.5, worker: 1, soldier: 2.2, alate: 0.4, replete: 0.3 };

/** Tasks a worker can take up by herself, in threshold order. */
export const TASKS = ['dig', 'forage', 'nurse', 'clean', 'guard'] as const;
export type WorkTask = (typeof TASKS)[number];

/** Age bands: young ants nurse deep in the nest, middle-aged ones build, old ones forage and guard. */
export type Band = 'nurse' | 'builder' | 'forager';
export const BAND_TEXT: Record<Band, string> = { nurse: 'Young nurse', builder: 'Builder', forager: 'Veteran forager' };
const SPECIALIST: Record<WorkTask, string> = {
  dig: 'Obsessive digger', forage: 'Tireless forager', nurse: 'Devoted nurse', clean: 'Dutiful undertaker', guard: 'Vigilant guard',
};

const NAMES = [
  'Bertha', 'Agnes', 'Mabel', 'Hilda', 'Ivy', 'Opal', 'Fern', 'Hazel', 'Mildred', 'Edna', 'Gertie', 'Maude', 'Ruth', 'Winnie', 'Clara',
  'Doris', 'Elsie', 'Flora', 'Greta', 'Hattie', 'Iris', 'June', 'Kit', 'Lottie', 'Martha', 'Nell', 'Olive', 'Pearl', 'Rosa', 'Sadie',
  'Tilly', 'Una', 'Vera', 'Wren', 'Ada', 'Bea', 'Cora', 'Dot', 'Effie', 'Freda', 'Goldie', 'Hester', 'Ida', 'Jo', 'Kay', 'Lena', 'Mae',
  'Nora', 'Oona', 'Peg', 'Queenie', 'Rita', 'Sal', 'Tess', 'Ursa', 'Viv', 'Wilma', 'Xena', 'Yara', 'Zelda', 'Aggie', 'Birdie', 'Cissy',
  'Della', 'Etta', 'Fanny', 'Gwen', 'Honor', 'Inez', 'Jem', 'Lou', 'Minnie', 'Nan', 'Ottilie', 'Prue', 'Rue', 'Sybil', 'Thea', 'Violet',
  'Willa', 'Bunty', 'Coral', 'Dinah', 'Enid', 'Faye', 'Gilda', 'Hen', 'Isla', 'Juno', 'Lark', 'Moss', 'Nettle', 'Poppy', 'Sorrel', 'Tansy',
];

/** A stable little name for an ant, from her id. */
export function antName(id: number): string {
  return NAMES[(Math.imul(id + 7, 2654435761) >>> 0) % NAMES.length];
}

/** One stretch of travel, either through tunnel cells or along surface columns. */
export interface Leg {
  under: boolean;
  pts: number[];
}

export class Ant {
  /** Position in cell units (cell centres sit on .5). */
  x = 0;
  y = 0;
  hx = 1;
  hy = 0;
  under = false;
  /** Underground: current cell index. On the surface: current column. */
  at = 0;
  legs: Leg[] = [];
  legI = 0;
  ptI = 0;
  intent: Intent = 'idle';
  wait = 0;
  /** Digging */
  job: Project | null = null;
  target = -1;
  stand = -1;
  carry = 0;
  task: Task = 'none';
  taskT = 0;
  load = LOAD_NONE;
  /** Sugar travels in the crop (the social stomach); protein in the mandibles. */
  loadAmt = 0;
  /** This crop-full has already been offered to a nestmate at the entrance. */
  relayed = false;
  /** How strong a trail she lays on the way home: richer food, stronger scent. */
  trailQ = 0;
  /** She found this food herself, and will lead a nestmate back to it. */
  fresh = false;
  /** Winged males are small and dark, and die after the flight; the rest of the alates are young queens. */
  male = false;
  brood: Brood | null = null;
  corpse: Corpse | null = null;
  food: FoodSource | null = null;
  herd: Herd | null = null;
  foeAnt: Ant | null = null;
  foeCritter: Critter | null = null;
  /** How many enemies are on this ant in the current combat tick. */
  beset = 0;
  hitT = 0;
  hp = 10;
  maxHp = 10;
  atk = 3;
  age = 0;
  life = 1;
  wet = 0;
  dead = false;
  /** Leg animation phase, advanced by distance walked. */
  walk = 0;
  /** Physiological age, 0..1 of her life. Runs ahead of real age if she's pushed into foraging young, and never goes back. */
  phys = 0;
  /** Response threshold per task (TASKS order): she takes a job up once its stimulus beats her threshold. Doing a job lowers it. */
  readonly th = new Float32Array(TASKS.length);
  /** Times she has taken up each task. */
  readonly done = new Uint16Array(TASKS.length);
  /** Small fixed offset so ants don't stack into one line. */
  readonly ox: number;
  readonly oy: number;

  /** Caste is fixed at birth, except that a young honeypot worker can swell into a replete. */
  constructor(readonly id: number, readonly colony: Colony, public caste: Caste, rng: Rng) {
    this.ox = rng.range(-0.3, 0.3);
    this.oy = rng.range(-0.25, 0.25);
    this.walk = rng.range(0, 6);
    for (let k = 0; k < TASKS.length; k++) this.th[k] = rng.range(0.05, 0.55);
    // Now and then an ant is born with a calling
    if (rng.chance(0.12)) this.th[rng.int(0, TASKS.length - 1)] = rng.range(0.01, 0.06);
  }

  get band(): Band {
    return this.phys < 0.3 ? 'nurse' : this.phys < 0.6 ? 'builder' : 'forager';
  }

  get name(): string {
    return antName(this.id);
  }

  /** "Winged male" or "Young queen" for alates, else the caste. */
  get casteName(): string {
    return this.caste === 'alate' ? (this.male ? 'Winged male' : 'Young queen') : CASTE_TEXT[this.caste];
  }

  /** "Obsessive digger" once she has really settled into one job, else her age band. */
  get calling(): string {
    let best = 0;
    for (let k = 1; k < TASKS.length; k++) if (this.th[k] < this.th[best]) best = k;
    return this.th[best] < 0.12 && this.done[best] >= 6 ? SPECIALIST[TASKS[best]] : BAND_TEXT[this.band];
  }
}

export type SpeciesId = 'lasius' | 'camponotus' | 'pheidole' | 'solenopsis' | 'honeypot';

export interface Species {
  id: SpeciesId;
  name: string;
  latin: string;
  blurb: string;
  /** Worker body colour, queen colour, and UI / trail accent. */
  color: string;
  queen: string;
  ui: string;
  size: number;
  speed: number;
  dig: number;
  /** Seconds between eggs when the queen is well fed. */
  layInterval: number;
  /** Multiplier on brood development time. */
  brood: number;
  /** Worker lifespan in days. */
  life: number;
  hp: number;
  atk: number;
  /** Share of eggs that become soldiers once the colony is established. */
  soldierShare: number;
  soldierHead: number;
  /** Sugar eaten per ant per day. */
  appetite: number;
  carry: number;
  /** Some workers become repletes: living honey jars hanging in the food stores. */
  repletes: boolean;
  /** When the nest floods, the workers link up into a floating raft and carry the queen to high ground. */
  rafts: boolean;
  ratings: { growth: number; strength: number; digging: number; lifespan: number };
}

export const SPECIES: Record<SpeciesId, Species> = {
  lasius: {
    id: 'lasius',
    name: 'Black garden ant',
    latin: 'Lasius niger',
    blurb: 'Hardy, fast-growing and tireless diggers. No soldier caste, so sheer numbers are their defence.',
    color: '#2a1d17',
    queen: '#3e2b22',
    ui: '#4a5a86',
    size: 1,
    speed: 1,
    dig: 1.2,
    layInterval: 3.4,
    brood: 0.9,
    life: 9,
    hp: 10,
    atk: 3.5,
    soldierShare: 0,
    soldierHead: 1,
    appetite: 0.5,
    carry: 1,
    repletes: false,
    rafts: false,
    ratings: { growth: 5, strength: 2, digging: 5, lifespan: 3 },
  },
  camponotus: {
    id: 'camponotus',
    name: 'Carpenter ant',
    latin: 'Camponotus pennsylvanicus',
    blurb: 'Big, strong and long-lived. Slow to get going, but each forager hauls double and majors guard the nest.',
    color: '#191514',
    queen: '#2f2420',
    ui: '#8a5a2b',
    size: 1.3,
    speed: 0.9,
    dig: 0.85,
    layInterval: 5.6,
    brood: 1.2,
    life: 14,
    hp: 18,
    atk: 6,
    soldierShare: 0.14,
    soldierHead: 1.35,
    appetite: 0.75,
    carry: 2,
    repletes: false,
    rafts: false,
    ratings: { growth: 2, strength: 4, digging: 3, lifespan: 5 },
  },
  pheidole: {
    id: 'pheidole',
    name: 'Big-headed ant',
    latin: 'Pheidole megacephala',
    blurb: 'Tiny workers backed by huge-headed majors that guard the nest and crack stored seeds. Quick brood, short lives.',
    color: '#6b3f22',
    queen: '#7d4a2a',
    ui: '#c27a35',
    size: 0.85,
    speed: 1.05,
    dig: 1,
    layInterval: 3.6,
    brood: 0.85,
    life: 7,
    hp: 7,
    atk: 3,
    soldierShare: 0.22,
    soldierHead: 1.6,
    appetite: 0.45,
    carry: 1,
    repletes: false,
    rafts: false,
    ratings: { growth: 4, strength: 4, digging: 3, lifespan: 2 },
  },
  solenopsis: {
    id: 'solenopsis',
    name: 'Fire ant',
    latin: 'Solenopsis invicta',
    blurb: 'Aggressive, fast-breeding and armed with a painful sting. When the nest floods they link legs into a living raft.',
    color: '#9a3a1e',
    queen: '#b4482a',
    ui: '#c8452d',
    size: 0.95,
    speed: 1.1,
    dig: 1.05,
    layInterval: 3.1,
    brood: 0.85,
    life: 7,
    hp: 9,
    atk: 6,
    soldierShare: 0.08,
    soldierHead: 1.25,
    appetite: 0.7,
    carry: 1,
    repletes: false,
    rafts: true,
    ratings: { growth: 5, strength: 4, digging: 4, lifespan: 2 },
  },
  honeypot: {
    id: 'honeypot',
    name: 'Honeypot ant',
    latin: 'Myrmecocystus mexicanus',
    blurb: 'Some workers swell into repletes, living honey jars that hang in the stores and carry the colony through hard times.',
    color: '#6e3f1a',
    queen: '#83501f',
    ui: '#d39a2a',
    size: 1.05,
    speed: 1.1,
    dig: 0.95,
    layInterval: 4.2,
    brood: 1,
    life: 11,
    hp: 9,
    atk: 3,
    soldierShare: 0,
    soldierHead: 1,
    appetite: 0.55,
    carry: 1.5,
    repletes: true,
    rafts: false,
    ratings: { growth: 3, strength: 2, digging: 3, lifespan: 4 },
  },
};

export const SPECIES_LIST: Species[] = Object.values(SPECIES);

import type { ZoneKind } from './layout';
import type { CritterKind } from './ecology';

export type BiomeId = 'meadow' | 'woodland' | 'dunes' | 'riverbank';

type RGB = [number, number, number];

/**
 * Where the colony lives [v1.2]. A biome swaps the soil palette, the plants and
 * critters, the weather and what the soil itself does: sand digs fast but caves
 * in, river silt sits on a high water table, the woodland floor has rotting
 * logs that carpenter ants chew straight through.
 */
export interface Biome {
  id: BiomeId;
  name: string;
  blurb: string;
  /** Card accent in the new-game menu. */
  ui: string;
  /** Zones laid across the map, shuffled per seed. */
  zones: ZoneKind[];
  /** Topsoil, loam, clay, deep layer and bedrock colours. */
  strata: RGB[];
  /** Grass lip per season (light, dark), or null for the meadow's. */
  lip: [RGB, RGB][] | null;
  /** How hilly the ground is, and how many stones are buried in it (meadow = 1). */
  relief: number;
  rocks: number;
  /** Digging speed in this soil. */
  dig: number;
  /** Showers come this many times as often, and pour in this much harder. */
  rain: number;
  flood: number;
  /** Surface temperature offset, and extra day-night swing (°C). */
  heat: number;
  swing: number;
  /** Tunnels deeper than this many rows below the surface sit in groundwater; 0 = no water table. */
  waterTable: number;
  /** Shallow sand tunnels cave in now and then and have to be dug out again. */
  collapse: boolean;
  /** Fruit trees (× the usual), antlion pits, fallen logs. */
  fruitTrees: number;
  pits: number;
  logs: number;
  /** Critter spawn rates (× the meadow's). */
  critters: Partial<Record<CritterKind, number>>;
  /** Seeds and dead insects turn up this many times as often. */
  seeds: number;
  carrion: number;
  /** Share of the meadow's grass blades. */
  grass: number;
}

const SNOW: [RGB, RGB] = [[245, 249, 252], [210, 222, 234]];

export const BIOMES: Record<BiomeId, Biome> = {
  meadow: {
    id: 'meadow',
    name: 'Meadow',
    blurb: 'Open grassland with a woodland edge. Fruit trees, flowers and a bit of everything. The balanced start.',
    ui: '#6aa84f',
    zones: ['woods', 'meadow', 'stony', 'bramble', 'meadow'],
    strata: [[116, 80, 54], [148, 104, 68], [174, 122, 78], [150, 118, 90], [100, 95, 92]],
    lip: null,
    relief: 1,
    rocks: 1,
    dig: 1,
    rain: 1,
    flood: 1,
    heat: 0,
    swing: 0,
    waterTable: 0,
    collapse: false,
    fruitTrees: 1,
    pits: 2,
    logs: 0,
    critters: {},
    seeds: 1,
    carrion: 1,
    grass: 1,
  },
  woodland: {
    id: 'woodland',
    name: 'Woodland floor',
    blurb: 'Shady and cool under the trees. Rotting logs carpenter ants tunnel straight into, leaf litter that hides foragers from birds, and more centipedes.',
    ui: '#7a5a3a',
    zones: ['woods', 'bramble', 'woods', 'meadow', 'woods'],
    strata: [[78, 54, 38], [104, 74, 50], [134, 96, 64], [124, 98, 78], [96, 92, 90]],
    lip: [[[134, 152, 72], [96, 112, 52]], [[112, 132, 60], [80, 98, 44]], [[192, 124, 62], [152, 92, 46]], SNOW],
    relief: 1.1,
    rocks: 0.9,
    dig: 1,
    rain: 1,
    flood: 0.7,
    heat: -2,
    swing: -1.5,
    waterTable: 0,
    collapse: false,
    fruitTrees: 0.6,
    pits: 0,
    logs: 4,
    critters: { centipede: 2, beetle: 1.4, spider: 1.2, bird: 0.5, ladybird: 0.7, caterpillar: 1.2 },
    seeds: 0.5,
    carrion: 1.4,
    grass: 0.55,
  },
  dunes: {
    id: 'dunes',
    name: 'Sandy dunes',
    blurb: 'Sand digs fast but caves in, so tunnels need digging out again. Hot days, rare rain that comes as flash floods, and antlion pits everywhere.',
    ui: '#d8b26a',
    zones: ['dune', 'dune', 'stony', 'dune', 'meadow'],
    strata: [[206, 172, 114], [214, 184, 126], [198, 162, 106], [178, 148, 102], [122, 112, 102]],
    lip: [[[214, 204, 132], [176, 166, 98]], [[222, 204, 144], [190, 168, 110]], [[226, 196, 136], [194, 160, 104]], SNOW],
    relief: 2.2,
    rocks: 0.35,
    dig: 1.4,
    rain: 0.45,
    flood: 1.9,
    heat: 5,
    swing: 4,
    waterTable: 0,
    collapse: true,
    fruitTrees: 0.5,
    pits: 7,
    logs: 0,
    critters: { bird: 1.2, caterpillar: 0.4, ladybird: 0.5, beetle: 1.3, centipede: 0.6 },
    seeds: 2,
    carrion: 1.6,
    grass: 0.3,
  },
  riverbank: {
    id: 'riverbank',
    name: 'Riverbank',
    blurb: 'Lush reeds on heavy silt over a high water table: dig deep and the tunnels fill with groundwater. Wet weather and floods. Fire ants raft through them.',
    ui: '#4f8fb0',
    zones: ['reeds', 'meadow', 'reeds', 'woods', 'meadow'],
    strata: [[98, 86, 68], [120, 104, 82], [134, 118, 94], [112, 106, 96], [92, 90, 88]],
    lip: [[[132, 214, 100], [88, 172, 70]], [[110, 198, 86], [72, 154, 58]], [[200, 170, 84], [160, 126, 58]], SNOW],
    relief: 0.6,
    rocks: 0.6,
    dig: 0.85,
    rain: 1.5,
    flood: 1.4,
    heat: -1,
    swing: -1,
    waterTable: 34,
    collapse: false,
    fruitTrees: 1,
    pits: 0,
    logs: 1,
    critters: { ladybird: 1.5, caterpillar: 1.5, bird: 1.3, centipede: 0.8 },
    seeds: 1,
    carrion: 1,
    grass: 1.2,
  },
};

export const BIOME_LIST: Biome[] = [BIOMES.meadow, BIOMES.woodland, BIOMES.dunes, BIOMES.riverbank];

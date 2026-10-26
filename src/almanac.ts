import { SPECIES_LIST, type SpeciesId } from './species';
import { BIOME_LIST, type BiomeId } from './biome';
import type { CritterKind } from './ecology';
import type { Sim } from './sim';

export type AlmanacGroup = 'Ants' | 'Creatures' | 'Places' | 'Behaviour';

export interface AlmanacEntry {
  id: string;
  group: AlmanacGroup;
  title: string;
  /** Shown once it's unlocked. */
  text: string;
  /** Shown while it's locked. */
  hint: string;
  /** Seen in this game yet? Checked about once a second. */
  seen: (s: Sim) => boolean;
}

const SPECIES_NOTES: Record<SpeciesId, string> = {
  lasius: 'The black garden ant of lawns and pavements across Europe. A new queen seals herself in alone and raises her first tiny workers on her own body reserves. Colonies farm root aphids for honeydew, and a queen can live nearly thirty years.',
  camponotus: 'Carpenter ants don\'t eat wood: they carve their galleries in it, especially wood that is already soft with rot. Big, slow-growing colonies with a range of worker sizes, from small minors to heavy-jawed majors.',
  pheidole: 'Big-headed ants have two very different workers: tiny minors that do most of the work, and majors with huge heads full of muscle, used for cracking seeds and blocking the nest entrance.',
  solenopsis: 'Red imported fire ants sting, breed fast and spread fast. When floods come they link legs into a waterproof raft, with the queen and brood in the middle, and float until they reach dry land.',
  honeypot: 'In good times some honeypot workers are fed so much nectar that their abdomens swell like grapes. These repletes hang from the ceiling as living jars, and give the food back mouth to mouth in lean times.',
};

const BIOME_NOTES: Record<BiomeId, string> = {
  meadow: 'Grassland with a woodland edge: a bit of everything, and the easiest place to start a colony.',
  woodland: 'Cool and shady. Fallen logs rot slowly into soft wood, leaf litter hides foragers from birds, and centipedes hunt in the damp soil.',
  dunes: 'Sand is quick to dig but loose: tunnels slump and have to be dug out again. Rain is rare but comes all at once, and antlions build their pits in the open sand.',
  riverbank: 'Heavy silt over a high water table. Dig too deep and the tunnels fill with groundwater; heavy rain brings floods.',
};

const CRITTER_NOTES: Record<CritterKind, [string, string]> = {
  beetle: ['Ground beetle', 'Armoured hunters of the soil surface. Too tough for one ant, but a crowd can pin its legs and bring it down, and then it feeds the brood for days.'],
  caterpillar: ['Caterpillar', 'Soft, slow and full of protein. Many ants hunt them, and some caterpillars have struck deals with ants instead, trading sugary secretions for protection.'],
  spider: ['Wolf spider', 'Wolf spiders don\'t spin webs: they run their prey down. A forager on her own is easy prey, so ants answer an attack with alarm scent and come in numbers.'],
  centipede: ['Centipede', 'Fast, venomous predators of the dark soil that slip into ant nests after the brood. Nestmates mob them, biting at the legs.'],
  bird: ['Robin', 'Robins and other ground birds pick ants off open ground. Ants that keep under plants or leaf litter are much harder to spot.'],
  ladybird: ['Ladybird', 'A ladybird and its larvae can eat hundreds of aphids. Ants guarding their herds chase ladybirds off, and some ladybird larvae hide under a coat of wax to sneak in.'],
};

const critter = (k: CritterKind) => (s: Sim): boolean => s.eco.critters.some((c) => c.kind === k && !c.dead);

export const ALMANAC: AlmanacEntry[] = [
  ...SPECIES_LIST.map((sp): AlmanacEntry => ({
    id: `sp_${sp.id}`,
    group: 'Ants',
    title: `${sp.name} (${sp.latin})`,
    text: SPECIES_NOTES[sp.id],
    hint: 'Raise this species, or meet it as a rival.',
    seen: (s) => s.colonies.some((c) => c.species.id === sp.id),
  })),
  ...(Object.keys(CRITTER_NOTES) as CritterKind[]).map((k): AlmanacEntry => ({
    id: `cr_${k}`,
    group: 'Creatures',
    title: CRITTER_NOTES[k][0],
    text: CRITTER_NOTES[k][1],
    hint: 'Turns up in some games. Keep an eye on the meadow.',
    seen: critter(k),
  })),
  {
    id: 'aphids', group: 'Creatures', title: 'Root aphids',
    text: 'Aphids suck sap from plant roots and give off sweet honeydew. Garden ants guard and "milk" them by stroking them with their antennae, and even carry aphid eggs into the nest to keep them over winter.',
    hint: 'Find aphids on the roots of a plant.',
    seen: (s) => s.eco.herds.some((h) => h.owner === s.player),
  },
  {
    id: 'antlion', group: 'Creatures', title: 'Antlion',
    text: 'The larva of a lacewing-like insect. It digs a cone in loose sand and waits buried at the bottom; an ant that slips in is showered with sand until she slides into its jaws.',
    hint: 'Watch an ant blunder into a sandy pit.',
    seen: (s) => !!s.player && s.player.stats.trapped > 0,
  },
  {
    id: 'army', group: 'Creatures', title: 'Army ants',
    text: 'Army ants have no fixed nest. The colony marches in columns of hundreds of thousands, eating whatever can\'t get away, and raids other ant nests for their brood. A blocked entrance turns them away.',
    hint: 'A raiding column passes through in summer, when there is a colony worth raiding.',
    seen: (s) => !!s.danger.swarm,
  },
  ...BIOME_LIST.map((b): AlmanacEntry => ({
    id: `bi_${b.id}`,
    group: 'Places',
    title: b.name,
    text: BIOME_NOTES[b.id],
    hint: 'Start a colony here.',
    seen: (s) => s.biome.id === b.id && !!s.player,
  })),
  {
    id: 'founding', group: 'Behaviour', title: 'Claustral founding',
    text: 'After her mating flight a queen breaks off her wings, digs a small chamber and seals herself in. She raises her first workers alone, living off the muscles that once powered her wings.',
    hint: 'Release a queen.',
    seen: (s) => !!s.player?.settled,
  },
  {
    id: 'polyethism', group: 'Behaviour', title: 'Age polyethism',
    text: 'Young workers nurse deep in the nest, then dig and build, and only the oldest forage outside, where life is most dangerous. If foragers die, young ants grow up fast to replace them.',
    hint: 'Raise a few dozen workers.',
    seen: (s) => !!s.player && s.player.workerCount >= 30,
  },
  {
    id: 'thresholds', group: 'Behaviour', title: 'Response thresholds',
    text: 'Nobody gives orders. Each worker has her own threshold for each job and takes it up when the need for it gets strong enough, so the work divides itself, and specialists emerge from ants who just kept doing one thing.',
    hint: 'Find an ant with a calling in the inspector.',
    seen: (s) => !!s.player && s.player.ants.some((a) => a.caste === 'worker' && a.th.some((t, k) => t < 0.12 && a.done[k] >= 6)),
  },
  {
    id: 'trophallaxis', group: 'Behaviour', title: 'Trophallaxis',
    text: 'Ants share liquid food mouth to mouth. Foragers fill their crops, a "social stomach", and pass the food along, so the whole colony\'s crops act as one shared store.',
    hint: 'Watch foragers share food at the entrance.',
    seen: (s) => !!s.player && s.player.stats.shared > 0,
  },
  {
    id: 'tandem', group: 'Behaviour', title: 'Tandem running',
    text: 'A small colony recruits one ant at a time: a forager who found food leads a nestmate there, waiting for her follower to tap her legs before going on.',
    hint: 'A forager in a small colony finds new food.',
    seen: (s) => !!s.player && s.player.tandems > 0,
  },
  {
    id: 'trails', group: 'Behaviour', title: 'Mass recruitment',
    text: 'Bigger colonies lay scent trails from food to the nest. Rich food gets a strong trail, the trail fades if nobody renews it, and a strong trail pulls in crowds. Press P to see them.',
    hint: 'Grow past a hundred workers.',
    seen: (s) => !!s.player && s.player.workerCount >= 100,
  },
  {
    id: 'alarm', group: 'Behaviour', title: 'Alarm pheromone',
    text: 'An ant under attack releases alarm scent from glands in her head. Nestmates nearby rush in, jaws open, which is why one bite can bring out a swarm.',
    hint: 'Watch your ants answer an attack.',
    seen: (s) => s.alarms.some((a) => a.colony === s.player),
  },
  {
    id: 'necrophoresis', group: 'Behaviour', title: 'Necrophoresis',
    text: 'A dead ant smells of oleic acid. Undertakers carry the dead out to a midden, a rubbish heap away from the brood, which keeps disease out of the nest.',
    hint: 'Lose an ant underground.',
    seen: (s) => !!s.player && s.player.ants.some((a) => a.intent === 'carryCorpse'),
  },
  {
    id: 'thermo', group: 'Behaviour', title: 'Brood thermoregulation',
    text: 'Nurses carry the brood up toward the warm surface by day and back down at night, so the larvae and pupae grow as fast as they can. Press P twice to see the soil\'s warmth.',
    hint: 'Dig more than one nursery.',
    seen: (s) => !!s.player && s.player.brood.some((b) => b.goal !== null),
  },
  {
    id: 'repletes', group: 'Behaviour', title: 'Repletes',
    text: 'Living honey jars. A replete hangs from the chamber ceiling with her abdomen stretched thin and golden, and feeds her sisters mouth to mouth when food runs short.',
    hint: 'Keep honeypot ants with full stores.',
    seen: (s) => !!s.player && s.player.repleteCount > 0,
  },
  {
    id: 'granary', group: 'Behaviour', title: 'Granaries',
    text: 'Seed-harvesting ants store seeds in dry chambers. The big-headed majors crack them open, and the colony eats through its grain store all winter.',
    hint: 'Gather seeds in autumn.',
    seen: (s) => !!s.player && s.player.seeds > 0,
  },
  {
    id: 'raft', group: 'Behaviour', title: 'Living rafts',
    text: 'Fire ants caught in a flood grip each other\'s legs and jaws to make a raft that traps air and floats. The queen rides in the middle, and the brood helps keep it up.',
    hint: 'Keep fire ants through a flood.',
    seen: (s) => !!s.player && s.player.stats.rafts > 0,
  },
  {
    id: 'winter', group: 'Behaviour', title: 'Overwintering',
    text: 'In winter the colony stops laying, clusters deep where the soil stays warmest, and lives off its stores. Activity almost stops until spring.',
    hint: 'Reach winter.',
    seen: (s) => s.isWinter && !!s.player?.settled,
  },
  {
    id: 'flight', group: 'Behaviour', title: 'Nuptial flight',
    text: 'On a warm, humid, still day, often just after rain, every colony of a species around releases its winged queens and males at once. They mate in the air; each queen stores the sperm for the rest of her life.',
    hint: 'Raise a big colony after its first winter.',
    seen: (s) => s.milestones.has('flight'),
  },
  {
    id: 'males', group: 'Behaviour', title: 'Haplodiploidy',
    text: 'Fertilised eggs become females (workers or queens); unfertilised ones become males. So workers, who can\'t mate, can still lay male eggs, and a colony that loses its queen raises one last brood of sons.',
    hint: 'Raise winged males.',
    seen: (s) => !!s.player && s.player.ants.some((a) => a.male),
  },
  {
    id: 'lineage', group: 'Behaviour', title: 'Daughter colonies',
    text: 'Each young queen that survives her flight starts a colony of her own, and carries her mother\'s genes into it. Related colonies often live side by side.',
    hint: 'Follow a daughter queen after a nuptial flight.',
    seen: (s) => !!s.opts.lineage,
  },
];

const KEY = 'formica.almanac';

/** Which entries the keeper has unlocked, across all games. */
export class Almanac {
  readonly seen = new Set<string>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) for (const id of JSON.parse(raw) as string[]) this.seen.add(id);
    } catch {
      // storage unavailable
    }
  }

  /** New entries unlocked by what's happening in this game. */
  check(s: Sim): AlmanacEntry[] {
    const fresh: AlmanacEntry[] = [];
    for (const e of ALMANAC) {
      if (this.seen.has(e.id) || !e.seen(s)) continue;
      this.seen.add(e.id);
      fresh.push(e);
    }
    if (fresh.length) {
      try {
        localStorage.setItem(KEY, JSON.stringify([...this.seen]));
      } catch {
        // storage unavailable
      }
    }
    return fresh;
  }
}

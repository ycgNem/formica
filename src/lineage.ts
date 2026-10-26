import type { Species, SpeciesId } from './species';
import type { Colony } from './colony';
import type { Sim, GameOptions } from './sim';

/**
 * Lineage mode [v1.6]: after a nuptial flight the keeper can follow one of the
 * young queens to a neighbouring patch of ground. The daughter colony inherits
 * traits from how its mother lived, and the mother colony stays on as a
 * friendly neighbour.
 */
export type TraitId = 'prolific' | 'diggers' | 'fierce' | 'thrifty' | 'hardy' | 'gatherers';

export interface Lineage {
  /** 1 for a first colony; each daughter adds one. */
  gen: number;
  traits: TraitId[];
  /** Mother, grandmother and so on, most recent first. */
  ancestors: string[];
  /** The mother colony, a friendly neighbour on the new map. */
  kin: { name: string; species: SpeciesId } | null;
}

export const TRAITS: Record<TraitId, { name: string; desc: string; how: string; apply: (s: Species) => void }> = {
  prolific: { name: 'Prolific', desc: 'Queens of this line lay 12% faster.', how: 'a colony of 1,500 ants', apply: (s) => (s.layInterval *= 0.88) },
  diggers: { name: 'Diggers', desc: 'Workers dig 15% faster.', how: '6,000 cells dug', apply: (s) => (s.dig *= 1.15) },
  fierce: { name: 'Fierce', desc: 'Workers bite 15% harder.', how: '250 enemies killed', apply: (s) => (s.atk *= 1.15) },
  thrifty: { name: 'Thrifty', desc: 'Workers eat 12% less.', how: 'a winter with no ant ever starving', apply: (s) => (s.appetite *= 0.88) },
  hardy: { name: 'Hardy', desc: 'Workers live 15% longer.', how: 'two winters survived', apply: (s) => (s.life *= 1.15) },
  gatherers: { name: 'Gatherers', desc: 'Foragers carry 15% more.', how: '12,000 food gathered', apply: (s) => (s.carry *= 1.15) },
};

/** How far past each trait's bar a colony got (1 = just made it). */
function traitScores(c: Colony): Record<TraitId, number> {
  const st = c.stats;
  return {
    prolific: st.peak / 1500,
    diggers: st.dug / 6000,
    fierce: st.kills / 250,
    thrifty: st.starved === 0 && c.winters >= 1 ? 1 : 0,
    hardy: c.winters >= 2 ? 1 : 0,
    gatherers: st.gathered / 12000,
  };
}

/** A copy of the species with a lineage's traits applied. */
export function withTraits(sp: Species, traits: readonly TraitId[] = []): Species {
  if (!traits.length) return sp;
  const out: Species = { ...sp, ratings: { ...sp.ratings } };
  for (const t of traits) TRAITS[t].apply(out);
  return out;
}

/**
 * What a colony passes on to its daughters, judged by how it lived: the line's old traits, plus at most two new ones a
 * generation (what it did best), four in all. So a strong line is built over several generations.
 */
export function earnTraits(c: Colony, inherited: readonly TraitId[]): TraitId[] {
  const sc = traitScores(c);
  const fresh = (Object.keys(sc) as TraitId[])
    .filter((t) => sc[t] >= 1 && !inherited.includes(t))
    .sort((a, b) => sc[b] - sc[a])
    .slice(0, 2);
  return [...inherited, ...fresh].slice(0, 4);
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** "Mosswick" becomes "Mosswick II", "Mosswick II" becomes "Mosswick III". */
export function daughterName(name: string, gen: number): string {
  const base = name.replace(/\s+[IVX]+$/, '');
  return `${base} ${ROMAN[gen] ?? gen}`;
}

/** Options for a daughter colony: same species and biome, the next patch of ground over, the mother next door. */
export function daughterOptions(sim: Sim): GameOptions {
  const p = sim.player!;
  const o = sim.opts;
  const prev: Lineage = o.lineage ?? { gen: 1, traits: [], ancestors: [], kin: null };
  const gen = prev.gen + 1;
  return {
    ...o,
    seed: (Math.imul(o.seed, 31) + 7) >>> 0,
    name: daughterName(o.name, gen),
    lineage: {
      gen,
      traits: earnTraits(p, prev.traits),
      ancestors: [o.name, ...prev.ancestors].slice(0, 6),
      kin: { name: o.name, species: o.species },
    },
  };
}

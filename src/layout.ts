import { W } from './config';
import { Rng } from './rng';
import type { Plant } from './ecology';

/**
 * The meadow is laid out in zones, so each seed gets a little landscape instead
 * of evenly sprinkled props: a woodland edge, open flower meadow, a stony patch
 * and a bramble hedge. Everything here derives from the world seed, so it's
 * rebuilt identically on load and never saved.
 */
export type ZoneKind = 'woods' | 'meadow' | 'stony' | 'bramble' | 'dune' | 'reeds';

export interface Zone {
  kind: ZoneKind;
  x0: number;
  x1: number;
}

/** A decorative prop on the surface. Behind props are tucked under the ground line; front ones stand on it. */
export interface Prop {
  name: string;
  x: number;
  flip: boolean;
  front: boolean;
}

/** A sprite pressed into the soil, in texel coordinates. */
export interface Buried {
  name: string;
  tx: number;
  ty: number;
}

export function makeZones(seed: number, base: ZoneKind[] = ['woods', 'meadow', 'stony', 'bramble', 'meadow']): Zone[] {
  const r = new Rng(seed ^ 0x2f6b9e1d);
  const kinds = [...base];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = r.int(0, i);
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  // No two of a kind side by side
  for (let i = 1; i < kinds.length; i++) {
    if (kinds[i] === kinds[i - 1]) [kinds[i], kinds[(i + 1) % kinds.length]] = [kinds[(i + 1) % kinds.length], kinds[i]];
  }
  const widths = kinds.map(() => r.range(0.7, 1.3));
  const total = widths.reduce((a, b) => a + b, 0);
  const zones: Zone[] = [];
  let x = 0;
  kinds.forEach((kind, i) => {
    const w = i === kinds.length - 1 ? W - x : Math.round((widths[i] / total) * W);
    zones.push({ kind, x0: x, x1: x + w });
    x += w;
  });
  return zones;
}

export function zoneAt(zones: Zone[], x: number): ZoneKind {
  for (const z of zones) if (x >= z.x0 && x < z.x1) return z.kind;
  return 'meadow';
}

const BACK_SMALL: Record<ZoneKind, string[]> = {
  woods: ['grassclump', 'stump', 'grassclump', 'wheatgrass'],
  meadow: ['grassclump', 'wheatgrass', 'dandelion', 'grassclump', 'cattails'],
  stony: ['rockpile', 'boulder', 'grassclump', 'rockpile'],
  bramble: ['wheatgrass', 'grassclump', 'cattails2', 'grassclump'],
  dune: ['wheatgrass', 'grassclump', 'rockpile', 'wheatgrass'],
  reeds: ['cattails', 'cattails2', 'grassclump', 'cattails', 'wheatgrass'],
};

const FRONT_SMALL: Record<ZoneKind, string[]> = {
  woods: ['fern', 'fern2', 'mushrooms', 'toadstool', 'clover', 'pinecone', 'acorn', 'mossrock'],
  meadow: ['clover', 'clover', 'snail', 'mossrock2', 'fern2'],
  stony: ['quartz', 'mossrock', 'mossrock2', 'clover', 'quartz'],
  bramble: ['clover', 'fern', 'mushrooms', 'acorn', 'snail'],
  dune: ['quartz', 'bone', 'quartz', 'mossrock2'],
  reeds: ['clover', 'fern2', 'snail', 'clover', 'fern'],
};

/** Surface props and buried finds for a world. Fills the gaps between plants so no stretch of ground is bare. */
export function makeScenery(
  seed: number, zones: Zone[], plants: Plant[], ground: (x: number) => number, logs: [number, number][] = [],
): { props: Prop[]; buried: Buried[] } {
  const r = new Rng(seed ^ 0x6c8e9cf5);
  const props: Prop[] = [];
  const busy = new Float32Array(W);
  const claim = (x: number, half: number): void => {
    for (let k = Math.max(0, Math.floor(x - half)); k < Math.min(W, Math.ceil(x + half)); k++) busy[k] = 1;
  };
  for (const p of plants) if (p.kind === 'tree' || p.kind === 'wood') claim(p.x, 3);
  for (const [x0, x1] of logs) claim((x0 + x1) / 2, (x1 - x0) / 2 + 1);
  const free = (x: number, half: number): boolean => {
    for (let k = Math.max(0, Math.floor(x - half)); k < Math.min(W, Math.ceil(x + half)); k++) if (busy[k]) return false;
    return true;
  };

  for (const z of zones) {
    // One showpiece per zone
    const mid = r.int(z.x0 + 8, Math.max(z.x0 + 9, z.x1 - 8));
    // Where real, diggable logs lie about, the woods get a stump instead of a painted one
    const hero = z.kind === 'woods' ? (logs.length ? 'stump' : 'log') : z.kind === 'stony' || z.kind === 'dune' ? 'boulder' : z.kind === 'meadow' ? 'stump' : z.kind === 'reeds' ? 'cattails' : 'boulder';
    if ((z.kind !== 'meadow' || r.chance(0.5)) && free(mid, hero === 'log' ? 13 : 4)) {
      props.push({ name: hero, x: mid, flip: r.chance(0.5), front: false });
      claim(mid, hero === 'log' ? 12 : 3);
    }
    // Back clumps every few cells, front details in between
    for (let x = z.x0 + r.range(1, 4); x < z.x1 - 1; x += r.range(z.kind === 'stony' ? 7 : 5, z.kind === 'meadow' ? 10 : 12)) {
      const cx = Math.round(x);
      if (!free(cx, 2)) continue;
      props.push({ name: r.pick(BACK_SMALL[z.kind]), x: cx, flip: r.chance(0.5), front: false });
    }
    for (let x = z.x0 + r.range(2, 6); x < z.x1 - 1; x += r.range(6, z.kind === 'woods' ? 9 : 16)) {
      const cx = Math.round(x);
      if (!free(cx, 1)) continue;
      props.push({ name: r.pick(FRONT_SMALL[z.kind]), x: cx, flip: r.chance(0.5), front: true });
    }
  }

  // Finds in the soil: fossils deep down, seeds and grubs near the roots
  const buried: Buried[] = [];
  const T = 8;
  const deep = ['ammonite', 'ammonite', 'crystal', 'crystal2', 'bone', 'flatpebble'];
  const shallow = ['buried_acorn', 'grub', 'rootpiece', 'flatpebble', 'bone'];
  for (let k = 0; k < 7; k++) buried.push({ name: r.pick(deep), tx: r.int(10, W - 10) * T, ty: Math.round(r.range(120, 205) * T) });
  for (let k = 0; k < 6; k++) {
    const x = r.int(10, W - 10);
    buried.push({ name: r.pick(shallow), tx: x * T, ty: Math.round((ground(x) + r.range(4, 22)) * T) });
  }
  for (const p of plants) {
    if (p.kind === 'wood' && p.variant === 0 && r.chance(0.4)) {
      buried.push({ name: 'buried_acorn', tx: Math.round((p.x + r.range(-8, 8)) * T), ty: Math.round((ground(p.x) + r.range(3, 9)) * T) });
    }
  }
  return { props, buried };
}

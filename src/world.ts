import { W, H, GROUND, AIR, DIRT, TUNNEL, ROCK, MOUND, idx, DX, DY } from './config';
import type { Rng } from './rng';
import type { Zone } from './layout';

/**
 * The cross-section grid, a routing tree over all tunnel cells, and flood water.
 *
 * Every tunnel cell points at a parent one step closer to an entrance (a "root":
 * a tunnel cell with open air above it). Routing between two cells is then
 * "walk up from A until you meet B's chain, then walk down to B", which costs
 * O(depth) and makes ants share the same trunk routes, like real trails.
 */
export class World {
  readonly cells = new Uint8Array(W * H);
  /** Chamber role of each tunnel cell (ROLE_*). */
  readonly room = new Uint8Array(W * H);
  /** 1 where a tunnel cell is flooded. */
  readonly water = new Uint8Array(W * H);
  /** Row of the topmost solid cell in each column. */
  readonly top = new Int32Array(W);
  /** Steps from the nearest entrance, -1 if not a reachable tunnel cell. */
  readonly dist = new Int32Array(W * H).fill(-1);
  readonly parent = new Int32Array(W * H).fill(-1);
  /** Which dig project (id + 1) has claimed a cell, 0 if none. */
  readonly planOwner = new Int32Array(W * H);
  /** Ant id currently digging a cell, -1 if none. */
  readonly reservedBy = new Int32Array(W * H).fill(-1);
  readonly roots: number[] = [];
  /** Cells whose appearance changed since the renderer last looked. */
  readonly dirty = new Set<number>();
  /** 1 where a solid or dug cell is rotting wood (a fallen log) rather than soil. */
  readonly wood = new Uint8Array(W * H);
  /** Fallen logs, as column spans. */
  readonly logs: [number, number][] = [];
  /** Recently dug and dumped cells, for crumb and dust effects. The renderer drains these. */
  readonly dugFx: number[] = [];
  readonly dumpFx: number[] = [];

  private treeDirty = false;
  private readonly mark = new Int32Array(W * H);
  private stamp = 0;
  private readonly queue = new Int32Array(W * H);
  private waterList: number[] = [];
  private readonly wstamp = new Int32Array(W * H);
  private wtick = 0;

  constructor(rng: Rng, zones: Zone[] = [], relief = 1, rocks = 1) {
    const p1 = rng.range(0, Math.PI * 2);
    const p2 = rng.range(0, Math.PI * 2);
    for (let x = 0; x < W; x++) {
      this.top[x] = GROUND + Math.round((Math.sin(x * 0.022 + p1) * 2.4 + Math.sin(x * 0.085 + p2) * 1) * relief);
      for (let y = 0; y < H; y++) this.cells[idx(x, y)] = y >= this.top[x] ? DIRT : AIR;
    }
    // Pebbles and stones scattered through the soil, with extra boulders under stony ground
    const stony = zones.filter((z) => z.kind === 'stony');
    const n = Math.round(46 * rocks);
    for (let k = 0; k < n + stony.length * 10; k++) {
      const z = k >= n ? stony[(k - n) % stony.length] : null;
      const cx = z ? rng.range(z.x0 + 3, z.x1 - 3) : rng.range(4, W - 4);
      const cy = z ? rng.range(GROUND + 7, GROUND + 40) : rng.range(GROUND + 12, H - 3);
      const rx = rng.range(1.2, 4.8);
      const ry = rx * rng.range(0.5, 0.9);
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const fx = (x + 0.5 - cx) / rx;
          const fy = (y + 0.5 - cy) / ry;
          if (fx * fx + fy * fy <= 1 && this.cells[idx(x, y)] === DIRT) this.cells[idx(x, y)] = ROCK;
        }
      }
    }
  }

  /** A fallen log lying on the ground from column x0, its ends rounded off. */
  addLog(x0: number, len: number, height: number): void {
    const x1 = Math.min(W - 4, x0 + len);
    let base = H;
    for (let x = x0; x < x1; x++) base = Math.min(base, this.top[x]);
    for (let x = x0; x < x1; x++) {
      const end = Math.min(x - x0, x1 - 1 - x);
      const h = Math.max(1, height - (end === 0 ? 2 : end === 1 ? 1 : 0));
      const top = base - h - (end === 0 ? 0 : 0);
      for (let y = top; y < this.top[x]; y++) {
        const i = idx(x, y);
        this.cells[i] = DIRT;
        this.wood[i] = 1;
      }
      this.top[x] = Math.min(this.top[x], top);
    }
    this.logs.push([x0, x1]);
  }

  setCell(i: number, type: number): void {
    this.cells[i] = type;
    this.markDirty(i);
  }

  private markDirty(i: number): void {
    const x = i % W;
    const y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) this.dirty.add(idx(nx, ny));
      }
    }
  }

  /** Can an ant step from (ax, ay) to its neighbour in direction k? (No squeezing through dirt corners.) */
  private canStep(ax: number, ay: number, k: number): boolean {
    if (k < 4) return true;
    return this.cells[idx(ax + DX[k], ay)] === TUNNEL || this.cells[idx(ax, ay + DY[k])] === TUNNEL;
  }

  /** Turn a cell into tunnel. Returns true if it opened a new entrance. */
  dig(i: number, role: number): boolean {
    this.cells[i] = TUNNEL;
    this.room[i] = role;
    this.markDirty(i);
    this.treeDirty = true;
    if (this.dugFx.length < 48) this.dugFx.push(i);

    const x = i % W;
    const y = (i / W) | 0;
    if (y > 0 && this.cells[i - W] === AIR) {
      this.dist[i] = 0;
      this.parent[i] = -1;
      this.roots.push(i);
      return true;
    }
    // Hook straight into the tree so it's routable now; rebuildTree() shortens paths later.
    let best = -1;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k];
      const ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = idx(nx, ny);
      if (this.cells[n] !== TUNNEL || this.dist[n] < 0 || !this.canStep(x, y, k)) continue;
      if (best < 0 || this.dist[n] < this.dist[best]) best = n;
    }
    if (best >= 0) {
      this.dist[i] = this.dist[best] + 1;
      this.parent[i] = best;
    }
    return false;
  }

  markTreeDirty(): void {
    this.treeDirty = true;
  }

  /** Full BFS from every entrance, so routes stay shortest as tunnels join up. */
  rebuildTree(): void {
    if (!this.treeDirty) return;
    this.treeDirty = false;
    const { dist, parent, cells, queue } = this;
    dist.fill(-1);
    parent.fill(-1);
    let head = 0;
    let tail = 0;
    for (const r of this.roots) {
      dist[r] = 0;
      queue[tail++] = r;
    }
    while (head < tail) {
      const c = queue[head++];
      const cx = c % W;
      const cy = (c / W) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k];
        const ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = idx(nx, ny);
        if (cells[n] !== TUNNEL || dist[n] >= 0 || !this.canStep(cx, cy, k)) continue;
        dist[n] = dist[c] + 1;
        parent[n] = c;
        queue[tail++] = n;
      }
    }
  }

  /** Cells from a to b inclusive through the tunnel tree, or null if either is unreachable. */
  route(a: number, b: number): number[] | null {
    if (this.dist[a] < 0 || this.dist[b] < 0) return null;
    const { parent, mark } = this;
    const s = ++this.stamp;
    for (let c = b; c !== -1; c = parent[c]) mark[c] = s;
    const path: number[] = [];
    let c = a;
    while (c !== -1 && mark[c] !== s) {
      path.push(c);
      c = parent[c];
    }
    if (c === -1) return null; // different entrances
    const meet = c;
    path.push(meet);
    const down: number[] = [];
    for (let d = b; d !== meet; d = parent[d]) down.push(d);
    for (let k = down.length - 1; k >= 0; k--) path.push(down[k]);
    return path;
  }

  /** Cells from a up to its entrance, inclusive. */
  routeToRoot(a: number): number[] | null {
    if (this.dist[a] < 0) return null;
    const path: number[] = [];
    for (let c = a; c !== -1; c = this.parent[c]) path.push(c);
    return path;
  }

  rootOf(a: number): number {
    let c = a;
    while (this.parent[c] !== -1) c = this.parent[c];
    return c;
  }

  /** No tunnel within r columns of col, down to depth rows below the ground line, so a new queen doesn't found inside an old nest. */
  siteClear(col: number, r: number, depth: number): boolean {
    for (let x = Math.max(0, col - r); x <= Math.min(W - 1, col + r); x++) {
      for (let y = Math.max(0, this.top[x] - 1); y < Math.min(H, GROUND + depth); y++) if (this.cells[idx(x, y)] === TUNNEL) return false;
    }
    return true;
  }

  /** Columns right next to an entrance stay clear of spoil so the hole never gets buried. */
  isProtected(x: number): boolean {
    for (const r of this.roots) if (Math.abs((r % W) - x) <= 1) return true;
    return false;
  }

  /** Drop one load of excavated soil on the surface, letting it slide like a sandpile. */
  addMound(x0: number, rng: Rng): void {
    const { top } = this;
    let x = x0;
    for (let iter = 0; iter < 24; iter++) {
      const h = top[x];
      // Always slide off a 2-step drop, sometimes off a 1-step one, which keeps slopes gentle
      const l = x > 1 && !this.isProtected(x - 1) && (top[x - 1] > h + 1 || (top[x - 1] > h && rng.chance(0.6)));
      const r = x < W - 2 && !this.isProtected(x + 1) && (top[x + 1] > h + 1 || (top[x + 1] > h && rng.chance(0.6)));
      if (l && r) x += rng.chance(0.5) ? -1 : 1;
      else if (l) x--;
      else if (r) x++;
      else break;
    }
    if (this.isProtected(x) || top[x] <= 8) return;
    const y = top[x] - 1;
    this.setCell(idx(x, y), MOUND);
    top[x] = y;
    if (this.dumpFx.length < 48) this.dumpFx.push(idx(x, y));
  }

  // ── water ─────────────────────────────────────────────────────────────

  get waterCount(): number {
    return this.waterList.length;
  }

  addWater(i: number): void {
    if (this.cells[i] !== TUNNEL || this.water[i]) return;
    this.water[i] = 1;
    this.waterList.push(i);
    this.dirty.add(i);
  }

  rebuildWaterList(): void {
    this.waterList = [];
    for (let i = 0; i < W * H; i++) if (this.water[i]) this.waterList.push(i);
  }

  /** One tick of a falling-sand style flow: down, then diagonally down, then sideways; soil soaks it up. */
  stepWater(rng: Rng): void {
    const { cells, water, wstamp } = this;
    const tick = ++this.wtick;
    const list = this.waterList.sort((a, b) => b - a); // bottom rows first
    const next: number[] = [];
    for (const i of list) {
      if (!water[i] || wstamp[i] === tick) continue;
      const x = i % W;
      const below = i + W;
      let j = -1;
      if (below < W * H) {
        if (cells[below] === TUNNEL && !water[below]) j = below;
        else {
          const s = rng.chance(0.5) ? 1 : -1;
          for (const d of [s, -s]) {
            const nx = x + d;
            if (nx < 0 || nx >= W) continue;
            const n = below + d;
            if (cells[n] === TUNNEL && !water[n] && (cells[i + d] === TUNNEL || cells[below] === TUNNEL)) {
              j = n;
              break;
            }
          }
          if (j < 0) {
            for (const d of [s, -s]) {
              const nx = x + d;
              if (nx < 0 || nx >= W) continue;
              const n = i + d;
              if (cells[n] === TUNNEL && !water[n] && rng.chance(0.5)) {
                j = n;
                break;
              }
            }
          }
        }
      }
      // Soil soaks it up slowly, so a long storm can really fill the lower tunnels
      if (rng.chance(j >= 0 ? 0.008 : 0.005)) {
        water[i] = 0;
        this.dirty.add(i);
        continue;
      }
      if (j < 0) {
        next.push(i);
        continue;
      }
      water[i] = 0;
      water[j] = 1;
      wstamp[j] = tick;
      this.dirty.add(i);
      this.dirty.add(j);
      next.push(j);
    }
    this.waterList = next;
  }

  isDirt(i: number): boolean {
    return this.cells[i] === DIRT;
  }
}

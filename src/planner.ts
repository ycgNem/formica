import { W, H, GROUND, DIRT, TUNNEL, ROCK, idx, ROLE_NONE, ROLE_QUEEN } from './config';
import type { Colony, Project } from './colony';

const TURNS = [0, 0.45, -0.45, 0.9, -0.9];

/** Any tunnel or other project's planned cell within r of (x, y), ignoring ones near (sx, sy)? */
function crowded(c: Colony, x: number, y: number, r: number, owner: number, sx: number, sy: number, ignoreR: number): boolean {
  const w = c.world;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const cx = x0 + dx;
      const cy = y0 + dy;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      if ((cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2 > r * r) continue;
      const i = idx(cx, cy);
      const o = w.planOwner[i];
      if (w.cells[i] !== TUNNEL && (o === 0 || o === owner)) continue;
      if ((cx + 0.5 - sx) ** 2 + (cy + 0.5 - sy) ** 2 > ignoreR * ignoreR) return true;
    }
  }
  return false;
}

/** Plan an elliptical chamber just beyond (ex, ey) in direction (dx, dy). */
export function planChamber(
  c: Colony, ex: number, ey: number, dx: number, dy: number, rx: number, ry: number, role: number, force: boolean,
): Project | null {
  const w = c.world;
  const cx = ex + dx * rx * 0.7;
  const cy = ey + dy * ry * 0.7;
  const owner = c.sim.nextProjectId + 1;
  const cells: number[] = [];
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const fx = (x + 0.5 - cx) / rx;
      const fy = (y + 0.5 - cy) / ry;
      if (fx * fx + fy * fy > 1 || y + 0.5 > cy + ry * 0.7) continue; // flat floor
      if (x < 3 || x >= W - 3 || y < GROUND + 5 || y >= Math.min(H - 3, c.sim.maxDigRow + 1)) {
        if (force) continue;
        return null;
      }
      const i = idx(x, y);
      if (w.cells[i] === TUNNEL) continue;
      if (w.cells[i] !== DIRT) {
        if (force) continue;
        return null;
      }
      if (!force && crowded(c, x + 0.5, y + 0.5, 2.2, owner, ex, ey, rx + 2.5)) return null;
      cells.push(i);
    }
  }
  if (cells.length < 8) return null;
  const d = (i: number): number => ((i % W) + 0.5 - ex) ** 2 + (Math.floor(i / W) + 0.5 - ey) ** 2;
  cells.sort((a, b) => d(a) - d(b));
  return c.addProject('chamber', role, cells, [], cx, cy, 0, 0);
}

function okStep(c: Colony, nx: number, ny: number, sx: number, sy: number, owner: number, clear: number): boolean {
  if (nx < 6 || nx > W - 6 || ny < GROUND + 7 || ny > Math.min(H - 6, c.sim.maxDigRow)) return false;
  const w = c.world;
  const x0 = Math.floor(nx);
  const y0 = Math.floor(ny);
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const cx = x0 + dx;
      const cy = y0 + dy;
      const d2 = (cx + 0.5 - nx) ** 2 + (cy + 0.5 - ny) ** 2;
      if (d2 > clear * clear) continue;
      const i = idx(cx, cy);
      if (w.cells[i] === ROCK && d2 <= 2.6) return false;
      const o = w.planOwner[i];
      if (w.cells[i] !== TUNNEL && (o === 0 || o === owner)) continue;
      if ((cx + 0.5 - sx) ** 2 + (cy + 0.5 - sy) ** 2 > 49) return false;
    }
  }
  return true;
}

/** Turn a centreline into dig cells (about three wide) plus spine cells for later branching. */
function rasterize(c: Colony, pts: number[]): { cells: number[]; spine: number[] } {
  const w = c.world;
  const seen = new Set<number>();
  const cells: number[] = [];
  const spine: number[] = [];
  for (let k = 0; k < pts.length; k += 2) {
    const px = pts[k];
    const py = pts[k + 1];
    spine.push(idx(Math.floor(px), Math.floor(py)));
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = Math.floor(px) + dx;
        const cy = Math.floor(py) + dy;
        if ((cx + 0.5 - px) ** 2 + (cy + 0.5 - py) ** 2 > 1.1) continue;
        const i = idx(cx, cy);
        if (seen.has(i)) continue;
        seen.add(i);
        if (w.cells[i] === DIRT) cells.push(i);
      }
    }
  }
  return { cells, spine };
}

/** Random-walk a tunnel out from some point on an existing tunnel or shaft. */
export function planTunnel(c: Colony, src: Project): Project | null {
  const r = c.rng;
  if (!src.spine.length) return null;
  const s0 = r.pick(src.spine);
  const sx = (s0 % W) + 0.5;
  const sy = Math.floor(s0 / W) + 0.5;
  const side = r.chance(0.5) ? 1 : -1;
  const slope = r.range(-0.1, 0.95);
  let a = side > 0 ? slope : Math.PI - slope;
  const len = r.int(16, 50);
  const maxDepth = Math.min(c.sim.maxDigRow, GROUND + 26 + c.workerCount * 0.4);
  const owner = c.sim.nextProjectId + 1;
  let x = sx;
  let y = sy;
  const pts: number[] = [];
  for (let s = 0; s < len; s++) {
    a += r.range(-0.2, 0.2);
    let moved = false;
    for (const da of TURNS) {
      const aa = a + da;
      if (Math.sin(aa) < -0.45) continue; // no steep climbs
      const nx = x + Math.cos(aa);
      const ny = y + Math.sin(aa);
      if (ny > maxDepth && Math.sin(aa) > 0) continue;
      if (!okStep(c, nx, ny, sx, sy, owner, 3.6)) continue;
      x = nx;
      y = ny;
      a = aa;
      moved = true;
      break;
    }
    if (!moved) break;
    pts.push(x, y);
  }
  if (pts.length < 20) return null;
  const { cells, spine } = rasterize(c, pts);
  return c.addProject('tunnel', ROLE_NONE, cells, spine, x, y, Math.cos(a), Math.sin(a));
}

/** A tunnel from the nearest bit of nest toward a point the keeper marked. */
export function planToward(c: Colony, tx: number, ty: number): Project | null {
  const w = c.world;
  let best = -1;
  let bd = Infinity;
  for (const p of c.projects) {
    if (p.cursor === 0) continue;
    for (const cell of p.cells) {
      if (w.cells[cell] !== TUNNEL || w.dist[cell] < 0) continue;
      const d = ((cell % W) + 0.5 - tx) ** 2 + (Math.floor(cell / W) + 0.5 - ty) ** 2;
      if (d < bd) {
        bd = d;
        best = cell;
      }
    }
  }
  if (best < 0 || bd < 9) return null;
  const sx = (best % W) + 0.5;
  const sy = Math.floor(best / W) + 0.5;
  const owner = c.sim.nextProjectId + 1;
  let x = sx;
  let y = sy;
  let a = 0;
  const pts: number[] = [];
  for (let s = 0; s < 140; s++) {
    a = Math.atan2(ty - y, tx - x) + c.rng.range(-0.25, 0.25);
    let moved = false;
    for (const da of TURNS) {
      const aa = a + da;
      const nx = x + Math.cos(aa);
      const ny = y + Math.sin(aa);
      if (!okStep(c, nx, ny, sx, sy, owner, 2.6)) continue;
      x = nx;
      y = ny;
      a = aa;
      moved = true;
      break;
    }
    if (!moved) break;
    pts.push(x, y);
    if (Math.hypot(tx - x, ty - y) < 1.2) break;
  }
  if (pts.length < 8) return null;
  const { cells, spine } = rasterize(c, pts);
  const p = c.addProject('tunnel', ROLE_NONE, cells, spine, x, y, Math.cos(a), Math.sin(a));
  p.priority = true;
  p.maxWorkers = 4;
  return p;
}

/** A short, straight priority tunnel from the nearest bit of nest to a cell (to reach aphids, say). */
export function planReach(c: Colony, target: number): Project | null {
  const w = c.world;
  const tx = (target % W) + 0.5;
  const ty = Math.floor(target / W) + 0.5;
  let best = -1;
  let bd = Infinity;
  for (const p of c.projects) {
    if (p.cursor === 0) continue;
    for (const cell of p.cells) {
      if (w.cells[cell] !== TUNNEL || w.dist[cell] < 0) continue;
      const d = ((cell % W) + 0.5 - tx) ** 2 + (Math.floor(cell / W) + 0.5 - ty) ** 2;
      if (d < bd) {
        bd = d;
        best = cell;
      }
    }
  }
  if (best < 0 || bd > 15 * 15) return null;
  const sx = (best % W) + 0.5;
  const sy = Math.floor(best / W) + 0.5;
  const n = Math.ceil(Math.hypot(tx - sx, ty - sy) * 2);
  const cells: number[] = [];
  const spine: number[] = [];
  let px = Math.floor(sx);
  let py = Math.floor(sy);
  const add = (x: number, y: number): boolean => {
    const i = idx(x, y);
    if (w.cells[i] === ROCK) return false;
    if (w.cells[i] === DIRT && !cells.includes(i)) cells.push(i);
    if (!spine.includes(i)) spine.push(i);
    return true;
  };
  for (let k = 1; k <= n; k++) {
    const x = Math.floor(sx + ((tx - sx) * k) / n);
    const y = Math.floor(sy + ((ty - sy) * k) / n);
    if (x === px && y === py) continue;
    // Step round diagonal corners, so every cell has a dug neighbour to stand on when its turn comes
    if (x !== px && y !== py && !add(px, y)) return null;
    if (!add(x, y)) return null;
    px = x;
    py = y;
  }
  if (!cells.length) return null;
  const p = c.addProject('tunnel', ROLE_NONE, cells, spine, tx, ty, 0, 0);
  p.priority = true;
  p.capped = true;
  p.maxWorkers = 2;
  return p;
}

/** The queen picks a spot, clears any stones there and plans a shaft plus her chamber. False if old tunnels are in the way. */
export function planFounding(c: Colony, col0: number): boolean {
  const w = c.world;
  const col = Math.max(14, Math.min(W - 16, col0));
  if (!w.siteClear(col, 11, 28)) return false;
  const y0 = Math.min(w.top[col], w.top[col + 1]);
  const depth = 15;
  for (let y = y0; y < y0 + depth + 10; y++) {
    for (let x = col - 9; x <= col + 10; x++) if (w.cells[idx(x, y)] === ROCK) w.setCell(idx(x, y), DIRT);
  }
  const cells: number[] = [];
  const spine: number[] = [];
  let o = 0;
  for (let k = 0; k <= depth; k++) {
    o = Math.round(Math.sin(k * 0.35) * 0.7);
    const y = y0 + k;
    for (const x of [col + o, col + o + 1]) if (w.cells[idx(x, y)] === DIRT) cells.push(idx(x, y));
    spine.push(idx(col + o, y));
  }
  const ex = col + o + 1;
  const ey = y0 + depth + 0.5;
  const shaft = c.addProject('shaft', ROLE_NONE, cells, spine, ex, ey, 0, 1);
  shaft.queenOnly = true;
  shaft.maxWorkers = 1;
  const ch = planChamber(c, ex, ey, 0, 1, 5, 2.8, ROLE_QUEEN, true);
  if (!ch) {
    c.dropProject(shaft);
    return false;
  }
  ch.queenOnly = true;
  ch.maxWorkers = 1;
  c.queenChamber = ch;
  return true;
}

// World size in cells. The camera scales cells to the screen.
export const W = 400;
export const H = 220;
/** Row of the original ground surface (ground wobbles a couple of rows around this). */
export const GROUND = 46;

// Cell types
export const AIR = 0;
export const DIRT = 1;
export const TUNNEL = 2;
export const ROCK = 3;
export const MOUND = 4;

// Chamber roles, stored per tunnel cell
export const ROLE_NONE = 0;
export const ROLE_QUEEN = 1;
export const ROLE_NURSERY = 2;
export const ROLE_FOOD = 3;
export const ROLE_MIDDEN = 4;
export const ROLE_GRANARY = 5;
export const ROLE_NAMES = ['Tunnel', 'Queen chamber', 'Nursery', 'Food store', 'Midden', 'Granary'];

/** Sim seconds per in-game day. */
export const DAY = 240;
export const SEASON_DAYS = 3;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
/** Per-colony ceiling on ants + brood, for performance. */
export const HARD_CAP = 2200;

export const idx = (x: number, y: number): number => y * W + x;

/** 8-neighbourhood, orthogonal directions first. */
export const DX = [1, -1, 0, 0, 1, 1, -1, -1];
export const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export const clampCol = (x: number): number => Math.max(3, Math.min(W - 4, Math.round(x)));
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

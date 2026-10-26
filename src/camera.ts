import { W, H, clamp } from './config';

/** Lowest world row the camera may show (sky above the ground). */
const TOP = -26;

/** Pan/zoom over the world. Screen units are device pixels. */
export class Camera {
  x = W / 2;
  y = (TOP + H) / 2;
  zoom = 1;
  vw = 1;
  vh = 1;

  /** Cells-to-pixels scale at zoom 1, where the whole world fits. */
  get fit(): number {
    return Math.min(this.vw / W, this.vh / (H - TOP));
  }

  get scale(): number {
    return this.fit * this.zoom;
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    const s = this.scale;
    return { x: (sx - this.vw / 2) / s + this.x, y: (sy - this.vh / 2) / s + this.y };
  }

  toScreen(wx: number, wy: number): { x: number; y: number } {
    const s = this.scale;
    return { x: (wx - this.x) * s + this.vw / 2, y: (wy - this.y) * s + this.vh / 2 };
  }

  zoomAt(f: number, sx: number, sy: number): void {
    const before = this.toWorld(sx, sy);
    this.zoom = clamp(this.zoom * f, 1, 10);
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  pan(dx: number, dy: number): void {
    const s = this.scale;
    this.x -= dx / s;
    this.y -= dy / s;
    this.clamp();
  }

  /** Ease toward a point (for following an ant). */
  approach(x: number, y: number, k: number): void {
    this.x += (x - this.x) * k;
    this.y += (y - this.y) * k;
    this.clamp();
  }

  clamp(): void {
    // A page loaded in a hidden or zero-size window must not poison the camera with NaN
    if (!Number.isFinite(this.x)) this.x = W / 2;
    if (!Number.isFinite(this.y)) this.y = (TOP + H) / 2;
    if (this.vw < 2 || this.vh < 2) return;
    const s = this.scale;
    const hw = this.vw / 2 / s;
    const hh = this.vh / 2 / s;
    this.x = hw * 2 >= W ? W / 2 : clamp(this.x, hw, W - hw);
    this.y = hh * 2 >= H - TOP ? (TOP + H) / 2 : clamp(this.y, TOP + hh, H - hh);
  }
}

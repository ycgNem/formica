import { DAY } from './config';
import type { Rng } from './rng';

/** Average gap between showers per season, in days. */
const RAIN_GAP = [0.9, 1.6, 1.0, 1.2];

export class Weather {
  raining = false;
  /** Eases toward 1 while raining, 0 otherwise. Drives visuals and inflow. */
  intensity = 0;
  t = 0;
  next: number;

  constructor(rng: Rng) {
    this.next = DAY * rng.range(0.6, 1.1);
  }

  /** rainMul: showers come this many times as often (the biome's rainfall). */
  update(dt: number, season: number, rng: Rng, rainMul = 1): 'start' | 'stop' | null {
    this.intensity += ((this.raining ? 1 : 0) - this.intensity) * Math.min(1, dt * 0.4);
    if (this.raining) {
      this.t -= dt;
      if (this.t > 0) return null;
      this.raining = false;
      this.next = (DAY * RAIN_GAP[season] * rng.range(0.6, 1.4)) / rainMul;
      return 'stop';
    }
    this.next -= dt;
    if (this.next > 0) return null;
    this.raining = true;
    this.t = rng.range(35, 80);
    return 'start';
  }
}

import { DAY } from './config';
import type { App } from './app';
import type { SpeciesId } from './species';
import type { BiomeId } from './biome';

/** Console helpers for looking at the world in development builds: `dev.setup()`, `dev.look(z, x, y)`, `dev.season(k)`. */
export function installDevtools(app: App): void {
  const dev = {
    /** Start a throwaway colony and fast-forward it, paused at the given time of day. */
    setup(seed = 12345, col = 200, secs = 900, dayFrac = 0.42, hud = false, species: SpeciesId = 'lasius', biome: BiomeId = 'meadow'): void {
      app.newGame({ species, rival: 'calm', abundance: 'normal', biome, seed, name: 'Test' });
      app.sim.releaseQueen(col);
      app.hud.setPrompt(null);
      for (let i = 0; i < 12 * secs; i++) app.sim.update(1 / 12);
      const s = app.sim;
      s.time = Math.floor(s.time / DAY) * DAY + DAY + dayFrac * DAY;
      s.syncClock();
      s.weather.raining = false;
      s.weather.intensity = 0;
      document.getElementById('hud')!.style.visibility = hud ? '' : 'hidden';
      app.setSpeed(0);
    },
    look(zoom: number, x: number, y: number): void {
      const c = app.renderer.cam;
      c.zoom = zoom;
      c.x = x;
      c.y = y;
      c.clamp();
    },
    season(k: number, dayFrac = 0.42, rain = 0): void {
      const s = app.sim;
      s.time = (k * 3 + 1) * DAY + dayFrac * DAY;
      s.syncClock();
      s.weather.raining = rain > 0;
      s.weather.intensity = rain;
    },
  };
  Object.assign(window, { dev });
}

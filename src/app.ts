import { W, H, GROUND, DIRT, TUNNEL, idx, clampCol, ROLE_QUEEN, ROLE_NURSERY, ROLE_FOOD, ROLE_MIDDEN, ROLE_GRANARY } from './config';
import { Sim, TOOLS, type GameOptions, type ToolId } from './sim';
import { Renderer, type Overlay } from './render';
import { Sound } from './audio';
import { Photo } from './ui/photo';
import { Almanac } from './almanac';
import { Hud } from './ui/hud';
import { Menus } from './ui/menus';
import { saveGame, loadGame, deleteSave } from './save';
import { Ant, INTENT_TEXT } from './ant';
import { CRITTER_INFO, FOOD_INFO, type Critter } from './ecology';
import { SPECIES_LIST } from './species';
import { BIOME_LIST } from './biome';
import { fmt } from './ui/dom';

export interface Settings {
  volume: number;
  trails: boolean;
  labels: boolean;
  autosave: boolean;
}

const SETTINGS_KEY = 'formica.settings.v1';
const SPEEDS = [1, 3, 10, 30];

function loadSettings(): Settings {
  const def: Settings = { volume: 0.6, trails: true, labels: true, autosave: true };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...def, ...(JSON.parse(raw) as Partial<Settings>) } : def;
  } catch {
    return def;
  }
}

/** Owns the current sim (a live demo on the title screen, or a real game) and ties input, UI and rendering together. */
export class App {
  readonly canvas = document.getElementById('view') as HTMLCanvasElement;
  readonly renderer = new Renderer(this.canvas);
  readonly sound = new Sound();
  readonly settings = loadSettings();
  readonly hud: Hud;
  readonly menus: Menus;
  readonly photo: Photo;
  readonly almanac = new Almanac();
  private almanacT = 0;
  state: 'title' | 'playing' | 'over' = 'title';
  sim!: Sim;
  paused = false;
  speed = 1;
  tool: ToolId = 'inspect';
  selected: Ant | Critter | null = null;
  follow = false;
  overlay: Overlay = 'none';
  hover: { x: number; y: number } | null = null;
  private lastSpeed = 1;
  private warm = 0;
  private acc = 0;
  private last = performance.now();
  private drag: { x: number; y: number; moved: boolean; button: number } | null = null;
  /** Fingers (or the mouse) on the canvas, for panning and pinch zoom. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private readonly keys = new Set<string>();
  private ignoreUntil = 0;

  constructor() {
    this.sound.volume = this.settings.volume;
    this.hud = new Hud(this);
    this.menus = new Menus(this);
    this.photo = new Photo(this);
    this.bindInput();
    window.addEventListener('beforeunload', () => {
      if (this.state === 'playing' && this.settings.autosave) saveGame(this.sim);
    });
  }

  start(): void {
    this.toTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ── flow ────────────────────────────────────────────────────────────

  toTitle(): void {
    this.photo.close();
    if (this.state === 'playing' && this.sim && this.settings.autosave) saveGame(this.sim);
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const sp = SPECIES_LIST[seed % SPECIES_LIST.length];
    // The title backdrop wanders between biomes too
    const biome = BIOME_LIST[(seed >>> 4) % BIOME_LIST.length].id;
    const sim = new Sim({ species: sp.id, rival: 'none', abundance: 'plenty', biome, seed, name: 'Demo' }, true);
    const col = clampCol(W * 0.6 + sim.rng.range(-20, 20));
    sim.releaseQueen(col);
    this.sim = sim;
    this.state = 'title';
    this.paused = false;
    this.selected = null;
    this.follow = false;
    this.tool = 'inspect';
    this.speed = 1;
    this.warm = 1000;
    this.renderer.attach(sim);
    const cam = this.renderer.cam;
    cam.zoom = 2;
    cam.x = col - 22;
    cam.y = GROUND + 12;
    cam.clamp();
    this.hud.show(false);
    this.menus.replace('title');
  }

  newGame(opts: GameOptions): void {
    this.begin(new Sim(opts));
    this.hud.setPrompt('Click on the ground to release your queen');
  }

  continueGame(): void {
    const sim = loadGame();
    if (!sim) {
      deleteSave();
      this.menus.replace('title');
      return;
    }
    this.begin(sim);
    const p = sim.player;
    if (p && p.roots.length) {
      const cam = this.renderer.cam;
      cam.zoom = 2.2;
      cam.x = p.roots[0] % W;
      cam.y = GROUND + 14;
      cam.clamp();
    }
    this.hud.toast(`Welcome back to ${sim.opts.name}.`, 'info');
  }

  private begin(sim: Sim): void {
    this.sim = sim;
    this.state = 'playing';
    this.selected = null;
    this.follow = false;
    this.tool = 'inspect';
    this.acc = 0;
    this.renderer.attach(sim);
    const cam = this.renderer.cam;
    cam.zoom = 1;
    cam.clamp();
    this.menus.hide();
    this.paused = false;
    this.speed = 1;
    this.lastSpeed = 1;
    this.hud.reset();
    this.hud.show(true);
  }

  onMenusClosed(): void {
    if (this.state === 'playing') this.paused = false;
    // The click that closed a menu must not also land on the world underneath
    this.ignoreUntil = performance.now() + 300;
  }

  openPause(): void {
    if (this.state !== 'playing' || this.menus.open) return;
    this.paused = true;
    this.menus.show('pause');
  }

  save(): boolean {
    const ok = saveGame(this.sim);
    if (ok) this.hud.toast('Game saved.', 'info');
    return ok;
  }

  saveSettings(): void {
    this.sound.volume = this.settings.volume;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // storage unavailable
    }
  }

  private gameOver(): void {
    this.photo.close();
    this.state = 'over';
    deleteSave();
    this.hud.setPrompt(null);
    this.hud.show(false);
    this.menus.replace('over');
  }

  setSpeed(s: number): void {
    if (s > 0) this.lastSpeed = s;
    this.speed = s;
    this.hud.refreshSpeed();
  }

  togglePause(): void {
    this.setSpeed(this.speed === 0 ? this.lastSpeed : 0);
  }

  /** Cycle the view: plain, then scent (trails, home ranges, alarms), then soil warmth. */
  cycleOverlay(): void {
    this.overlay = this.overlay === 'none' ? 'scent' : this.overlay === 'scent' ? 'heat' : 'none';
    this.hud.refreshOverlay();
  }

  setTool(t: ToolId): void {
    this.tool = t;
    document.body.dataset.tool = t;
    this.hud.refreshTools();
    this.hud.setTip(null, 0, 0);
  }

  select(t: Ant | Critter | null): void {
    this.selected = t;
    if (!t) this.follow = false;
    this.hud.refreshInspector();
  }

  setFollow(f: boolean): void {
    this.follow = f;
  }

  // ── loop ────────────────────────────────────────────────────────────

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const s = this.sim;
    if (this.state === 'title') {
      if (this.warm > 0) {
        // Grow the demo colony quickly before showing it off
        const t0 = performance.now();
        while (this.warm > 0 && performance.now() - t0 < 12) {
          s.update(1 / 12);
          this.warm -= 1 / 12;
        }
      } else this.step(dt * 2);
    } else if (this.state === 'playing' && !this.paused) this.step(dt * this.speed);

    this.drainEvents();
    if (s.wantsSave) {
      s.wantsSave = false;
      if (this.state === 'playing' && this.settings.autosave) saveGame(s);
    }
    this.updateCamera(dt);
    this.sound.setRain(this.state === 'playing' && !this.paused && this.speed > 0 && !s.isWinter ? s.weather.intensity : 0);
    const running = this.state === 'title' || (this.state === 'playing' && !this.paused);
    // Photo mode shows the world alone: no cursor, selection ring, labels or overlay
    const live = this.state === 'playing' && !this.photo.active;
    this.renderer.draw(dt, {
      tool: this.photo.active ? 'inspect' : this.tool,
      hover: live ? this.hover : null,
      selected: this.photo.active ? null : this.selected,
      trails: this.settings.trails,
      labels: this.settings.labels && live,
      overlay: live ? this.overlay : 'none',
      vdt: running ? dt * Math.min(3, this.state === 'title' ? 1 : this.speed) : 0,
    });
    // How much of the view is the meadow rather than soil, for the ambience
    const cam = this.renderer.cam;
    const half = cam.vh / 2 / cam.scale;
    const near = Math.max(0, Math.min(1, (GROUND - (cam.y - half)) / (half * 2)));
    const audible = this.state === 'title' || (this.state === 'playing' && !this.paused && this.speed > 0);
    this.sound.ambience(s.light, s.season, s.weather.intensity, near, audible && !this.menus.open);
    if (audible && cam.scale > 5 && this.renderer.digsInView > 0) this.sound.scratch(this.renderer.digsInView / 3);
    if (this.state === 'playing') {
      this.hud.update(now);
      if ((this.almanacT -= dt) <= 0) {
        this.almanacT = 1;
        const fresh = this.almanac.check(s);
        if (fresh.length > 2) this.hud.toast(`${fresh.length} new almanac entries, from ${fresh[0].title} to ${fresh[fresh.length - 1].title}`, 'info');
        else for (const e of fresh) this.hud.toast(`New in the almanac: ${e.title}`, 'info');
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private step(simDt: number): void {
    const step = this.speed >= 10 ? 1 / 20 : 1 / 60;
    this.acc += simDt;
    let n = 0;
    while (this.acc >= step && n < 60) {
      this.sim.update(step);
      this.acc -= step;
      n++;
    }
    if (n >= 60) this.acc = 0;
  }

  private drainEvents(): void {
    const s = this.sim;
    if (!s.events.length) return;
    for (const e of s.events.splice(0)) {
      if (this.state !== 'playing') continue;
      if (e.kind === 'gameover') {
        this.sound.bad();
        this.gameOver();
        continue;
      }
      if (e.kind === 'victory') {
        this.sound.chime();
        this.paused = true;
        this.menus.show('victory');
        continue;
      }
      if (e.kind === 'milestone') {
        this.hud.celebrate(e);
        this.sound.chime();
        continue;
      }
      if (e.kind === 'season') {
        this.hud.seasonBanner(s.season);
        this.sound.good();
        continue;
      }
      this.hud.toast(e.text, e.tone);
      if (e.tone === 'bad') this.sound.bad();
      else if (e.tone === 'good') this.sound.good();
    }
    this.hud.logChanged();
  }

  private updateCamera(dt: number): void {
    const cam = this.renderer.cam;
    const d = window.devicePixelRatio || 1;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('ArrowLeft')) dx += 1;
    if (this.keys.has('ArrowRight')) dx -= 1;
    if (this.keys.has('ArrowUp')) dy += 1;
    if (this.keys.has('ArrowDown')) dy -= 1;
    if (dx || dy) {
      cam.pan(dx * 700 * d * dt, dy * 700 * d * dt);
      this.follow = false;
    }
    const sel = this.selected;
    if (sel && sel.dead) {
      this.select(null);
      return;
    }
    if (this.follow && sel) {
      const k = 1 - Math.exp(-dt * 6);
      if (sel instanceof Ant) cam.approach(sel.x, sel.y, k);
      else cam.approach(sel.x, sel.under ? sel.y : this.sim.world.top[clampCol(sel.x)] - 2 - sel.alt, k);
    }
  }

  // ── input ───────────────────────────────────────────────────────────

  private bindInput(): void {
    const c = this.canvas;
    const dpr = (): number => window.devicePixelRatio || 1;
    const spread = (): { d: number; x: number; y: number } => {
      const [a, b] = [...this.touches.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    c.addEventListener('pointerdown', (e) => {
      this.sound.unlock();
      if (this.state !== 'playing' || performance.now() < this.ignoreUntil) return;
      c.setPointerCapture(e.pointerId);
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        // A second finger: pinch to zoom, and never a tap
        this.pinch = spread().d;
        if (this.drag) this.drag.moved = true;
        return;
      }
      this.drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
    });
    c.addEventListener('pointermove', (e) => {
      const d = dpr();
      const wp = this.renderer.cam.toWorld(e.clientX * d, e.clientY * d);
      this.hover = e.pointerType === 'touch' ? null : wp;
      const last = this.touches.get(e.pointerId);
      if (last && this.touches.size === 2) {
        const before = spread();
        last.x = e.clientX;
        last.y = e.clientY;
        const after = spread();
        const cam = this.renderer.cam;
        if (this.pinch > 0 && after.d > 0) cam.zoomAt(after.d / this.pinch, after.x * d, after.y * d);
        cam.pan((after.x - before.x) * d, (after.y - before.y) * d);
        this.pinch = after.d;
        this.follow = false;
        return;
      }
      if (this.drag && last) {
        if (!this.drag.moved && Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > (e.pointerType === 'touch' ? 10 : 5)) this.drag.moved = true;
        if (this.drag.moved) {
          this.renderer.cam.pan((e.clientX - last.x) * d, (e.clientY - last.y) * d);
          this.follow = false;
        }
      }
      if (last) {
        last.x = e.clientX;
        last.y = e.clientY;
      }
      if (this.state === 'playing' && !this.photo.active && this.tool === 'inspect' && !this.drag?.moved) {
        this.hud.setTip(this.hoverInfo(wp.x, wp.y), e.clientX, e.clientY);
      } else this.hud.setTip(null, 0, 0);
    });
    const lift = (e: PointerEvent): void => {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = 0;
    };
    c.addEventListener('pointercancel', (e) => {
      lift(e);
      this.drag = null;
    });
    c.addEventListener('pointerup', (e) => {
      lift(e);
      // Lifting one finger of a pinch leaves the other still down: no tap from either
      if (this.touches.size > 0) return;
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved || this.state !== 'playing') return;
      if (d.button === 2) {
        this.setTool('inspect');
        return;
      }
      if (d.button !== 0) return;
      const wp = this.renderer.cam.toWorld(e.clientX * dpr(), e.clientY * dpr());
      this.click(wp.x, wp.y);
    });
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.hud.setTip(null, 0, 0);
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.state !== 'playing') return;
      const d = dpr();
      this.renderer.cam.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX * d, e.clientY * d);
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) {
        this.sound.unlock();
        this.sound.click();
      }
    });
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'Escape' && this.photo.active) {
      this.photo.close();
      return;
    }
    if (e.code === 'KeyH' && this.state === 'playing' && !this.menus.open) {
      this.photo.toggle();
      return;
    }
    if (e.code === 'Escape') {
      if (this.menus.open) {
        const cur = this.menus.current;
        if (cur !== 'title' && cur !== 'over') this.menus.back();
        return;
      }
      if (this.state !== 'playing') return;
      if (this.tool !== 'inspect') this.setTool('inspect');
      else if (this.selected) this.select(null);
      else this.openPause();
      return;
    }
    if (this.state !== 'playing' || this.menus.open) return;
    // Photo mode only pans and zooms
    if (this.photo.active && !e.code.startsWith('Arrow') && e.key !== '+' && e.key !== '=' && e.key !== '-' && e.key !== '_') return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.togglePause();
      return;
    }
    if (/^Digit[1-4]$/.test(e.code)) {
      this.setSpeed(SPEEDS[Number(e.code.slice(5)) - 1]);
      return;
    }
    const tool = TOOLS.find((x) => `Key${x.key}` === e.code);
    if (tool) {
      this.setTool(tool.id === this.tool ? 'inspect' : tool.id);
      return;
    }
    if (e.code === 'KeyP') {
      this.cycleOverlay();
      return;
    }
    if (e.code === 'KeyF' && this.selected) {
      this.follow = !this.follow;
      this.hud.refreshInspector();
      return;
    }
    if (e.code.startsWith('Arrow')) {
      e.preventDefault();
      this.keys.add(e.code);
      return;
    }
    const cam = this.renderer.cam;
    if (e.key === '+' || e.key === '=') cam.zoomAt(1.25, cam.vw / 2, cam.vh / 2);
    if (e.key === '-' || e.key === '_') cam.zoomAt(0.8, cam.vw / 2, cam.vh / 2);
  }

  private click(wx: number, wy: number): void {
    const s = this.sim;
    if (this.photo.active) return;
    if (!s.player) {
      const col = clampCol(wx);
      if (wy > s.world.top[col] + 8) {
        this.hud.flash('Click on the surface to release her.');
        return;
      }
      if (col < 16 || col > W - 18) {
        this.hud.flash('Too close to the edge of the meadow.');
        return;
      }
      s.releaseQueen(col);
      this.hud.setPrompt(null);
      this.sound.drop();
      const cam = this.renderer.cam;
      cam.zoom = 2.4;
      cam.x = col;
      cam.y = GROUND + 8;
      cam.clamp();
      this.select(s.player!.queen);
      return;
    }
    if (this.tool === 'inspect') {
      const p = this.renderer.pick(s, wx, wy);
      this.select(p.critter ?? p.ant);
      return;
    }
    const err = s.useTool(this.tool, wx, wy);
    if (err) {
      this.hud.flash(err);
      this.sound.error();
      return;
    }
    if (this.tool === 'squish') this.sound.thud();
    else this.sound.drop();
  }

  /** Short description of whatever is under the cursor. */
  private hoverInfo(x: number, y: number): string | null {
    const s = this.sim;
    const p = this.renderer.pick(s, x, y);
    if (p.critter) {
      const info = CRITTER_INFO[p.critter.kind];
      return `${info.label} · ${Math.max(0, Math.round(p.critter.hp))}/${info.hp} health`;
    }
    if (p.ant) {
      const a = p.ant;
      const who = a.colony === s.player ? a.casteName : `${a.colony.kin ? 'Kin' : 'Rival'} ${a.casteName.toLowerCase()}`;
      return `${who} · ${INTENT_TEXT[a.intent]}`;
    }
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) return null;
    const g = s.world.top[cx];
    const wi = idx(cx, cy);
    if (s.world.wood[wi] && s.world.cells[wi] === DIRT) return `Rotting log · ${s.player?.species.id === 'camponotus' ? 'your carpenter ants chew through it fast' : 'tough going for anyone but carpenter ants'}`;
    if (y < g + 1 && y > g - 4) {
      const f = s.eco.foodNear(x, 1.6);
      if (f) return `${FOOD_INFO[f.kind].label} · ${Math.ceil(f.amount)} ${f.type === 0 ? 'sugar' : 'protein'}`;
      if (s.covers.some((c) => Math.abs(c.x - x) <= 6)) return 'Leaf shelter · keeps the rain out';
      const pit = s.danger.pits.find((q) => Math.abs(q.x + 0.5 - x) < 2.4);
      if (pit) return `Antlion pit · ${pit.sated > 0 ? 'the antlion has eaten and is lying low' : 'an ant that slips in needs a nestmate to pull her out'}`;
      return null;
    }
    const hd = s.eco.herdAt(x, y);
    if (hd) {
      const who = hd.owner === s.player ? 'tended by your colony' : hd.owner ? 'tended by the rival' : 'untended';
      return `Root aphids · ${Math.round(hd.size)} aphids · ${Math.floor(hd.honey)} honeydew · ${who}`;
    }
    const i = idx(cx, cy);
    if (s.world.cells[i] !== TUNNEL) return null;
    if (s.world.water[i]) return 'Flooded tunnel';
    const owner = s.nestOwner(i);
    const mine = owner === s.player;
    const room = s.world.room[i];
    if (!mine) return owner ? `Rival nest · ${owner.species.name}` : null;
    const pl = s.player!;
    const temp = `${Math.round(s.tempAt(cy))}°C`;
    switch (room) {
      case ROLE_QUEEN: return `Queen chamber · ${temp}`;
      case ROLE_NURSERY: return `Nursery · ${temp} · ${pl.brood.length} brood in the colony`;
      case ROLE_FOOD: return `Food store · ${fmt(pl.stored)} / ${fmt(pl.cap)} stored`;
      case ROLE_MIDDEN: return `Midden · ${fmt(pl.midden)} dead`;
      case ROLE_GRANARY: return `Granary · ${fmt(pl.seeds)} / ${fmt(pl.seedCap)} seeds`;
      default: return `Tunnel · ${temp}`;
    }
  }
}

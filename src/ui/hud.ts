import { h, fmt, setText, icon } from './dom';
import { ICON } from './icons';
import { pix, Counter, Banners, floatText, pop } from './juice';
import { W, DAY, SEASONS, ROLE_NAMES } from '../config';
import { TOOLS, MILESTONES, type ToolId, type Tone, type GameEvent, type Sim } from '../sim';
import { FOCUS, type Focus } from '../colony';
import { Ant, INTENT_TEXT, TASK_TEXT, TASKS, LOAD_SUGAR, LOAD_PROTEIN, LOAD_BROOD, LOAD_CORPSE, LOAD_SEED } from '../ant';
import type { Task } from '../ant';
import { CRITTER_INFO, type CritterKind } from '../ecology';
import { SPECIES } from '../species';
import { drawChart, type Series } from './charts';
import type { App } from '../app';

type Tab = 'colony' | 'graphs' | 'goals' | 'log';

const SPEEDS = [0, 1, 3, 10, 30];
const FOCUS_ICON: Record<Focus, string> = { balanced: ICON.balance, forage: ICON.basket, expand: ICON.tunnels, defend: ICON.shield };
const CRITTER_DOT: Record<CritterKind, string> = {
  spider: '#3a2f2a', beetle: '#2e4636', caterpillar: '#86b84f', centipede: '#a3461f', bird: '#d8743a', ladybird: '#d6282a',
};
const WORK: [Task, string][] = [
  ['dig', 'Digging'], ['forage', 'Foraging'], ['nurse', 'Nursing'], ['clean', 'Undertaking'], ['guard', 'Guarding'], ['raid', 'Raiding'], ['none', 'Resting'],
];
const SEASON_LINE = ['Food is returning to the meadow', 'Fruit is plentiful', 'Stock up before winter', 'The colony huddles deep'];
const TOAST_ICON: Record<Tone, string> = { good: 'medal', bad: 'heart', info: 'season_1' };
const DONE_TEXT = ['dug', 'foraged', 'nursed', 'buried the dead', 'stood guard'];

/** How far along a goal is, for the ones that have a number to chase. */
export function goalProgress(s: Sim, id: string): { cur: number; max: number; unit: string } | null {
  const p = s.player;
  if (!p) return null;
  switch (id) {
    case 'first': return { cur: Math.min(1, p.stats.born), max: 1, unit: 'worker' };
    case 'pop50': return { cur: p.pop, max: 50, unit: 'ants' };
    case 'store': return { cur: p.stored, max: 100, unit: 'food' };
    case 'pop500': return { cur: p.pop, max: 500, unit: 'ants' };
    case 'pop1000': return { cur: p.pop, max: 1000, unit: 'ants' };
    case 'flight': return { cur: p.pop, max: 250, unit: 'ants' };
    default: return null;
  }
}

/** In-game overlay: colony card, clock, resources, speed, tools, side panel, inspector, toasts and celebrations. */
export class Hud {
  private readonly root = document.getElementById('hud')!;
  private readonly portrait = h('div', { class: 'portrait' });
  private readonly cname = h('span', { class: 'cname' });
  private readonly pop = h('span', { class: 'pop' });
  private readonly popC = new Counter(this.pop);
  private readonly castes = h('div', { class: 'sub' });
  private readonly broodEl = h('div', { class: 'brood' });
  private readonly alert = h('div', { class: 'alert' });
  private readonly next = h('div', { class: 'next-goal' });
  private readonly nextTitle = h('span', { class: 'ng-title' });
  private readonly nextVal = h('span', { class: 'ng-val' });
  private readonly nextBar = h('i');
  private readonly seasonIco = h('span', { class: 'season-ico' });
  private readonly dayText = h('span', { class: 'day' });
  private readonly sunMark = h('span', { class: 'sun-mark' });
  private readonly weatherEl = h('span', { class: 'weather' });
  private readonly sugarV = h('span', { class: 'v' });
  private readonly sugarC = new Counter(this.sugarV);
  private readonly sugarBar = h('i');
  private readonly proteinV = h('span', { class: 'v' });
  private readonly proteinC = new Counter(this.proteinV);
  private readonly proteinBar = h('i');
  private readonly pointsV = h('span', { class: 'v' });
  private readonly pointsC = new Counter(this.pointsV);
  private readonly sugarChip: HTMLElement;
  private readonly proteinChip: HTMLElement;
  private readonly pointsChip: HTMLElement;
  private readonly speedBtns: HTMLButtonElement[] = [];
  private readonly toolBtns = new Map<ToolId, HTMLButtonElement>();
  private readonly toolCosts = new Map<ToolId, HTMLElement>();
  private readonly toolTip = h('div', { class: 'tool-tip hidden' });
  private tab: Tab = 'colony';
  private readonly side = h('div', { class: 'card side' });
  private readonly tabBtns = new Map<Tab, HTMLButtonElement>();
  private readonly tabInk = h('span', { class: 'tab-ink' });
  private readonly panes = new Map<Tab, HTMLElement>();
  private readonly focusBtns = new Map<Focus, HTMLButtonElement>();
  private readonly focusHint = h('p', { class: 'hint' });
  private readonly work = new Map<Task, { row: HTMLElement; bar: HTMLElement; n: HTMLElement }>();
  private readonly ages = h('div', { class: 'ages' });
  private readonly nest = new Map<string, HTMLElement>();
  private readonly rivalBox = h('section', { class: 'rival' });
  private readonly rivalText = h('div', { class: 'sub' });
  private readonly kinBox = h('section', { class: 'rival hidden' });
  private readonly kinText = h('div', { class: 'sub' });
  private readonly youBar = h('i', { class: 'you' });
  private readonly themBar = h('i', { class: 'them' });
  private readonly raidBtn = h('button', { class: 'btn small wide' });
  private readonly raidText = h('div', { class: 'sub' });
  private readonly goalsList = h('ul', { class: 'goals' });
  private readonly goalsCount = h('span', { class: 'count' });
  private readonly logList = h('ul', { class: 'log' });
  private readonly popChart = h('canvas', { class: 'chart' });
  private readonly foodChart = h('canvas', { class: 'chart' });
  private readonly lossChart = h('canvas', { class: 'chart short' });
  private readonly popKey = h('div', { class: 'chart-key' });
  private chartsKey = '';
  private readonly insp = h('div', { class: 'card inspector hidden' });
  private readonly inspDot = h('span', { class: 'dot' });
  private readonly inspTitle = h('div', { class: 'insp-title' });
  private readonly inspSub = h('div', { class: 'sub' });
  private readonly inspRows = new Map<string, { row: HTMLElement; v: HTMLElement }>();
  private readonly inspHp = h('i');
  private readonly followBtn = h('button', { class: 'btn small' });
  private readonly overlayBtn = h('button', { class: 'card icon-btn', title: 'Scent and soil-warmth view (P)', 'aria-label': 'Scent and warmth view', onclick: () => this.app.cycleOverlay() }, icon(ICON.eye));
  private readonly legend = h('div', { class: 'card legend hidden' });
  private readonly toasts = h('div', { class: 'toasts' });
  private readonly bannerHost = h('div', { class: 'banners' });
  private readonly banners = new Banners(this.bannerHost);
  private readonly prompt = h('div', { class: 'prompt hidden' });
  private readonly tip = h('div', { class: 'tip hidden' });
  private lastT = 0;
  private lastFrame = 0;
  private lastPoints = -1;
  private shownSeason = -1;
  private shownSpecies = '';
  private shownWeather = '';
  private goalsKey = '';
  private logKey = '';

  constructor(private readonly app: App) {
    const r = this.root;

    // Colony card
    const card = h('div', { class: 'card colony' },
      h('div', { class: 'colony-head' }, this.portrait, h('div', { class: 'grow' }, this.cname,
        h('div', { class: 'pop-row' }, this.pop, h('span', { class: 'pop-label' }, 'ants')))),
      this.castes, this.broodEl,
      this.next,
      this.alert);
    this.next.append(
      h('div', { class: 'ng-head' }, pix('medal', 'pix ng-ico'), this.nextTitle, this.nextVal),
      h('div', { class: 'ng-track' }, this.nextBar));

    // Clock
    const clock = h('div', { class: 'card clock' },
      h('div', { class: 'clock-top' }, this.seasonIco, this.dayText, this.weatherEl),
      h('div', { class: 'daybar' }, this.sunMark));

    // Resources, speed, menu
    this.sugarChip = h('div', { class: 'chip sugar', title: 'Sugar in store. Workers eat it.' },
      pix('tool_sugar'), this.sugarV, h('span', { class: 'mini' }, this.sugarBar));
    this.proteinChip = h('div', { class: 'chip protein', title: 'Protein in store. The queen and larvae need it.' },
      pix('tool_protein'), this.proteinV, h('span', { class: 'mini' }, this.proteinBar));
    this.pointsChip = h('div', { class: 'chip points', title: 'Keeper points: earned each dawn and from goals, spent on tools.' }, pix('honey'), this.pointsV);
    const speed = h('div', { class: 'card speed' });
    SPEEDS.forEach((s) => {
      const b = h('button', { title: s === 0 ? 'Pause (Space)' : `${s}× speed`, onclick: () => (s === 0 ? this.app.togglePause() : this.app.setSpeed(s)) });
      if (s === 0) b.append(icon(ICON.pause));
      else b.textContent = `${s}×`;
      this.speedBtns.push(b);
      speed.append(b);
    });
    const menuBtn = h('button', { class: 'card icon-btn', title: 'Menu (Esc)', 'aria-label': 'Menu', onclick: () => this.app.openPause() }, icon(ICON.menu));
    const photoBtn = h('button', { class: 'card icon-btn', title: 'Photo mode (H)', 'aria-label': 'Photo mode', onclick: () => this.app.photo.open() }, icon(ICON.camera));
    const topRight = h('div', { class: 'top-right' }, h('div', { class: 'card res' }, this.sugarChip, this.proteinChip, this.pointsChip), speed, this.overlayBtn, photoBtn, menuBtn);

    // Toolbar
    const bar = h('div', { class: 'card toolbar' });
    for (const t of TOOLS) {
      const cost = t.cost ? h('span', { class: 'tcost' }, String(t.cost)) : null;
      if (cost) this.toolCosts.set(t.id, cost);
      const b = h('button', { class: 'tool', onclick: () => this.app.setTool(this.app.tool === t.id && t.id !== 'inspect' ? 'inspect' : t.id) },
        h('span', { class: 'tico' }, pix(`tool_${t.id}`)),
        h('span', { class: 'tname' }, t.name),
        cost,
        h('span', { class: 'tkey' }, t.key),
      );
      b.addEventListener('mouseenter', () => this.showToolTip(t.id));
      b.addEventListener('mouseleave', () => this.showToolTip(null));
      this.toolBtns.set(t.id, b);
      bar.append(b);
    }
    const toolWrap = h('div', { class: 'tool-wrap' }, this.toolTip, bar);

    // Side panel
    const tabs = h('div', { class: 'tabs' });
    for (const [t, label] of [['colony', 'Colony'], ['graphs', 'Graphs'], ['goals', 'Goals'], ['log', 'Log']] as [Tab, string][]) {
      const b = h('button', { onclick: () => this.setTab(t) }, label, t === 'goals' ? this.goalsCount : null);
      this.tabBtns.set(t, b);
      tabs.append(b);
    }
    tabs.append(this.tabInk);
    const collapse = h('button', { class: 'icon-btn collapse', title: 'Hide panel', 'aria-label': 'Toggle panel', onclick: () => this.side.classList.toggle('collapsed') }, icon(ICON.chevron));
    this.panes.set('colony', this.buildColonyPane());
    this.panes.set('graphs', h('div', { class: 'pane' },
      h('section', null, h('h4', null, 'Population'), this.popChart, this.popKey),
      h('section', null, h('h4', null, 'Stores'), this.foodChart,
        h('div', { class: 'chart-key' }, h('span', null, h('i', { style: 'background:var(--sugar)' }), 'Sugar'), h('span', null, h('i', { style: 'background:var(--protein)' }), 'Protein'))),
      h('section', null, h('h4', null, 'Ants lost'), this.lossChart)));
    this.panes.set('goals', h('div', { class: 'pane' }, this.goalsList));
    this.panes.set('log', h('div', { class: 'pane' }, this.logList));
    this.side.append(h('div', { class: 'side-head' }, tabs, collapse), ...this.panes.values());
    this.setTab('colony');
    // setTab opens the panel, so close it after: small screens start with it tucked away
    if (innerWidth < 900) this.side.classList.add('collapsed');

    // Inspector
    for (const k of ['Doing', 'Job', 'Age', 'Carrying', 'Where', 'Habits']) {
      const v = h('span');
      const row = h('div', { class: 'row' }, h('span', { class: 'k' }, k), v);
      this.inspRows.set(k, { row, v });
    }
    this.followBtn.addEventListener('click', () => {
      this.app.setFollow(!this.app.follow);
      this.refreshInspector();
    });
    this.insp.append(
      h('div', { class: 'insp-head' }, this.inspDot, h('div', { class: 'grow' }, this.inspTitle, this.inspSub),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => this.app.select(null) }, icon(ICON.close))),
      ...[...this.inspRows.values()].map((r2) => r2.row),
      h('div', { class: 'hp' }, this.inspHp),
      h('div', { class: 'insp-actions' }, this.followBtn),
    );

    r.append(h('div', { class: 'left-col' }, card, clock, this.insp), topRight, this.legend, this.side, toolWrap, this.toasts, this.prompt, this.tip);
    document.body.append(this.bannerHost);
  }

  private buildColonyPane(): HTMLElement {
    const focusGrid = h('div', { class: 'focus-grid' });
    for (const f of Object.keys(FOCUS) as Focus[]) {
      const b = h('button', {
        onclick: () => {
          const p = this.app.sim.player;
          if (p) p.focus = f;
          this.refreshFocus();
          pop(b);
        },
      }, icon(FOCUS_ICON[f]), FOCUS[f].label);
      this.focusBtns.set(f, b);
      focusGrid.append(b);
    }
    const workEl = h('div', { class: 'bars' });
    for (const [t, label] of WORK) {
      const bar = h('i');
      const n = h('span', { class: 'n' });
      const row = h('div', { class: `bar-row task-${t}` }, h('span', { class: 'k' }, label), h('span', { class: 'track' }, bar), n);
      this.work.set(t, { row, bar, n });
      workEl.append(row);
    }
    workEl.append(this.ages);
    const nestEl = h('div', { class: 'nest-grid' });
    for (const k of ['Stores', 'In crops', 'Food chambers', 'Granary', 'Nurseries', 'Middens', 'Brood warmth', 'Queen chamber', 'Food shared', 'Cells dug', 'Food gathered', 'Enemies killed', 'Ants lost']) {
      const v = h('span', { class: 'v' });
      this.nest.set(k, v);
      nestEl.append(h('div', null, h('span', { class: 'k' }, k), v));
    }
    this.raidBtn.addEventListener('click', () => this.raidClick());
    this.rivalBox.append(
      h('h4', null, 'Rival'),
      this.rivalText,
      h('div', { class: 'versus' }, this.youBar, this.themBar),
      this.raidBtn,
      this.raidText,
    );
    this.kinBox.append(h('h4', null, 'Mother colony'), this.kinText);
    return h('div', { class: 'pane' },
      h('section', null, h('h4', null, 'Focus'), focusGrid, this.focusHint),
      h('section', null, h('h4', null, 'Workforce'), workEl),
      h('section', null, h('h4', null, 'Nest'), nestEl),
      this.kinBox,
      this.rivalBox,
    );
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (!on) this.banners.clear();
  }

  reset(): void {
    this.toasts.replaceChildren();
    this.banners.clear();
    this.goalsKey = '';
    this.logKey = '';
    this.shownSeason = -1;
    this.shownSpecies = '';
    this.shownWeather = '';
    this.lastT = 0;
    this.lastPoints = -1;
    for (const c of [this.popC, this.sugarC, this.proteinC, this.pointsC]) c.reset();
    this.setPrompt(null);
    this.setTip(null, 0, 0);
    this.refreshSpeed();
    this.refreshTools();
    this.refreshFocus();
    this.refreshInspector();
  }

  private setTab(t: Tab): void {
    this.tab = t;
    for (const [k, b] of this.tabBtns) b.classList.toggle('on', k === t);
    for (const [k, p] of this.panes) p.classList.toggle('hidden', k !== t);
    this.side.classList.remove('collapsed');
    this.lastT = 0;
    requestAnimationFrame(() => {
      const b = this.tabBtns.get(t)!;
      this.tabInk.style.transform = `translateX(${b.offsetLeft}px)`;
      this.tabInk.style.width = `${b.offsetWidth}px`;
    });
  }

  refreshSpeed(): void {
    this.speedBtns.forEach((b, k) => b.classList.toggle('on', SPEEDS[k] === this.app.speed));
  }

  refreshTools(): void {
    for (const [id, b] of this.toolBtns) {
      const on = id === this.app.tool;
      if (on && !b.classList.contains('on')) pop(b);
      b.classList.toggle('on', on);
    }
    this.showToolTip(null);
  }

  private refreshFocus(): void {
    const f = this.app.sim?.player?.focus ?? 'balanced';
    for (const [k, b] of this.focusBtns) b.classList.toggle('on', k === f);
    setText(this.focusHint, FOCUS[f].desc);
  }

  private showToolTip(id: ToolId | null): void {
    const t = TOOLS.find((x) => x.id === (id ?? this.app.tool));
    if (!t || (!id && t.id === 'inspect')) {
      this.toolTip.classList.add('hidden');
      return;
    }
    const cost = this.app.sim?.toolCost(t.id) ?? t.cost;
    this.toolTip.replaceChildren(
      pix(`tool_${t.id}`),
      h('strong', null, t.name),
      h('span', { class: 'cost' }, cost ? `${cost} pts` : 'free'),
      h('span', { class: 'key' }, t.key),
      h('p', null, t.desc),
    );
    this.toolTip.classList.remove('hidden');
  }

  private raidClick(): void {
    const s = this.app.sim;
    const p = s.player;
    if (!p) return;
    if (p.raid) {
      p.endRaid();
      s.emit('Raiders recalled.', 'info');
    } else if (s.rival && p.launchRaid(s.rival)) {
      s.emit('Your raiders are gathering at the entrance...', 'info', 'raid');
    }
    this.lastT = 0;
  }

  setPrompt(text: string | null): void {
    this.prompt.classList.toggle('hidden', !text);
    if (text) this.prompt.textContent = text;
  }

  setTip(text: string | null, x: number, y: number): void {
    if (!text) {
      this.tip.classList.add('hidden');
      return;
    }
    setText(this.tip, text);
    this.tip.classList.remove('hidden');
    this.tip.style.transform = `translate(${Math.min(x + 14, innerWidth - 240)}px, ${y + 16}px)`;
  }

  toast(text: string, tone: Tone): void {
    const t = h('div', { class: `toast ${tone}` }, pix(TOAST_ICON[tone], 'pix t-ico'), h('span', { class: 'grow' }, text), h('i', { class: 't-time' }));
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 400);
    }, 5200);
  }

  flash(text: string): void {
    this.toast(text, 'info');
    pop(this.toolBtns.get(this.app.tool)!, 'down');
  }

  /** A goal was reached: banner, confetti and a shower of points. */
  celebrate(e: GameEvent): void {
    const m = MILESTONES.find((x) => x.id === e.ref);
    if (!m) {
      this.toast(e.text, e.tone);
      return;
    }
    this.banners.show(() => h('div', { class: 'banner goal' },
      pix('medal', 'pix b-ico'),
      h('div', { class: 'b-text' }, h('small', null, 'Goal complete'), h('strong', null, m.title)),
      h('span', { class: 'b-reward' }, pix('honey'), `+${m.reward}`)), 2800, true);
    this.goalsKey = '';
  }

  seasonBanner(season: number): void {
    this.banners.show(() => h('div', { class: `banner season s${season}` },
      pix(`season_${season}`, 'pix b-ico'),
      h('div', { class: 'b-text' }, h('small', null, `Day ${this.app.sim.day + 1}`), h('strong', null, SEASONS[season]), h('span', null, SEASON_LINE[season]))), 2600);
  }

  logChanged(): void {
    this.logKey = '';
  }

  // ── per-frame ───────────────────────────────────────────────────────

  update(now: number): void {
    const dt = Math.min(0.1, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;
    for (const c of [this.popC, this.sugarC, this.proteinC, this.pointsC]) c.tick(dt);
    if (now - this.lastT < 150) return;
    this.lastT = now;
    const s = this.app.sim;
    const p = s.player;
    const sp = p?.species ?? SPECIES[s.opts.species];

    if (this.shownSpecies !== sp.id) {
      this.shownSpecies = sp.id;
      this.root.style.setProperty('--accent', sp.ui);
      document.body.style.setProperty('--accent', sp.ui);
      this.portrait.replaceChildren(pix(`ant_${sp.id}`));
    }
    setText(this.cname, s.opts.name);
    this.popC.set(p ? p.pop : 0);
    if (p) {
      const parts = [`${fmt(p.workerCount)} workers`];
      if (p.soldierCount) parts.push(`${fmt(p.soldierCount)} soldiers`);
      if (p.alateCount) {
        const males = p.ants.reduce((n, a) => n + (a.male && !a.dead ? 1 : 0), 0);
        const queens = p.alateCount - males;
        parts.push([queens ? `${queens} young queen${queens > 1 ? 's' : ''}` : '', males ? `${males} male${males > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '));
      }
      if (p.repleteCount) parts.push(`${p.repleteCount} repletes`);
      setText(this.castes, parts.join(' · '));
      const b = p.broodStats();
      this.broodEl.replaceChildren(
        h('span', { class: 'b egg' }, h('i'), `${b.eggs}`), h('span', { class: 'b larva' }, h('i'), `${b.larvae}`), h('span', { class: 'b pupa' }, h('i'), `${b.pupae}`),
        h('span', { class: 'b-label' }, 'eggs · larvae · pupae'));
    } else {
      setText(this.castes, sp.name);
      this.broodEl.replaceChildren();
    }
    this.updateNextGoal(s);
    let alert = '';
    let calm = false;
    if (p) {
      const flooding = s.weather.raining && !s.isWinter && p.roots.some((r) => !s.isCovered(r % W)) && s.world.waterCount > 0;
      if (!p.queenAlive) alert = p.orphaned ? 'The queen is dead: the workers are raising her sons' : 'The queen is dead';
      else if (s.danger.swarm?.raiding === p) alert = 'Army ants in the nest!';
      else if (p.threat?.under) alert = 'Intruders in the nest!';
      else if (p.lockdown) alert = 'Army ants coming: everyone inside';
      else if (p.rafting) alert = 'Flooded: the colony is afloat on a raft';
      else if (p.raid) alert = p.raid.phase === 'gather' ? 'Raiders gathering' : 'Raid under way';
      else if (p.hunger > 0) alert = 'Starving!';
      else if (!p.settled) alert = 'The queen is digging her first chamber';
      else if (flooding) alert = 'Rain is flooding the nest';
      else if (p.threat) alert = 'Danger near the nest';
      else if (p.protein < 0.5 && !s.isWinter) alert = 'No protein: the queen has stopped laying';
      else if (p.roots.some((r) => s.isPlugged(r))) alert = 'Entrance plugged with a pebble';
      else if (p.stored > p.cap * 0.95) alert = 'Stores are full';
      calm = !!p.raid || (!p.settled && p.queenAlive) || alert === 'Stores are full' || alert.startsWith('Entrance');
    }
    setText(this.alert, alert);
    this.alert.classList.toggle('calm', calm);
    this.alert.classList.toggle('hidden', !alert);

    if (this.shownSeason !== s.season) {
      this.shownSeason = s.season;
      this.seasonIco.replaceChildren(pix(`season_${s.season}`));
      this.root.dataset.season = String(s.season);
    }
    setText(this.dayText, `${SEASONS[s.season]} · Day ${s.day + 1}`);
    this.sunMark.style.left = `${s.dayFrac * 100}%`;
    this.sunMark.classList.toggle('night', s.darkness > 0.3);
    const weather = s.weather.raining ? (s.isWinter ? 'Snow' : 'Rain') : s.darkness > 0.4 ? 'Night' : 'Clear';
    if (weather !== this.shownWeather) {
      this.shownWeather = weather;
      const ic = weather === 'Rain' ? 'rain' : weather === 'Snow' ? 'season_3' : weather === 'Night' ? 'moon' : 'season_1';
      this.weatherEl.replaceChildren(pix(ic), weather);
    }

    if (p) {
      this.sugarC.set(p.sugar);
      this.proteinC.set(p.protein);
      this.sugarBar.style.width = `${Math.min(100, (p.sugar / p.cap) * 100)}%`;
      this.proteinBar.style.width = `${Math.min(100, (p.protein / p.cap) * 100)}%`;
      this.sugarChip.classList.toggle('low', p.sugar < 5);
      this.proteinChip.classList.toggle('low', p.protein < 3);
    } else {
      setText(this.sugarV, '-');
      setText(this.proteinV, '-');
    }
    if (s.opts.sandbox) setText(this.pointsV, '∞');
    else this.pointsC.set(s.points);
    if (this.lastPoints >= 0 && s.points !== this.lastPoints) {
      const d = s.points - this.lastPoints;
      floatText(this.pointsChip, d > 0 ? `+${d}` : `${d}`, d > 0 ? 'gold' : 'bad');
      if (d >= 5) this.app.sound.coin();
    }
    this.lastPoints = s.points;
    for (const t of TOOLS) {
      const cost = s.toolCost(t.id);
      this.toolBtns.get(t.id)!.classList.toggle('poor', cost > s.points);
      const el = this.toolCosts.get(t.id);
      if (el) setText(el, String(cost));
    }

    setText(this.goalsCount, `${s.milestones.size}/${MILESTONES.length}`);
    if (!this.side.classList.contains('collapsed')) {
      if (this.tab === 'colony') this.updateColonyPane();
      else if (this.tab === 'graphs') this.updateCharts();
      else if (this.tab === 'goals') this.updateGoals();
      else this.updateLog();
    }
    this.refreshInspector();
  }

  private updateCharts(): void {
    const s = this.app.sim;
    const hist = s.history;
    const key = `${hist.length}:${s.histStep}:${this.side.clientWidth}`;
    if (key === this.chartsKey) return;
    this.chartsKey = key;
    const p = s.player;
    const you = p?.species.ui ?? '#4a5a86';
    const rivalCol = s.rival?.species.ui ?? '#c0472f';
    const pop: Series[] = [{ values: hist.map((x) => x.pop), color: you }];
    const keys = [h('span', null, h('i', { style: `background:${you}` }), 'Your colony')];
    if (hist.some((x) => x.rival > 0)) {
      pop.push({ values: hist.map((x) => x.rival), color: rivalCol });
      keys.push(h('span', null, h('i', { style: `background:${rivalCol}` }), 'Rival'));
    }
    if (hist.some((x) => x.kin > 0)) {
      pop.push({ values: hist.map((x) => x.kin), color: '#7d9a5a', dash: true });
      keys.push(h('span', null, h('i', { style: 'background:#7d9a5a' }), 'Mother colony'));
    }
    this.popKey.replaceChildren(...keys);
    drawChart(this.popChart, hist, pop);
    drawChart(this.foodChart, hist, [
      { values: hist.map((x) => x.sugar), color: '#e2a33b' },
      { values: hist.map((x) => x.protein), color: '#d07a62' },
    ]);
    drawChart(this.lossChart, hist, [{ values: hist.map((x) => x.lost), color: 'rgba(192,71,47,0.75)', bars: true }]);
  }

  private updateNextGoal(s: Sim): void {
    const m = MILESTONES.find((x) => !s.milestones.has(x.id) && goalProgress(s, x.id));
    const g = m ? goalProgress(s, m.id) : null;
    this.next.classList.toggle('hidden', !m || !g || !s.player?.settled);
    if (!m || !g) return;
    setText(this.nextTitle, m.title);
    setText(this.nextVal, `${fmt(Math.min(g.cur, g.max))} / ${fmt(g.max)}`);
    this.nextBar.style.width = `${Math.min(100, (g.cur / g.max) * 100)}%`;
  }

  private updateColonyPane(): void {
    const s = this.app.sim;
    const p = s.player;
    this.refreshFocus();
    const total = p ? Math.max(1, p.pop - 1) : 1;
    for (const [t, el] of this.work) {
      const n = p ? p.counts[t] : 0;
      el.bar.style.width = `${(n / total) * 100}%`;
      setText(el.n, fmt(n));
      el.row.classList.toggle('hidden', t === 'raid' && n === 0);
    }
    const set = (k: string, v: string): void => setText(this.nest.get(k)!, v);
    set('Stores', p ? `${fmt(p.stored)} / ${fmt(p.cap)}` : '-');
    set('In crops', p ? fmt(p.cropSugar) : '-');
    set('Food shared', p ? `${fmt(p.stats.shared)}×` : '-');
    set('Food chambers', p ? String(p.foodChambers.length) : '-');
    set('Granary', p && p.granaryChambers.length ? `${fmt(p.seeds)} / ${fmt(p.seedCap)} seeds` : 'None yet');
    set('Nurseries', p ? String(p.nurseryChambers.length) : '-');
    set('Middens', p ? String(p.middenChambers.length) : '-');
    set('Brood warmth', p && p.brood.length ? `${Math.round(p.broodWarmth * 100)}%` : '-');
    set('Queen chamber', p?.queenChamber ? `${Math.round(s.tempAt(p.queenChamber.ey))}°C` : '-');
    if (p) {
      const n = { nurse: 0, builder: 0, forager: 0 };
      for (const a of p.ants) if (a.caste === 'worker') n[a.band]++;
      const tot = Math.max(1, n.nurse + n.builder + n.forager);
      this.ages.replaceChildren(
        h('div', { class: 'age-bar' }, ...(['nurse', 'builder', 'forager'] as const).map((b) => h('i', { class: b, style: `width:${(n[b] / tot) * 100}%` }))),
        h('div', { class: 'age-key' }, h('span', { class: 'nurse' }, `${fmt(n.nurse)} young`), h('span', { class: 'builder' }, `${fmt(n.builder)} builders`), h('span', { class: 'forager' }, `${fmt(n.forager)} veterans`)));
    }
    set('Cells dug', p ? fmt(p.stats.dug) : '-');
    set('Food gathered', p ? fmt(p.stats.gathered) : '-');
    set('Enemies killed', p ? fmt(p.stats.kills) : '-');
    set('Ants lost', p ? fmt(p.stats.lost) : '-');

    const k = s.kin;
    this.kinBox.classList.toggle('hidden', !k);
    if (k) {
      const traits = s.opts.lineage?.traits.length ?? 0;
      setText(this.kinText, k.alive
        ? `${k.name} · ${fmt(k.pop)} ants${k.queenAlive ? '' : ' · queen dead'}. Kin don't fight each other.${traits ? ` Your line carries ${traits} trait${traits > 1 ? 's' : ''}.` : ''}`
        : `${k.name} has died out. Its line lives on in you.`);
    }
    this.rivalBox.classList.toggle('hidden', s.opts.rival === 'none');
    const r = s.rival;
    const versus = this.youBar.parentElement!;
    if (r && r.alive && p) {
      setText(this.rivalText, `${r.species.name} · ${fmt(r.pop)} ants${r.queenAlive ? '' : ' · queen dead'}`);
      const a = p.strength();
      const b = r.strength();
      const sum = Math.max(1, a + b);
      this.youBar.style.width = `${(a / sum) * 100}%`;
      this.youBar.style.background = p.species.ui;
      this.themBar.style.width = `${(b / sum) * 100}%`;
      this.themBar.style.background = r.species.ui;
      versus.classList.remove('hidden');
      this.raidBtn.classList.remove('hidden');
      if (p.raid) {
        setText(this.raidBtn, 'Recall raiders');
        this.raidBtn.disabled = false;
        const n = p.counts.raid;
        setText(this.raidText, `${p.raid.phase === 'gather' ? 'Gathering' : 'Marching'} · ${n} raiders left`);
      } else {
        setText(this.raidBtn, 'Launch raid');
        this.raidBtn.disabled = !p.canRaid(r);
        setText(this.raidText, p.canRaid(r) ? 'Sends soldiers and a third of the workers after the rival queen.' : s.weather.raining ? 'Nobody raids in the rain.' : 'You need at least 10 workers to raid.');
      }
    } else {
      setText(this.rivalText, s.rivalsBeaten ? 'Rival destroyed. Another queen may land later.' : 'No rival has landed yet.');
      versus.classList.add('hidden');
      this.raidBtn.classList.add('hidden');
      setText(this.raidText, '');
    }
  }

  private updateGoals(): void {
    const s = this.app.sim;
    // Progress numbers move, so rebuild at most a few times a second; completed set changes force it
    const prog = MILESTONES.map((m) => {
      const g = goalProgress(s, m.id);
      return g ? Math.floor((g.cur / g.max) * 40) : 0;
    }).join(',');
    const key = `${[...s.milestones].join(',')}|${prog}`;
    if (key === this.goalsKey) return;
    this.goalsKey = key;
    this.goalsList.replaceChildren(...MILESTONES.map((m) => {
      const done = s.milestones.has(m.id);
      const g = done ? null : goalProgress(s, m.id);
      return h('li', { class: done ? 'done' : '' },
        done ? pix('medal', 'pix g-ico') : h('span', { class: 'g-ico ring' }),
        h('div', { class: 'grow' },
          h('strong', null, m.title),
          h('p', null, m.desc),
          g ? h('div', { class: 'g-track' }, h('i', { style: `width:${Math.min(100, (g.cur / g.max) * 100)}%` })) : null),
        h('span', { class: 'reward' }, `+${m.reward}`));
    }));
  }

  private updateLog(): void {
    const s = this.app.sim;
    const key = `${s.log.length}:${s.log[0]?.text ?? ''}`;
    if (key === this.logKey) return;
    this.logKey = key;
    if (!s.log.length) {
      this.logList.replaceChildren(h('li', { class: 'empty' }, 'Nothing has happened yet.'));
      return;
    }
    this.logList.replaceChildren(...s.log.map((e) => h('li', { class: e.tone }, h('span', { class: 'when' }, `Day ${e.day}`), e.text)));
  }

  refreshOverlay(): void {
    const o = this.app.overlay;
    this.overlayBtn.classList.toggle('on', o !== 'none');
    this.legend.classList.toggle('hidden', o === 'none');
    this.legend.replaceChildren();
    if (o === 'scent') {
      this.legend.append(
        h('b', null, 'Scent'),
        ...this.app.sim.colonies.map((c) => h('span', { class: 'lg' }, h('i', { style: `background:${c.species.ui}` }), c.name)),
        h('span', { class: 'lg' }, h('i', { class: 'alarm' }), 'Alarm'),
        h('span', { class: 'sub' }, 'bars: trails, wash: range'),
      );
    } else if (o === 'heat') {
      this.legend.append(h('b', null, 'Soil warmth'), h('span', { class: 'sub' }, '4°'), h('span', { class: 'ramp' }), h('span', { class: 'sub' }, '37°'), h('span', { class: 'sub' }, 'brood best 25–29°'));
    }
  }

  refreshInspector(): void {
    const sel = this.app.selected;
    if (!sel || sel.dead) {
      this.insp.classList.add('hidden');
      return;
    }
    this.insp.classList.remove('hidden');
    const row = (k: string, v: string | null): void => {
      const r = this.inspRows.get(k)!;
      r.row.classList.toggle('hidden', v === null);
      if (v !== null) setText(r.v, v);
    };
    if (sel instanceof Ant) {
      const c = sel.colony;
      const s = this.app.sim;
      const worker = sel.caste === 'worker' || sel.caste === 'soldier';
      this.inspDot.style.background = c.species.ui;
      setText(this.inspTitle, sel.caste === 'queen' ? `Queen ${sel.name}` : `${sel.name}, ${sel.casteName.toLowerCase()} #${sel.id}`);
      setText(this.inspSub, c === s.player ? (sel.caste === 'worker' ? sel.calling : c.name) : c.kin ? `${c.name} (mother colony)` : `${c.species.name} (rival)`);
      row('Doing', INTENT_TEXT[sel.intent]);
      row('Job', worker ? TASK_TEXT[sel.task] : null);
      const days = sel.age / DAY;
      row('Age', Number.isFinite(sel.life) ? `${days.toFixed(1)} of ${(sel.life / DAY).toFixed(1)} days` : `${days.toFixed(1)} days`);
      const load = sel.caste === 'replete' ? `Honey, ${Math.round(Math.min(1, c.sugar / Math.max(1, c.cap)) * 100)}% full`
        : sel.load === LOAD_SUGAR ? `Sugar in her crop (${sel.loadAmt.toFixed(1)})` : sel.load === LOAD_PROTEIN ? 'Protein' : sel.load === LOAD_SEED ? 'Seeds' : sel.load === LOAD_BROOD ? 'Brood'
        : sel.load === LOAD_CORPSE ? 'A fallen nestmate' : sel.carry > 0 ? `Soil (${sel.carry})` : 'Nothing';
      row('Carrying', load);
      const where = sel.under ? ROLE_NAMES[s.world.room[sel.at]] : 'Surface';
      row('Where', `${where} · ${Math.round(s.tempAt(sel.under ? sel.y : s.world.top[Math.max(0, Math.min(W - 1, Math.floor(sel.x)))]))}°C`);
      let habits: string | null = null;
      if (sel.caste === 'worker') {
        const order = TASKS.map((_, k) => k).filter((k) => sel.done[k] > 0).sort((a, b) => sel.done[b] - sel.done[a]).slice(0, 2);
        habits = order.length ? order.map((k) => `${DONE_TEXT[k]} ${sel.done[k]}×`).join(', ') : 'Just getting started';
      } else if (sel.caste === 'queen' && c.settled) {
        const slow = c.queenSlowing;
        habits = slow > 1.04 ? `Getting old: laying ${Math.round(100 / slow)}% as fast as in her prime` : 'In her prime';
      }
      row('Habits', habits);
      this.inspHp.style.width = `${Math.max(0, (sel.hp / sel.maxHp) * 100)}%`;
    } else {
      const info = CRITTER_INFO[sel.kind];
      this.inspDot.style.background = CRITTER_DOT[sel.kind];
      setText(this.inspTitle, info.label);
      setText(this.inspSub, info.desc);
      const doing = sel.attackers.length ? `Fighting ${sel.attackers.length} ants` : sel.leaving ? 'Leaving' : sel.alt > 0 ? 'Flying in'
        : sel.kind === 'centipede' ? 'Hunting through the tunnels' : sel.kind === 'bird' ? 'Hunting in the open' : sel.kind === 'ladybird' ? 'Eating aphids' : 'Wandering';
      row('Doing', doing);
      row('Job', null);
      row('Age', null);
      row('Carrying', sel.kind === 'spider' || sel.kind === 'bird' ? `${sel.kills} ${sel.kills === 1 ? 'ant' : 'ants'} eaten` : sel.kind === 'centipede' ? `${sel.kills} eaten, ants and brood` : null);
      row('Where', null);
      row('Habits', null);
      this.inspHp.style.width = `${Math.max(0, (sel.hp / sel.maxHp) * 100)}%`;
    }
    setText(this.followBtn, this.app.follow ? 'Stop following' : 'Follow (F)');
    this.followBtn.classList.toggle('on', this.app.follow);
  }
}

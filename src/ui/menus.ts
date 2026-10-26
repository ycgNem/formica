import { h, icon, fmt } from './dom';
import { ICON } from './icons';
import { pix } from './juice';
import { SPECIES_LIST } from '../species';
import { BIOMES, BIOME_LIST } from '../biome';
import { MILESTONES, TOOLS, type GameOptions, type Sim } from '../sim';
import { saveSummary, deleteSave, exportSave, importSave } from '../save';
import { TRAITS, daughterOptions, type TraitId } from '../lineage';
import { ALMANAC, type AlmanacGroup } from '../almanac';
import { DAY, SEASON_DAYS } from '../config';
import type { CritterKind } from '../ecology';
import type { App } from '../app';

export type Screen = 'title' | 'new' | 'howto' | 'settings' | 'pause' | 'over' | 'victory' | 'daughter' | 'almanac' | 'sandbox';

const NAMES = [
  'Thistledown', 'Larkspur', 'Bramblegate', 'Mosswick', 'Hazelroot', 'Pebblemere', 'Fernhold', 'Amberdell',
  'Clover Hollow', 'Rootway', 'Sorrel Deep', 'Duskmound', 'Barley Rise', 'Mallow End', 'Tansy Hill', 'Wren Hollow',
];

const RATINGS: [keyof (typeof SPECIES_LIST)[number]['ratings'], string][] = [
  ['growth', 'Growth'], ['strength', 'Strength'], ['digging', 'Digging'], ['lifespan', 'Lifespan'],
];

const randomSeed = (): number => (Math.random() * 1e9) >>> 0;
const randomName = (): string => NAMES[Math.floor(Math.random() * NAMES.length)];

/** Full-screen menus: title, new colony, how to play, settings, pause, game over and victory. */
export class Menus {
  private readonly root = document.getElementById('menus')!;
  private stack: Screen[] = [];
  private opts: GameOptions = { species: 'lasius', rival: 'calm', abundance: 'normal', biome: 'meadow', seed: randomSeed(), name: randomName() };
  private confirmDelete = false;

  constructor(private readonly app: App) {}

  get open(): boolean {
    return this.stack.length > 0;
  }

  get current(): Screen | null {
    return this.stack.length ? this.stack[this.stack.length - 1] : null;
  }

  show(s: Screen): void {
    this.stack.push(s);
    this.render();
  }

  replace(s: Screen): void {
    this.stack = [s];
    this.render();
  }

  back(): void {
    this.stack.pop();
    if (!this.stack.length) this.hide();
    else this.render();
  }

  hide(): void {
    const was = this.stack.length > 0;
    this.stack = [];
    this.root.replaceChildren();
    this.root.className = '';
    if (was) this.app.onMenusClosed();
  }

  private render(): void {
    const s = this.current;
    if (!s) return;
    this.confirmDelete = false;
    const panel = {
      title: () => this.title(),
      new: () => this.newGame(),
      howto: () => this.howto(),
      settings: () => this.settings(),
      pause: () => this.pause(),
      over: () => this.over(),
      victory: () => this.victory(),
      daughter: () => this.daughter(),
      almanac: () => this.almanac(),
      sandbox: () => this.sandbox(),
    }[s]();
    this.root.className = `menus ${s === 'title' ? 'title-mode' : 'dim'}`;
    this.root.replaceChildren(panel);
  }

  private head(title: string): HTMLElement {
    return h('div', { class: 'panel-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => this.back() }, icon(ICON.chevron)),
      h('h2', null, title));
  }

  private title(): HTMLElement {
    const sum = saveSummary();
    return h('div', { class: 'panel title-panel' },
      h('div', { class: 'title-art' }, h('div', { class: 'logo' }, 'Formica'), pix('ant_queen')),
      h('span', { class: 'version' }, 'v1.2 · Wider World'),
      h('p', { class: 'tagline' }, 'Raise an ant colony from a single queen. Watch it dig, forage, fight and grow.'),
      h('div', { class: 'menu-buttons' },
        sum ? h('button', { class: 'btn primary big', onclick: () => this.app.continueGame() },
          icon(ICON.play),
          h('span', { class: 'grow' }, 'Continue', h('small', null, `${sum.name} · ${sum.biome} · Day ${sum.day} · ${fmt(sum.pop)} ants`))) : null,
        h('button', { class: `btn big ${sum ? '' : 'primary'}`, onclick: () => this.show('new') }, icon(ICON.ant), h('span', { class: 'grow' }, 'New colony')),
        h('button', { class: 'btn big', onclick: () => this.show('howto') }, icon(ICON.book), h('span', { class: 'grow' }, 'How to play')),
        h('button', { class: 'btn big', onclick: () => this.show('almanac') }, icon(ICON.leaf), h('span', { class: 'grow' }, 'Almanac', h('small', null, `${this.app.almanac.seen.size} of ${ALMANAC.length} entries`))),
        h('button', { class: 'btn big', onclick: () => this.show('settings') }, icon(ICON.gear), h('span', { class: 'grow' }, 'Settings')),
      ),
      h('p', { class: 'foot' }, 'Scroll to zoom · drag to look around · Space to pause'),
    );
  }

  private newGame(): HTMLElement {
    const o = this.opts;
    const cards = SPECIES_LIST.map((sp) => {
      const card = h('button', { class: `species ${o.species === sp.id ? 'on' : ''}`, onclick: () => { o.species = sp.id; this.render(); } },
        h('div', { class: 'ant-art' }, pix(`ant_${sp.id}`)),
        h('div', { class: 'sp-name' }, sp.name),
        h('div', { class: 'sp-latin' }, sp.latin),
        h('p', { class: 'sp-blurb' }, sp.blurb),
        h('div', { class: 'ratings' }, ...RATINGS.map(([k, label]) => h('div', { class: 'rating' },
          h('span', null, label),
          h('span', { class: 'pips' }, ...[1, 2, 3, 4, 5].map((i) => h('i', { class: i <= sp.ratings[k] ? 'on' : '' }))),
        ))),
      );
      card.style.setProperty('--accent', sp.ui);
      return card;
    });
    const seg = <T extends string>(label: string, value: T, options: [T, string][], set: (v: T) => void): HTMLElement =>
      h('div', { class: 'field' }, h('label', null, label), h('div', { class: 'seg' },
        ...options.map(([v, text]) => h('button', { class: v === value ? 'on' : '', onclick: () => { set(v); this.render(); } }, text))));

    const name = h('input', { type: 'text', value: o.name, maxlength: 28, spellcheck: 'false', 'aria-label': 'Colony name' });
    name.addEventListener('input', () => (o.name = name.value));
    const seed = h('input', { type: 'number', value: o.seed, min: 0, 'aria-label': 'World seed' });
    seed.addEventListener('input', () => (o.seed = Math.abs(Math.floor(Number(seed.value) || 0)) >>> 0));
    const dice = (fn: () => void, label: string): HTMLElement => h('button', { class: 'icon-btn', title: label, 'aria-label': label, onclick: fn }, icon(ICON.dice));

    const biome = BIOMES[o.biome ?? 'meadow'];
    const biomes = h('div', { class: 'field wide' },
      h('label', null, 'Where they live'),
      h('div', { class: 'seg biomes' }, ...BIOME_LIST.map((b) => {
        const btn = h('button', { class: b.id === biome.id ? 'on' : '', onclick: () => { o.biome = b.id; this.render(); } }, h('i', { class: 'swatch' }), b.name);
        btn.style.setProperty('--accent', b.ui);
        return btn;
      })),
      h('p', { class: 'hint' }, biome.blurb));

    return h('div', { class: 'panel wide' },
      this.head('New colony'),
      h('h3', null, 'Choose a species'),
      h('div', { class: 'species-grid' }, ...cards),
      h('div', { class: 'fields' },
        biomes,
        h('div', { class: 'field' }, h('label', null, 'Colony name'), h('div', { class: 'row' }, name,
          dice(() => { o.name = randomName(); this.render(); }, 'Random name'))),
        seg('Rival colony', o.rival, [['none', 'None'], ['calm', 'Calm'], ['aggressive', 'Aggressive']], (v) => (o.rival = v)),
        seg('Food', o.abundance, [['scarce', 'Scarce'], ['normal', 'Normal'], ['plenty', 'Plenty']], (v) => (o.abundance = v)),
        seg('Mode', o.sandbox ? 'sandbox' : 'normal', [['normal', 'Normal'], ['sandbox', 'Sandbox']], (v) => (o.sandbox = v === 'sandbox')),
        h('div', { class: 'field' }, h('label', null, 'World seed'), h('div', { class: 'row' }, seed,
          dice(() => { o.seed = randomSeed(); this.render(); }, 'Random seed'))),
      ),
      h('div', { class: 'panel-foot' },
        h('button', { class: 'btn', onclick: () => this.back() }, 'Back'),
        h('button', {
          class: 'btn primary',
          onclick: () => {
            const opts = { ...o, name: o.name.trim() || randomName() };
            this.opts = { ...o, seed: randomSeed(), name: randomName() };
            this.app.newGame(opts);
          },
        }, 'Start colony'),
      ),
    );
  }

  private howto(): HTMLElement {
    const sec = (title: string, ...body: (string | HTMLElement)[]): HTMLElement =>
      h('section', null, h('h3', null, title), ...body.map((b) => (typeof b === 'string' ? h('p', null, b) : b)));
    return h('div', { class: 'panel wide howto' },
      this.head('How to play'),
      h('div', { class: 'cols' },
        sec('The goal',
          'Grow a colony from a single queen. Once it has survived a winter, have 250 ants in summer and the colony raises winged queens for a nuptial flight. That is the big win, but you can keep playing after.',
          'Keep the queen alive. If she dies, the colony is lost.'),
        sec('Your ants',
          'Workers pick their own jobs: digging, foraging, nursing brood, carrying out the dead and guarding. Young ants nurse, older ants forage.',
          'Use Focus in the Colony panel to nudge them toward foraging, digging or defence.'),
        sec('Food',
          'Sugar keeps workers alive. Protein lets the queen lay and larvae grow. Food chambers raise how much the nest can store.',
          'Nothing grows in winter, so fill the stores in autumn.'),
        sec('Dangers',
          'Rain pours into open entrances and drowns brood. Lay a leaf over the entrance when rain is coming.',
          'Wolf spiders and robins hunt on the surface, centipedes slip into the nest after the brood, and ladybirds eat your aphids. Antlion pits catch careless foragers, but a nestmate can pull them out.',
          'Rival colonies raid your nest when they are stronger, and you can raid them back. Once a summer, army ants may sweep through: a pebble (U) in each entrance turns them away, and brood deep in the nest is safe.'),
        sec('Where they live',
          'Meadows are balanced. Woodland has rotting logs that carpenter ants tunnel into and leaf litter that hides foragers. Dune sand digs fast but caves in. Riverbank silt floods, and deep tunnels fill with groundwater.'),
        sec('Scent and warmth',
          'Press P (or the eye button) to see the scent trails foragers lay to food, your home range and alarm calls. Press it again to see how warm the soil is: nurses carry brood to the warmest chambers.'),
        sec('The long game',
          'After a nuptial flight you can follow one of the young queens to found a daughter colony, carrying traits her mother earned. The old colony stays on as a friendly neighbour.',
          'If the queen dies with plenty of workers left, they raise a last brood of males to carry her line on.',
          'Everything you see goes in the Almanac. The Graphs tab charts your colony over time, and H opens photo mode.'),
        sec('Keeper tools',
          'You earn keeper points every dawn and for each goal. Spend them on tools:',
          h('ul', { class: 'tool-list' }, ...TOOLS.filter((t) => t.id !== 'inspect').map((t) =>
            h('li', null, h('kbd', null, t.key), h('strong', null, t.name), ` (${t.cost}) `, t.desc)))),
        sec('Controls',
          h('ul', { class: 'keys' },
            h('li', null, h('kbd', null, 'Scroll'), 'Zoom'),
            h('li', null, h('kbd', null, 'Drag'), 'Look around (or arrow keys)'),
            h('li', null, h('kbd', null, 'Space'), 'Pause'),
            h('li', null, h('kbd', null, '1–4'), 'Speed 1×, 3×, 10×, 30×'),
            h('li', null, h('kbd', null, 'V'), 'Inspect, then click an ant'),
            h('li', null, h('kbd', null, 'F'), 'Follow the selected ant'),
            h('li', null, h('kbd', null, 'Right-click'), 'Put a tool away'),
            h('li', null, h('kbd', null, 'P'), 'Scent and warmth view'),
            h('li', null, h('kbd', null, 'H'), 'Photo mode'),
            h('li', null, h('kbd', null, 'Pinch'), 'Zoom on a touch screen'),
            h('li', null, h('kbd', null, 'Esc'), 'Menu'))),
      ),
      h('div', { class: 'panel-foot' }, h('button', { class: 'btn primary', onclick: () => this.back() }, 'Got it')),
    );
  }

  private settings(): HTMLElement {
    const st = this.app.settings;
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: st.volume, 'aria-label': 'Volume' });
    vol.addEventListener('input', () => {
      st.volume = Number(vol.value);
      this.app.saveSettings();
    });
    const toggle = (label: string, key: 'trails' | 'labels' | 'autosave', hint: string): HTMLElement => {
      const box = h('input', { type: 'checkbox' });
      box.checked = st[key];
      box.addEventListener('change', () => {
        st[key] = box.checked;
        this.app.saveSettings();
      });
      return h('label', { class: 'toggle' }, box, h('span', { class: 'switch' }), h('span', { class: 'grow' }, label, h('small', null, hint)));
    };
    const del = h('button', { class: 'btn danger small' }, 'Delete saved game');
    del.disabled = !saveSummary();
    del.addEventListener('click', () => {
      if (!this.confirmDelete) {
        this.confirmDelete = true;
        del.textContent = 'Click again to delete';
        return;
      }
      deleteSave();
      del.textContent = 'Deleted';
      del.disabled = true;
    });
    // Copies of the save, for moving a colony to another browser or keeping a backup
    const note = h('p', { class: 'hint' });
    const exp = h('button', { class: 'btn small' }, 'Export save');
    exp.disabled = !saveSummary();
    exp.addEventListener('click', () => {
      if (this.app.state === 'playing') this.app.save();
      const text = exportSave();
      const sum = saveSummary();
      if (!text || !sum) {
        note.textContent = 'There is no saved game to export.';
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = `formica-${sum.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-day-${sum.day}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      note.textContent = 'Saved a copy to your downloads.';
    });
    const file = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const err = importSave(await f.text());
      const sum = saveSummary();
      note.textContent = err ?? `Imported ${sum?.name ?? 'the colony'} (day ${sum?.day ?? '?'}). Continue it from the title screen.`;
      file.value = '';
    });
    const imp = h('button', { class: 'btn small', onclick: () => file.click() }, 'Import save');
    return h('div', { class: 'panel' },
      this.head('Settings'),
      h('div', { class: 'field' }, h('label', null, 'Volume'), vol),
      toggle('Pheromone trails', 'trails', 'Show the scent lines foragers lay to food.'),
      toggle('Chamber labels', 'labels', 'Name your chambers when zoomed in.'),
      toggle('Autosave', 'autosave', 'Save every dawn and when you quit.'),
      h('div', { class: 'field' }, h('label', null, 'Saved game'), h('div', { class: 'row' }, exp, imp, file), note),
      h('div', { class: 'field' }, del),
      h('div', { class: 'panel-foot' }, h('button', { class: 'btn primary', onclick: () => this.back() }, 'Done')),
    );
  }

  private pause(): HTMLElement {
    const s = this.app.sim;
    const saveBtn = h('button', { class: 'btn big' }, icon(ICON.save), h('span', { class: 'grow' }, 'Save game'));
    saveBtn.addEventListener('click', () => {
      const ok = this.app.save();
      saveBtn.lastElementChild!.textContent = ok ? 'Saved' : 'Could not save';
    });
    return h('div', { class: 'panel narrow' },
      h('h2', null, 'Paused'),
      h('p', { class: 'sub' }, `${s.opts.name} · ${s.seasonName}, day ${s.day + 1}`),
      h('div', { class: 'menu-buttons' },
        h('button', { class: 'btn primary big', onclick: () => this.back() }, icon(ICON.play), h('span', { class: 'grow' }, 'Resume')),
        s.opts.sandbox ? h('button', { class: 'btn big', onclick: () => this.show('sandbox') }, icon(ICON.dice), h('span', { class: 'grow' }, 'Sandbox')) : null,
        saveBtn,
        s.won ? h('button', { class: 'btn big', onclick: () => this.show('daughter') }, icon(ICON.sun), h('span', { class: 'grow' }, 'Found a daughter colony')) : null,
        h('button', { class: 'btn big', onclick: () => this.show('howto') }, icon(ICON.book), h('span', { class: 'grow' }, 'How to play')),
        h('button', { class: 'btn big', onclick: () => this.show('almanac') }, icon(ICON.leaf), h('span', { class: 'grow' }, 'Almanac')),
        h('button', { class: 'btn big', onclick: () => this.show('settings') }, icon(ICON.gear), h('span', { class: 'grow' }, 'Settings')),
        h('button', { class: 'btn big', onclick: () => this.app.toTitle() }, icon(ICON.door), h('span', { class: 'grow' }, 'Quit to title')),
      ),
    );
  }

  private stats(s: Sim): HTMLElement {
    const p = s.player;
    const items: [string, string][] = [
      ['Days survived', String(s.day + 1)],
      ['Peak population', fmt(p?.stats.peak ?? 0)],
      ['Ants raised', fmt(p?.stats.born ?? 0)],
      ['Food gathered', fmt(p?.stats.gathered ?? 0)],
      ['Enemies killed', fmt(p?.stats.kills ?? 0)],
      ['Goals', `${s.milestones.size} / ${MILESTONES.length}`],
    ];
    return h('div', { class: 'stats' }, ...items.map(([k, v]) => h('div', null, h('span', { class: 'v' }, v), h('span', { class: 'k' }, k))));
  }

  private over(): HTMLElement {
    const s = this.app.sim;
    return h('div', { class: 'panel' },
      h('h2', null, 'The colony has fallen'),
      h('p', { class: 'sub' }, `${s.overCause} ${s.opts.name} lasted ${s.day + 1} days.`),
      this.stats(s),
      h('div', { class: 'panel-foot' },
        h('button', { class: 'btn', onclick: () => this.app.toTitle() }, 'Title screen'),
        h('button', { class: 'btn primary', onclick: () => this.show('new') }, 'New colony'),
      ),
    );
  }

  private victory(): HTMLElement {
    const s = this.app.sim;
    return h('div', { class: 'panel' },
      h('div', { class: 'badge' }, icon(ICON.sun)),
      h('h2', null, 'Nuptial flight!'),
      h('p', { class: 'sub' }, `Winged queens from ${s.opts.name} have taken to the sky to start colonies of their own. Your colony has done what every colony lives for.`),
      this.stats(s),
      h('div', { class: 'panel-foot' },
        h('button', { class: 'btn', onclick: () => this.show('daughter') }, 'Follow a daughter queen'),
        h('button', { class: 'btn primary', onclick: () => this.back() }, 'Keep playing'),
      ),
    );
  }

  /** Sandbox mode: summon creatures and weather, skip ahead, top up the colony. */
  private sandbox(): HTMLElement {
    const app = this.app;
    const s = app.sim;
    const note = h('p', { class: 'hint' }, 'Creatures arrive near the middle of the view. Tools are free in sandbox games.');
    const act = (label: string, fn: () => string | null): HTMLElement => h('button', {
      class: 'btn small',
      onclick: () => {
        const err = fn();
        note.textContent = err ?? `${label}: done.`;
        if (err) app.sound.error();
      },
    }, label);
    const camX = (): number => Math.round(app.renderer.cam.x);
    const critter = (k: CritterKind, label: string): HTMLElement => act(label, () => (s.eco.summon(k, camX()) ? null : `No ${label.toLowerCase()} could come: it needs something to hunt.`));
    const p = s.player;
    return h('div', { class: 'panel' },
      this.head('Sandbox'),
      h('h3', null, 'Creatures'),
      h('div', { class: 'btn-grid' },
        critter('beetle', 'Beetle'), critter('caterpillar', 'Caterpillar'), critter('spider', 'Wolf spider'),
        critter('centipede', 'Centipede'), critter('bird', 'Robin'), critter('ladybird', 'Ladybird'),
        act('Army ants', () => (s.danger.summon() ? null : 'A column is already on its way.'))),
      h('h3', null, 'Weather and time'),
      h('div', { class: 'btn-grid' },
        act('Rain', () => {
          s.weather.raining = true;
          s.weather.t = 70;
          return null;
        }),
        act('Clear skies', () => {
          s.weather.t = 0;
          return null;
        }),
        act('Next season', () => {
          s.time = (Math.floor(s.day / SEASON_DAYS) + 1) * SEASON_DAYS * DAY + DAY * 0.3;
          return null;
        })),
      h('h3', null, 'Your colony'),
      h('div', { class: 'btn-grid' },
        act('+20 workers', () => {
          if (!p?.settled) return 'Wait until the queen has dug her chamber.';
          for (let k = 0; k < 20; k++) p.spawn('worker', true, p.randomNestCell());
          return null;
        }),
        act('Fill the stores', () => {
          if (!p) return 'Release the queen first.';
          p.sugar = Math.max(p.sugar, p.cap * 0.6);
          p.protein = Math.max(p.protein, p.cap * 0.4);
          return null;
        })),
      note,
      h('div', { class: 'panel-foot' }, h('button', { class: 'btn primary', onclick: () => this.back() }, 'Done')),
    );
  }

  /** Everything the keeper has seen, across all games: an entry unlocks the first time it turns up [v1.2 QoL]. */
  private almanac(): HTMLElement {
    const seen = this.app.almanac.seen;
    const groups: AlmanacGroup[] = ['Ants', 'Creatures', 'Places', 'Behaviour'];
    return h('div', { class: 'panel wide almanac' },
      this.head('Almanac'),
      h('p', { class: 'sub' }, `${seen.size} of ${ALMANAC.length} entries. New ones unlock the first time you see them in a game.`),
      ...groups.map((g) => h('section', null,
        h('h3', null, g),
        h('div', { class: 'alm-grid' }, ...ALMANAC.filter((e) => e.group === g).map((e) => seen.has(e.id)
          ? h('article', { class: 'alm' }, h('h4', null, e.title), h('p', null, e.text))
          : h('article', { class: 'alm locked' }, h('h4', null, '???'), h('p', null, e.hint)))))),
    );
  }

  /** Lineage mode [v1.6]: follow one of the young queens to new ground, with the traits her mother earned. */
  private daughter(): HTMLElement {
    const s = this.app.sim;
    const o = daughterOptions(s);
    const lin = o.lineage!;
    const had = new Set<TraitId>(s.opts.lineage?.traits ?? []);
    const rows = (Object.keys(TRAITS) as TraitId[]).map((id) => {
      const t = TRAITS[id];
      const on = lin.traits.includes(id);
      const note = had.has(id) ? 'Inherited' : on ? 'Earned by this colony' : `Earn it with ${t.how}`;
      return h('li', { class: on ? 'done' : '' },
        on ? h('span', { class: 'g-ico' }, icon(ICON.check)) : h('span', { class: 'g-ico ring' }),
        h('div', { class: 'grow' }, h('strong', null, t.name), h('p', null, `${t.desc} ${note}.`)));
    });
    const line = [s.opts.name, ...(s.opts.lineage?.ancestors ?? [])].join(' ← ');
    return h('div', { class: 'panel' },
      this.head('A daughter colony'),
      h('p', { class: 'sub' }, `One of the young queens from ${s.opts.name} lands on fresh ground nearby. You'll raise ${o.name}, generation ${lin.gen}: same species and biome, with the traits below. ${s.opts.name} stays on next door as a friendly neighbour.`),
      h('h3', null, `Traits (${lin.traits.length} of 4)`),
      h('ul', { class: 'goals' }, ...rows),
      h('h3', null, 'Line'),
      h('p', { class: 'sub' }, line),
      h('div', { class: 'panel-foot' },
        h('button', { class: 'btn', onclick: () => this.back() }, 'Not yet'),
        h('button', { class: 'btn primary', onclick: () => this.app.newGame(o) }, `Fly to ${o.name}`),
      ),
    );
  }
}

import { h, icon } from './dom';
import { ICON } from './icons';
import { DAY, SEASONS } from '../config';
import type { App } from '../app';

type Frame = 'none' | 'vignette' | 'polaroid';

const FRAMES: [Frame, string][] = [['none', 'No frame'], ['vignette', 'Vignette'], ['polaroid', 'Polaroid']];

/**
 * Photo mode [v1.2 QoL]: the UI steps aside, the clock stops, the keeper can slide the light through the day and put a
 * frame round the view, then save it as a picture. Closing puts the clock back exactly where it was.
 */
export class Photo {
  active = false;
  private frame: Frame = 'vignette';
  private base = 0;
  private wasPaused = false;
  private readonly bar = h('div', { class: 'photo-bar card hidden' });
  private readonly overlay = h('div', { class: 'photo-frame hidden' });
  private readonly caption = h('div', { class: 'photo-caption' });
  private readonly slider = h('input', { type: 'range', min: '0', max: '1000', value: '500', 'aria-label': 'Time of day' });
  private readonly clock = h('span', { class: 'photo-clock' });
  private readonly frameBtns = new Map<Frame, HTMLButtonElement>();

  constructor(private readonly app: App) {
    this.slider.addEventListener('input', () => this.scrub());
    const frames = h('div', { class: 'seg' });
    for (const [f, label] of FRAMES) {
      const b = h('button', { onclick: () => this.setFrame(f) }, label);
      this.frameBtns.set(f, b);
      frames.append(b);
    }
    this.bar.append(
      h('div', { class: 'photo-time' }, icon(ICON.sun), this.slider, this.clock),
      frames,
      h('button', { class: 'btn small primary', onclick: () => this.save() }, icon(ICON.camera), 'Save picture'),
      h('button', { class: 'icon-btn', title: 'Leave photo mode (H)', 'aria-label': 'Leave photo mode', onclick: () => this.close() }, icon(ICON.close)),
    );
    this.overlay.append(this.caption);
    document.body.append(this.overlay, this.bar);
    this.setFrame(this.frame);
  }

  toggle(): void {
    if (this.active) this.close();
    else this.open();
  }

  open(): void {
    const app = this.app;
    if (app.state !== 'playing' || app.menus.open || this.active) return;
    this.active = true;
    const s = app.sim;
    this.base = s.time;
    this.wasPaused = app.paused;
    app.paused = true;
    app.hud.show(false);
    app.hud.setTip(null, 0, 0);
    this.slider.value = String(Math.round(s.dayFrac * 1000));
    this.bar.classList.remove('hidden');
    this.overlay.classList.remove('hidden');
    document.body.classList.add('photo');
    this.refresh();
  }

  close(): void {
    if (!this.active) return;
    const app = this.app;
    this.active = false;
    const s = app.sim;
    s.time = this.base;
    s.syncClock();
    app.paused = this.wasPaused;
    app.hud.show(true);
    this.bar.classList.add('hidden');
    this.overlay.classList.add('hidden');
    document.body.classList.remove('photo');
  }

  private scrub(): void {
    const s = this.app.sim;
    s.time = Math.floor(this.base / DAY) * DAY + (Number(this.slider.value) / 1000) * DAY;
    s.syncClock();
    this.refresh();
  }

  private setFrame(f: Frame): void {
    this.frame = f;
    for (const [k, b] of this.frameBtns) b.classList.toggle('on', k === f);
    this.overlay.className = `photo-frame ${f}${this.active ? '' : ' hidden'}`;
  }

  private get title(): string {
    const s = this.app.sim;
    return `${s.opts.name} · ${SEASONS[s.season]}, day ${s.day + 1}`;
  }

  private refresh(): void {
    const f = this.app.sim.dayFrac;
    const hr = Math.floor(f * 24);
    const mn = Math.floor((f * 24 - hr) * 60);
    this.clock.textContent = `${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
    this.caption.textContent = this.title;
  }

  /** The view as the keeper sees it, frame and all, as a PNG download. */
  private save(): void {
    const src = this.app.canvas;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const W0 = out.width;
    const H0 = out.height;
    const u = Math.min(W0, H0) / 100;
    if (this.frame === 'vignette') {
      const g = ctx.createRadialGradient(W0 / 2, H0 / 2, Math.min(W0, H0) * 0.35, W0 / 2, H0 / 2, Math.hypot(W0, H0) * 0.55);
      g.addColorStop(0, 'rgba(20,12,6,0)');
      g.addColorStop(1, 'rgba(20,12,6,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W0, H0);
      ctx.font = `600 ${Math.round(u * 2.6)}px Georgia, serif`;
      ctx.fillStyle = 'rgba(255,248,236,0.9)';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = u;
      ctx.fillText(this.title, u * 3, H0 - u * 3);
      ctx.shadowBlur = 0;
    } else if (this.frame === 'polaroid') {
      const side = u * 4;
      const foot = u * 13;
      ctx.fillStyle = '#fbf8f1';
      ctx.fillRect(0, 0, W0, side);
      ctx.fillRect(0, 0, side, H0);
      ctx.fillRect(W0 - side, 0, side, H0);
      ctx.fillRect(0, H0 - foot, W0, foot);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = Math.max(1, u * 0.2);
      ctx.strokeRect(side, side, W0 - side * 2, H0 - side - foot);
      ctx.font = `italic ${Math.round(u * 4.2)}px Georgia, 'Palatino Linotype', serif`;
      ctx.fillStyle = '#3b2f28';
      ctx.textAlign = 'center';
      ctx.fillText(this.title, W0 / 2, H0 - foot / 2 + u * 1.4);
      ctx.textAlign = 'left';
    }
    const s = this.app.sim;
    const slug = s.opts.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'colony';
    out.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `formica-${slug}-day-${s.day + 1}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.app.sound.chime();
    }, 'image/png');
  }
}

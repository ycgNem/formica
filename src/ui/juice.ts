import { h, fmt } from './dom';

const URLS = import.meta.glob('../art/ui/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** A pixel-art icon from src/art/ui, drawn crisp at any size. */
export function pix(name: string, cls = 'pix'): HTMLImageElement {
  return h('img', { class: cls, src: URLS[`../art/ui/${name}.png`] ?? '', alt: '', draggable: 'false' });
}

/** A number that counts toward its target instead of jumping, and pops when it goes up. */
export class Counter {
  private shown = 0;
  private target = 0;
  private first = true;

  constructor(readonly el: HTMLElement, private readonly format: (n: number) => string = fmt) {}

  set(v: number): void {
    if (this.first) {
      this.first = false;
      this.shown = this.target = v;
      this.el.textContent = this.format(v);
      return;
    }
    if (v > this.target + 0.5) pop(this.el, 'up');
    else if (v < this.target - 0.5) pop(this.el, 'down');
    this.target = v;
  }

  reset(): void {
    this.first = true;
  }

  /** Ease the shown value toward the target; call every frame. */
  tick(dt: number): void {
    if (this.shown === this.target) return;
    const d = this.target - this.shown;
    const step = d * Math.min(1, dt * 10);
    this.shown = Math.abs(d) < 0.5 || Math.abs(step) < 0.05 ? this.target : this.shown + step;
    const text = this.format(this.shown);
    if (this.el.textContent !== text) this.el.textContent = text;
  }
}

/** Restart a one-shot CSS animation class. */
export function pop(el: HTMLElement, kind: 'up' | 'down' | 'bump' = 'bump'): void {
  el.classList.remove('pop-up', 'pop-down', 'pop-bump');
  void el.offsetWidth;
  el.classList.add(`pop-${kind}`);
}

/** Text that rises from an element and fades, like "+14". */
export function floatText(from: HTMLElement, text: string, tone: 'good' | 'bad' | 'gold' = 'gold'): void {
  const r = from.getBoundingClientRect();
  const el = h('div', { class: `float-text ${tone}` }, text);
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top + r.height / 2}px`;
  document.body.append(el);
  el.addEventListener('animationend', () => el.remove());
}

const CONFETTI = ['#f2c14e', '#e8743b', '#7cc36a', '#5aa9e6', '#e86a92', '#fff3c4'];

/** A burst of confetti from a screen point. */
export function burst(x: number, y: number, n = 28, colors = CONFETTI): void {
  const box = h('div', { class: 'confetti' });
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = 70 + Math.random() * 110;
    const p = h('i');
    p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * d * 0.7 - 40}px`);
    p.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.08}s`;
    if (i % 3 === 0) p.style.borderRadius = '50%';
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 1600);
}

/** A big banner that drops in from the top, holds, and leaves. Only one at a time; later ones queue. */
export class Banners {
  private readonly queue: (() => HTMLElement)[] = [];
  private busy = false;
  /** Bumped by clear(), so timers from a banner that was cleared away can't free up the slot. */
  private gen = 0;

  constructor(private readonly host: HTMLElement) {}

  show(make: () => HTMLElement, hold = 2600, confetti = false): void {
    // At high speed several can land at once; keep only the freshest few
    if (this.queue.length >= 3) this.queue.shift();
    this.queue.push(() => {
      const el = make();
      const gen = this.gen;
      if (confetti) {
        requestAnimationFrame(() => {
          const r = el.getBoundingClientRect();
          burst(r.left + r.width / 2, r.top + r.height / 2, 34);
        });
      }
      setTimeout(() => el.classList.add('out'), hold);
      setTimeout(() => {
        el.remove();
        if (gen !== this.gen) return;
        this.busy = false;
        this.next();
      }, hold + 450);
      return el;
    });
    this.next();
  }

  clear(): void {
    this.gen++;
    this.queue.length = 0;
    this.host.replaceChildren();
    this.busy = false;
  }

  private next(): void {
    if (this.busy) return;
    const make = this.queue.shift();
    if (!make) return;
    this.busy = true;
    this.host.append(make());
  }
}

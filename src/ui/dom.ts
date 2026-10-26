type Attr = string | number | boolean | (() => void) | undefined;
type Kid = Node | string | number | null | undefined | false;

/** Tiny element builder. `on*` attributes become event listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, Attr> | null,
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      if (typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
}

export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

export function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function icon(svg: string, cls = 'ico'): HTMLSpanElement {
  return h('span', { class: cls, html: svg });
}

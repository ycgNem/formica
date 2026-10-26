import { DAY, SEASON_DAYS } from '../config';
import type { Sample } from '../sim';

export interface Series {
  values: number[];
  color: string;
  /** Drawn as bars rather than a line. */
  bars?: boolean;
  dash?: boolean;
}

/** Faint season tints behind the plot, so a winter dip reads as a winter dip. */
const SEASON_TINT = ['rgba(120,180,90,0.10)', 'rgba(242,181,58,0.12)', 'rgba(200,110,60,0.10)', 'rgba(110,140,190,0.13)'];

/**
 * A small line chart of the colony's history [v1.2 QoL]. Plain canvas, sized to its CSS box, redrawn whenever the
 * history grows.
 */
export function drawChart(canvas: HTMLCanvasElement, history: Sample[], series: Series[]): void {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth || 260;
  const ch = canvas.clientHeight || 96;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const n = history.length;
  const padL = 4;
  const padR = 4;
  const padT = 14;
  const padB = 14;
  const w = cw - padL - padR;
  const hgt = ch - padT - padB;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  if (n < 2) {
    ctx.fillStyle = 'rgba(43,33,27,0.45)';
    ctx.fillText('The graph fills in as the days go by.', padL, padT + hgt / 2);
    return;
  }
  const t0 = history[0].t;
  const t1 = history[n - 1].t;
  const span = Math.max(1, t1 - t0);
  const xOf = (t: number): number => padL + ((t - t0) / span) * w;

  // Season bands
  const seasonLen = DAY * SEASON_DAYS;
  for (let s = Math.floor(t0 / seasonLen) * seasonLen; s < t1; s += seasonLen) {
    const a = xOf(Math.max(t0, s));
    const b = xOf(Math.min(t1, s + seasonLen));
    ctx.fillStyle = SEASON_TINT[Math.floor(s / seasonLen) % 4];
    ctx.fillRect(a, padT, b - a, hgt);
  }

  let max = 1;
  for (const s of series) for (const v of s.values) max = Math.max(max, v);
  max = niceMax(max);
  const yOf = (v: number): number => padT + hgt - (v / max) * hgt;

  // Gridlines at a half and the top
  ctx.strokeStyle = 'rgba(43,33,27,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const f of [0.5, 1]) {
    const y = Math.round(yOf(max * f)) + 0.5;
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + w, y);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(43,33,27,0.5)';
  ctx.fillText(fmtNum(max), padL, padT - 3);

  const barW = Math.max(1, (w / n) * 0.7);
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    if (s.bars) {
      s.values.forEach((v, k) => {
        if (v <= 0) return;
        const x = xOf(history[k].t);
        ctx.fillRect(x - barW / 2, yOf(v), barW, padT + hgt - yOf(v));
      });
      continue;
    }
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.setLineDash(s.dash ? [4, 3] : []);
    ctx.beginPath();
    s.values.forEach((v, k) => {
      const x = xOf(history[k].t);
      const y = yOf(v);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Day labels along the bottom, as many as fit
  ctx.fillStyle = 'rgba(43,33,27,0.5)';
  const days = span / DAY;
  const every = days <= 6 ? 1 : days <= 14 ? 2 : days <= 30 ? 5 : days <= 70 ? 10 : 20;
  for (let d = Math.ceil(t0 / DAY / every) * every; d * DAY <= t1; d += every) {
    const x = xOf(d * DAY);
    const label = `Day ${d + 1}`;
    const tw = ctx.measureText(label).width;
    if (x - tw / 2 < padL || x + tw / 2 > padL + w) continue;
    ctx.fillText(label, x - tw / 2, ch - 3);
  }
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

function fmtNum(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : String(v);
}

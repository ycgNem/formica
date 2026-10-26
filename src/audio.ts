/** Tiny synthesized sound kit. Nothing plays until the first user gesture unlocks audio. */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rain: GainNode | null = null;
  private wind: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private vol = 0.6;
  private nextChirp = 0;
  private nextCricket = 0;
  private lastScratch = 0;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = this.vol;
      master.connect(ctx.destination);
      // Looping filtered noise for rain
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1100;
      const rain = ctx.createGain();
      rain.gain.value = 0;
      src.connect(filter).connect(rain).connect(master);
      src.start();
      // A soft wind bed under everything, from the same noise run through a low band
      const wsrc = ctx.createBufferSource();
      wsrc.buffer = buf;
      wsrc.loop = true;
      wsrc.loopStart = 0.7;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 380;
      band.Q.value = 0.5;
      const wind = ctx.createGain();
      wind.gain.value = 0;
      wsrc.connect(band).connect(wind).connect(master);
      wsrc.start(0, 0.7);
      this.ctx = ctx;
      this.master = master;
      this.rain = rain;
      this.wind = wind;
      this.noise = buf;
    } catch {
      // No audio available
    }
  }

  set volume(v: number) {
    this.vol = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  get volume(): number {
    return this.vol;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.15, slide = 0, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.vol <= 0) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  click(): void {
    this.tone(720, 0.05, 'triangle', 0.06);
  }

  drop(): void {
    this.tone(900, 0.12, 'sine', 0.1, -500);
  }

  thud(): void {
    this.tone(110, 0.18, 'sine', 0.3, -60);
  }

  good(): void {
    this.tone(587, 0.12, 'triangle', 0.08);
    this.tone(880, 0.18, 'triangle', 0.08, 0, 0.09);
  }

  bad(): void {
    this.tone(196, 0.3, 'triangle', 0.12, -40);
  }

  chime(): void {
    this.tone(523, 0.25, 'sine', 0.1);
    this.tone(659, 0.25, 'sine', 0.1, 0, 0.1);
    this.tone(784, 0.4, 'sine', 0.1, 0, 0.2);
  }

  /** Bright two-note blip for earning keeper points. */
  coin(): void {
    this.tone(988, 0.07, 'square', 0.035);
    this.tone(1319, 0.16, 'square', 0.035, 0, 0.06);
  }

  error(): void {
    this.tone(160, 0.12, 'square', 0.04);
  }

  /**
   * The meadow around the nest: wind always, birdsong on spring and summer days, crickets on warm nights. `near` is how
   * much of the view is the surface (0 deep underground, 1 looking at the meadow), so it fades as the camera goes down.
   */
  ambience(light: number, season: number, rain: number, near: number, on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.wind || this.vol <= 0) return;
    const t = ctx.currentTime;
    const winter = season === 3;
    this.wind.gain.setTargetAtTime(on ? (0.02 + near * (winter ? 0.07 : 0.035)) * (1 - rain * 0.6) : 0, t, 0.8);
    if (!on || near < 0.08) return;
    if (t >= this.nextChirp) {
      const busy = season === 1 ? 1 : season === 0 ? 0.8 : season === 2 ? 0.35 : 0;
      this.nextChirp = t + 1.2 + Math.random() * 4.5;
      if (light > 0.45 && rain < 0.3 && Math.random() < busy) this.birdsong(near);
    }
    if (t >= this.nextCricket) {
      this.nextCricket = t + 0.7 + Math.random() * 1.6;
      if (light < 0.3 && (season === 1 || season === 2) && rain < 0.2) this.cricket(near);
    }
  }

  /** A short phrase of two to five whistled notes. */
  private birdsong(near: number): void {
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2400 + Math.random() * 1600;
    const vol = 0.012 + near * 0.012;
    for (let k = 0; k < n; k++) {
      const f = base * (0.85 + Math.random() * 0.4);
      this.tone(f, 0.07 + Math.random() * 0.06, 'sine', vol, (Math.random() - 0.4) * 900, k * (0.1 + Math.random() * 0.06));
    }
  }

  /** Three or four quick chirps. */
  private cricket(near: number): void {
    const f = 4300 + Math.random() * 500;
    const n = 3 + Math.floor(Math.random() * 2);
    for (let k = 0; k < n; k++) this.tone(f, 0.022, 'triangle', 0.008 + near * 0.008, 0, k * 0.048);
  }

  /** Grit scraped from the dig face, when the camera is close enough to hear it. */
  scratch(level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.vol <= 0) return;
    const t = ctx.currentTime;
    if (t - this.lastScratch < 0.09 + Math.random() * 0.12) return;
    this.lastScratch = t;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1600 + Math.random() * 1400;
    const g = ctx.createGain();
    const dur = 0.035 + Math.random() * 0.04;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.02 * Math.min(1, level), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.8, dur + 0.02);
  }

  setRain(level: number): void {
    if (this.rain && this.ctx) this.rain.gain.setTargetAtTime(level * 0.22, this.ctx.currentTime, 0.4);
  }
}

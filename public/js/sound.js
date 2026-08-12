// Optional sound (spec §57). Muted by default, respects autoplay rules
// (AudioContext is created lazily on first user gesture), never required for
// understanding the game. Synth tones only — no asset downloads.
export class Sound {
  constructor() {
    this.enabled = false;
    this.ctx = null;
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) this._ensure();
    return this.enabled;
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _tone(freq, durationMs, type = 'sine', gain = 0.05) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durationMs / 1000);
  }

  correct() {
    this._tone(660, 90, 'triangle', 0.06);
    setTimeout(() => this._tone(990, 140, 'triangle', 0.06), 80);
  }
  wrong() {
    this._tone(300, 180, 'sawtooth', 0.04);
    setTimeout(() => this._tone(220, 220, 'sawtooth', 0.04), 120);
  }
  timeout() {
    this._tone(140, 320, 'sine', 0.06);
  }
  warn() {
    this._tone(520, 70, 'square', 0.03);
  }
  appear() {
    this._tone(440, 40, 'sine', 0.02);
  }
}

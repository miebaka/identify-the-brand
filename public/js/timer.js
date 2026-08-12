// Monotonic countdown timer for the question UI.
//
// Uses performance.now() + requestAnimationFrame for smooth, drift-free visual
// updates (spec §17). This governs ONLY the user experience; the server is the
// authority on whether an answer beat the deadline. On expiry it calls
// onExpire exactly once.
export class CountdownTimer {
  constructor({ durationMs, onTick, onExpire, onMilestone }) {
    this.durationMs = durationMs;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this.onMilestone = onMilestone; // (secondsRemaining) for a11y announcements
    this._raf = null;
    this._start = 0;
    this._expired = false;
    this._announced = new Set();
    this._milestones = [5, 2];
  }

  start() {
    this.stop();
    this._start = performance.now();
    this._expired = false;
    this._announced.clear();
    const loop = (now) => {
      const elapsed = now - this._start;
      const remaining = Math.max(0, this.durationMs - elapsed);
      const fraction = remaining / this.durationMs; // 1 -> 0
      const seconds = remaining / 1000;

      if (this.onTick) this.onTick({ remaining, fraction, seconds });

      // Accessibility milestones (announce once each).
      if (this.onMilestone) {
        for (const m of this._milestones) {
          if (seconds <= m && !this._announced.has(m)) {
            this._announced.add(m);
            this.onMilestone(m);
          }
        }
      }

      if (remaining <= 0) {
        if (!this._expired) {
          this._expired = true;
          if (this.onMilestone) this.onMilestone(0);
          if (this.onExpire) this.onExpire();
        }
        return;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  // Prevent a queued expiry from firing after the question is answered.
  disarm() {
    this._expired = true;
    this.stop();
  }
}

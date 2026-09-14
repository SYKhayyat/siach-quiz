export class Timer {
  constructor(element) {
    this.element = element;
    this.startEpoch = 0;
    this.held = 0;
    this.intervalId = 0;
  }
  start() {
    this.stop();
    this.startEpoch = Date.now();
    this.render();
    this.intervalId = setInterval(() => this.render(), 500);
  }
  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = 0;
  }
  reset() {
    this.stop();
    this.held = 0;
    this.startEpoch = 0;
    this.element.textContent = Timer.formatClock(0);
  }
  elapsedMs() {
    if (!this.startEpoch) return this.held;
    return this.held + Date.now() - this.startEpoch;
  }
  render() {
    this.element.textContent = Timer.formatClock(this.elapsedMs());
  }
  static formatClock(ms) {
    const total = Math.floor(ms / 1000);
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }
  static formatLong(ms) {
    const total = Math.floor(ms / 1000);
    const minutes = Math.floor(total / 60);
    if (minutes < 1) return total + "s";
    return minutes + "m " + (total % 60) + "s";
  }
}

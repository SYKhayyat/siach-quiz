export const ROUND_SIZE = 20;

function shuffledSlots() {
  const slots = [0, 1, 2, 3];
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

function sampledOrder(poolSize, k) {
  const idx = Array.from({ length: poolSize }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, Math.min(k, poolSize));
}

export class QuizStore {
  constructor(topics) {
    this.topics = topics;
    this.topicId = null;
    this.order = [];
    this.shuffles = [];
    this.answers = [];
    this.revealed = [];
    this.qTimes = [];
    this.view = 0;
    this.pending = null;
    this.qStart = 0;
  }
  topicIds() {
    return Object.keys(this.topics);
  }
  current() {
    return this.topics[this.topicId];
  }
  get size() {
    return this.order.length;
  }
  poolSize() {
    return this.current().questions.length;
  }
  questionAt(i) {
    return this.current().questions[this.order[i]];
  }
  choiceText(i, slot) {
    return this.questionAt(i).choices[this.shuffles[i][slot]];
  }
  correctSlot(i) {
    return this.shuffles[i].indexOf(this.questionAt(i).answer);
  }
  currentIndex() {
    const i = this.revealed.indexOf(false);
    return i < 0 ? this.size : i;
  }
  start(topicId) {
    this.topicId = topicId;
    const pool = this.poolSize();
    const saved = readProgress(topicId, pool);
    if (saved) {
      this.order = saved.order;
      this.shuffles = saved.shuffles;
      this.answers = saved.answers;
      this.revealed = saved.revealed;
      this.qTimes = saved.qTimes;
    } else {
      this.order = sampledOrder(pool, ROUND_SIZE);
      this.shuffles = this.order.map(() => shuffledSlots());
      this.answers = Array(this.order.length).fill(null);
      this.revealed = Array(this.order.length).fill(false);
      this.qTimes = Array(this.order.length).fill(null);
    }
    this.pending = null;
    this.view = this.currentIndex();
    this.touchTimer();
  }
  touchTimer() {
    this.qStart = Date.now();
  }
  answer(qi, slot) {
    if (this.revealed[qi]) return false;
    this.answers[qi] = slot;
    this.revealed[qi] = true;
    this.qTimes[qi] = Date.now() - this.qStart;
    this.saveProgress();
    return true;
  }
  counts() {
    let right = 0;
    let wrong = 0;
    let done = 0;
    for (let i = 0; i < this.order.length; i += 1) {
      if (!this.revealed[i]) continue;
      done += 1;
      if (this.answers[i] === this.correctSlot(i)) right += 1;
      else wrong += 1;
    }
    return { right, wrong, done, total: this.order.length };
  }
  restart(topicId) {
    this.clearProgress(topicId);
    this.start(topicId);
  }
  clearProgress(topicId) {
    try {
      localStorage.removeItem("csq-" + (topicId || this.topicId));
    } catch {
      /* private-only mode: nothing persisted anyway */
    }
  }
  saveProgress() {
    try {
      localStorage.setItem(
        "csq-" + this.topicId,
        JSON.stringify({
          order: this.order,
          shuffles: this.shuffles,
          answers: this.answers,
          revealed: this.revealed,
          qTimes: this.qTimes,
        })
      );
    } catch {
      /* private-only mode: progress simply won't persist */
    }
  }
}

function validShuffle(s) {
  return (
    Array.isArray(s) &&
    s.length === 4 &&
    [0, 1, 2, 3].every((n) => s.includes(n))
  );
}

export function readProgress(topicId, poolSize) {
  try {
    const raw = localStorage.getItem("csq-" + topicId);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.order) || data.order.length === 0 || data.order.length > ROUND_SIZE) return null;
    if (!data.order.every((n) => Number.isInteger(n) && n >= 0 && n < poolSize)) return null;
    const n = data.order.length;
    if (!Array.isArray(data.shuffles) || data.shuffles.length !== n || !data.shuffles.every(validShuffle)) return null;
    if (!Array.isArray(data.answers) || data.answers.length !== n) return null;
    if (!Array.isArray(data.revealed) || data.revealed.length !== n) return null;
    if (!Array.isArray(data.qTimes) || data.qTimes.length !== n) return null;
    return data;
  } catch {
    return null;
  }
}

export function readBest(topicId) {
  try {
    return localStorage.getItem("csq-best-" + topicId);
  } catch {
    return null;
  }
}

export function writeBest(topicId, score) {
  try {
    const prev = localStorage.getItem("csq-best-" + topicId);
    if (!prev || parseInt(score, 10) > parseInt(prev, 10)) localStorage.setItem("csq-best-" + topicId, score);
  } catch {
    /* private-only mode: best score simply won't persist */
  }
}

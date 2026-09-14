export const ROUND_SIZE = 20;

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
    this.answers = [];
    this.revealed = [];
    this.pos = 0;
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
  start(topicId) {
    this.topicId = topicId;
    this.pos = 0;
    const pool = this.poolSize();
    const saved = readProgress(topicId, pool);
    if (saved) {
      this.order = saved.order;
      this.answers = saved.answers;
      this.revealed = saved.revealed;
      this.pos = this.revealed.indexOf(false);
      if (this.pos < 0) this.pos = 0;
    } else {
      this.order = sampledOrder(pool, ROUND_SIZE);
      this.answers = Array(this.order.length).fill(null);
      this.revealed = Array(this.order.length).fill(false);
    }
  }
  answer(qi, choice) {
    if (this.revealed[qi]) return false;
    this.answers[qi] = choice;
    this.revealed[qi] = true;
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
      if (this.answers[i] === this.questionAt(i).answer) right += 1;
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
        JSON.stringify({ order: this.order, answers: this.answers, revealed: this.revealed })
      );
    } catch {
      /* private-only mode: progress simply won't persist */
    }
  }
}

export function readProgress(topicId, poolSize) {
  try {
    const raw = localStorage.getItem("csq-" + topicId);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.order) || data.order.length === 0 || data.order.length > ROUND_SIZE) return null;
    if (!data.order.every((n) => Number.isInteger(n) && n >= 0 && n < poolSize)) return null;
    if (!Array.isArray(data.answers) || data.answers.length !== data.order.length) return null;
    if (!Array.isArray(data.revealed) || data.revealed.length !== data.order.length) return null;
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

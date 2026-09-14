export class QuizStore {
  constructor(topics) {
    this.topics = topics;
    this.topicId = null;
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
  start(topicId) {
    this.topicId = topicId;
    this.pos = 0;
    const total = this.current().questions.length;
    this.answers = Array(total).fill(null);
    this.revealed = Array(total).fill(false);
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
    const questions = this.current().questions;
    questions.forEach((q, i) => {
      if (!this.revealed[i]) return;
      done += 1;
      if (this.answers[i] === q.answer) right += 1;
      else wrong += 1;
    });
    return { right, wrong, done, total: questions.length };
  }
  saveProgress() {
    try {
      localStorage.setItem("csq-" + this.topicId, JSON.stringify({ answers: this.answers, revealed: this.revealed }));
    } catch {
      /* private-only mode: progress simply won't persist */
    }
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

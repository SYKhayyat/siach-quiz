import { acceptedAnswer, aiReviewAllowed, gradeTextAnswer } from "./check.js";
import { aiAvailable, aiSupport, judgeAnswer } from "./ai/on-device.js";
import { runCodeTests } from "./engines/index.js";

export const ROUND_SIZE = 20;
const SAVE_VERSION = 4;

/** The optional on-device review is opt-in per browser, and stays that way. */
const AI_SETTING_KEY = "csq-ai-review";

export function readAIEnabled() {
  try {
    return localStorage.getItem(AI_SETTING_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeAIEnabled(on) {
  try {
    if (on) localStorage.setItem(AI_SETTING_KEY, "on");
    else localStorage.removeItem(AI_SETTING_KEY);
  } catch {
    /* private-only mode: the setting simply won't stick */
  }
}

/** Clamp a user-typed "how many written questions" value into a usable count. */
export function normalizeTextCount(value, maxText) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(n, ROUND_SIZE, Math.max(0, maxText)));
}

function shuffledSlots() {
  const slots = [0, 1, 2, 3];
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

function sampleIndexes(poolSize, k) {
  const idx = Array.from({ length: poolSize }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, Math.min(k, poolSize));
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class QuizStore {
  constructor(topics) {
    this.topics = topics;
    this.topicId = null;
    this.round = [];
    this.answers = [];
    this.revealed = [];
    this.marks = [];
    this.blanks = [];
    this.hints = [];
    this.traps = [];
    this.codeMsg = [];
    this.aiNotes = [];
    this.aiState = [];
    this.qTimes = [];
    this.view = 0;
    this.pending = null;
    this.qStart = 0;
    this.mix = { text: 0 };
  }
  topicIds() {
    return Object.keys(this.topics);
  }
  current() {
    return this.topics[this.topicId];
  }
  get size() {
    return this.round.length;
  }
  poolSize() {
    return this.current().questions.length;
  }
  textPool() {
    return this.current().text || [];
  }
  itemAt(i) {
    const r = this.round[i];
    return r.kind === "mc" ? this.current().questions[r.idx] : this.textPool()[r.idx];
  }
  isMC(i) {
    return this.round[i].kind === "mc";
  }
  isCode(i) {
    return this.round[i].kind === "code";
  }
  /** Display slot -> index into the question's own choices array. */
  choiceIndex(i, slot) {
    return this.round[i].shuffle[slot];
  }
  choiceText(i, slot) {
    return this.itemAt(i).choices[this.choiceIndex(i, slot)];
  }
  correctSlot(i) {
    return this.round[i].shuffle.indexOf(this.itemAt(i).answer);
  }
  currentIndex() {
    const i = this.revealed.indexOf(false);
    return i < 0 ? this.size : i;
  }
  start(topicId, textCount = 0) {
    this.topicId = topicId;
    const pool = this.poolSize();
    const txPool = this.textPool().length;
    const saved = readProgress(topicId, pool, txPool);
    if (saved) {
      this.round = saved.round;
      this.answers = saved.answers;
      this.revealed = saved.revealed;
      this.marks = saved.marks;
      this.blanks = saved.blanks;
      this.hints = saved.hints;
      this.traps = saved.traps;
      this.codeMsg = saved.codeMsg;
      this.aiNotes = saved.aiNotes;
      this.aiState = Array(saved.round.length).fill("idle");
      this.qTimes = saved.qTimes;
      this.mix = saved.mix;
    } else {
      const t = Math.max(0, Math.min(textCount, ROUND_SIZE, txPool));
      const m = Math.min(ROUND_SIZE - t, pool);
      const items = [
        ...sampleIndexes(txPool, t).map((idx) => ({ kind: this.textPool()[idx].kind, idx })),
        ...sampleIndexes(pool, m).map((idx) => ({ kind: "mc", idx, shuffle: shuffledSlots() })),
      ];
      this.round = shuffleInPlace(items).slice(0, ROUND_SIZE);
      this.answers = Array(this.round.length).fill(null);
      this.revealed = Array(this.round.length).fill(false);
      this.marks = Array(this.round.length).fill(null);
      this.blanks = Array(this.round.length).fill(null);
      this.hints = Array(this.round.length).fill("");
      this.traps = Array(this.round.length).fill("");
      this.codeMsg = Array(this.round.length).fill("");
      this.aiNotes = Array(this.round.length).fill("");
      this.aiState = Array(this.round.length).fill("idle");
      this.qTimes = Array(this.round.length).fill(null);
      this.mix = { text: t };
    }
    this.pending = null;
    this.view = this.currentIndex();
    this.touchTimer();
  }
  touchTimer() {
    this.qStart = Date.now();
  }
  stamp(i) {
    this.qTimes[i] = Date.now() - this.qStart;
  }
  answerMC(i, slot) {
    if (this.revealed[i]) return false;
    this.answers[i] = slot;
    this.marks[i] = slot === this.correctSlot(i);
    this.revealed[i] = true;
    this.stamp(i);
    this.saveProgress();
    return true;
  }
  answerText(i, input) {
    if (this.revealed[i]) return null;
    const q = this.itemAt(i);
    const result = gradeTextAnswer(q, input);
    this.answers[i] = input;
    this.marks[i] = result.pass;
    this.blanks[i] = result.marks;
    this.hints[i] = result.hint || "";
    this.traps[i] = result.trap || "";
    this.revealed[i] = true;
    this.stamp(i);
    this.saveProgress();
    return result.pass;
  }
  async answerCode(i, code, onStatus) {
    if (this.revealed[i]) return null;
    const q = this.itemAt(i);
    const result = await runCodeTests({
      lang: q.lang || "javascript",
      code,
      tests: q.tests,
      prelude: q.prelude,
      onStatus,
    });
    if (result.unavailable) {
      // The engine could not start (offline, blocked, unsupported browser).
      // Leave the question unanswered so the student keeps their attempt.
      return { unavailable: true, pass: false, message: result.message };
    }
    this.answers[i] = code;
    this.marks[i] = result.pass;
    this.codeMsg[i] = result.message;
    this.hints[i] = result.hint || "";
    this.revealed[i] = true;
    this.stamp(i);
    this.saveProgress();
    return { pass: result.pass, message: result.message };
  }
  /**
   * Ask the on-device model for a second opinion on a written answer the rules
   * marked wrong. Narrow on purpose: only conceptual questions (`aiReviewAllowed`)
   * qualify, the model can only upgrade a fail, and a failure to load changes
   * nothing about the student's mark.
   */
  async reviewWithAI(i, { engine, onProgress } = {}) {
    const q = this.itemAt(i);
    if (!this.revealed[i]) return { status: "not-answered" };
    if (this.marks[i]) return { status: "already-correct" };
    if (!aiReviewAllowed(q)) {
      this.aiState[i] = "not-allowed";
      return {
        status: "not-allowed",
        message: "This one is exact (syntax, output or a number), so the graded answer is final — a model must not second-guess it.",
      };
    }
    if (!engine && !aiAvailable()) {
      const reason = aiSupport().reason;
      this.aiState[i] = "unsupported";
      this.aiNotes[i] = reason;
      return { status: "unsupported", message: reason };
    }
    this.aiState[i] = "running";
    try {
      const verdict = await judgeAnswer({
        question: q.q,
        expected: acceptedAnswer(q),
        given: this.answers[i],
        engine,
        onProgress,
      });
      this.aiState[i] = "done";
      this.aiNotes[i] = verdict.reason;
      if (verdict.equivalent) this.marks[i] = true;
      this.saveProgress();
      return { status: "done", equivalent: !!verdict.equivalent, reason: verdict.reason };
    } catch (err) {
      const message = String((err && err.message) || err).slice(0, 300);
      this.aiState[i] = "error";
      this.aiNotes[i] = message;
      return { status: "error", message };
    }
  }
  counts() {
    let right = 0;
    let wrong = 0;
    let done = 0;
    for (let i = 0; i < this.round.length; i += 1) {
      if (!this.revealed[i]) continue;
      done += 1;
      if (this.marks[i]) right += 1;
      else wrong += 1;
    }
    return { right, wrong, done, total: this.round.length };
  }
  replay() {
    this.answers = Array(this.round.length).fill(null);
    this.revealed = Array(this.round.length).fill(false);
    this.marks = Array(this.round.length).fill(null);
    this.blanks = Array(this.round.length).fill(null);
    this.hints = Array(this.round.length).fill("");
    this.traps = Array(this.round.length).fill("");
    this.codeMsg = Array(this.round.length).fill("");
    this.aiNotes = Array(this.round.length).fill("");
    this.aiState = Array(this.round.length).fill("idle");
    this.qTimes = Array(this.round.length).fill(null);
    this.pending = null;
    this.view = 0;
    this.touchTimer();
    this.saveProgress();
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
          v: SAVE_VERSION,
          mix: this.mix,
          round: this.round,
          answers: this.answers,
          revealed: this.revealed,
          marks: this.marks,
          blanks: this.blanks,
          hints: this.hints,
          traps: this.traps,
          codeMsg: this.codeMsg,
          aiNotes: this.aiNotes,
          qTimes: this.qTimes,
        })
      );
    } catch {
      /* private-only mode: progress simply won't persist */
    }
  }
}

function validRound(round, mcPool, txPool) {
  if (!Array.isArray(round) || round.length === 0 || round.length > ROUND_SIZE) return false;
  const used = new Set();
  const unique = round.every((r) => {
    if (!r || !Number.isInteger(r.idx)) return false;
    const key = r.kind + ":" + r.idx;
    if (used.has(key)) return false;
    used.add(key);
    return true;
  });
  if (!unique) return false;
  return round.every((r) => {
    if (!r || !Number.isInteger(r.idx)) return false;
    if (r.kind === "mc") return r.idx >= 0 && r.idx < mcPool && Array.isArray(r.shuffle) && [0, 1, 2, 3].every((n) => r.shuffle.includes(n));
    if (r.kind === "text" || r.kind === "code") return r.idx >= 0 && r.idx < txPool;
    return false;
  });
}

export function readProgress(topicId, mcPool, txPool) {
  try {
    const raw = localStorage.getItem("csq-" + topicId);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== SAVE_VERSION) return null;
    if (!validRound(data.round, mcPool, txPool)) return null;
    const n = data.round.length;
    if (!Array.isArray(data.answers) || data.answers.length !== n) return null;
    if (!Array.isArray(data.revealed) || data.revealed.length !== n) return null;
    if (!Array.isArray(data.marks) || data.marks.length !== n) return null;
    if (!Array.isArray(data.qTimes) || data.qTimes.length !== n) return null;
    data.blanks = Array.isArray(data.blanks) && data.blanks.length === n ? data.blanks : Array(n).fill(null);
    data.hints = Array.isArray(data.hints) && data.hints.length === n ? data.hints : Array(n).fill("");
    data.traps = Array.isArray(data.traps) && data.traps.length === n ? data.traps : Array(n).fill("");
    data.codeMsg = Array.isArray(data.codeMsg) && data.codeMsg.length === n ? data.codeMsg : Array(n).fill("");
    data.aiNotes = Array.isArray(data.aiNotes) && data.aiNotes.length === n ? data.aiNotes : Array(n).fill("");
    data.mix = data.mix && Number.isInteger(data.mix.text) ? data.mix : { text: 0 };
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

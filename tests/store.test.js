import test from "node:test";
import assert from "node:assert/strict";

import { topics } from "../data/all.js";
import { QuizStore, ROUND_SIZE, readProgress, readBest, writeBest } from "../js/store.js";
import { answerSummary } from "../js/views/quiz-view.js";

/* ---- a localStorage stand-in (Node has none) ---- */
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  },
});

function freshStore(topicId = "java") {
  const s = new QuizStore(topics);
  s.start(topicId, 0);
  return s;
}

/** Pin the round so a test can reason about exact slots. */
function pinRound(s, entries) {
  s.round = entries;
  s.answers = Array(entries.length).fill(null);
  s.revealed = Array(entries.length).fill(false);
  s.marks = Array(entries.length).fill(null);
  s.blanks = Array(entries.length).fill(null);
  s.hints = Array(entries.length).fill("");
  s.traps = Array(entries.length).fill("");
  s.codeMsg = Array(entries.length).fill("");
  s.qTimes = Array(entries.length).fill(null);
  return s;
}

test("a round is 20 questions with a mix the caller asks for", () => {
  store.clear();
  const allMc = freshStore("python");
  assert.equal(allMc.size, ROUND_SIZE);
  assert.ok(allMc.round.every((r) => r.kind === "mc"));

  store.clear();
  const allWritten = freshStore("algo");
  allWritten.start("algo", 20);
  assert.equal(allWritten.size, ROUND_SIZE);
  assert.ok(allWritten.round.every((r) => r.kind === "text" || r.kind === "code"));
});

test("a question never appears twice in one round", () => {
  store.clear();
  for (const topic of ["python", "java", "algo", "meth"]) {
    const s = new QuizStore(topics);
    s.start(topic, 10);
    const keys = s.round.map((r) => r.kind + ":" + r.idx);
    assert.equal(new Set(keys).size, keys.length, topic + " round has duplicates");
  }
});

test("multiple-choice notes follow the shuffled choice, not the slot", () => {
  store.clear();
  const s = pinRound(freshStore("java"), [{ kind: "mc", idx: 1, shuffle: [2, 0, 3, 1] }]);
  const question = s.itemAt(0);
  const slot = s.correctSlot(0);
  assert.equal(s.choiceIndex(0, slot), question.answer, "the correct slot maps back to the answer");

  // Answer with the slot showing the wrong choice whose note is informative.
  const wrongChoice = question.choices.findIndex((_, ci) => ci !== question.answer && (question.notes[ci] || "").length > 0);
  const wrongSlot = s.round[0].shuffle.indexOf(wrongChoice);
  s.answerMC(0, wrongSlot);
  const summary = answerSummary(s, 0);
  assert.equal(summary.ok, false);
  assert.equal(summary.note, question.notes[wrongChoice], "the note must match the choice the student picked");
  assert.ok(summary.note.length > 0, "and it must not fall back to an empty note");
});

test("a correct multiple-choice answer carries no note", () => {
  store.clear();
  const s = pinRound(freshStore("java"), [{ kind: "mc", idx: 0, shuffle: [3, 1, 0, 2] }]);
  s.answerMC(0, s.correctSlot(0));
  assert.equal(answerSummary(s, 0).ok, true);
  assert.equal(answerSummary(s, 0).note, "");
});

test("grading text records the hint and the trap separately", () => {
  store.clear();
  const s = freshStore("python");
  const idx = s.textPool().findIndex((q) => q.q.includes("missing dict key"));
  pinRound(s, [{ kind: "text", idx }]);
  s.answerText(0, "KeeyError");
  assert.equal(s.marks[0], false);
  assert.match(s.hints[0], /typo/i);

  pinRound(s, [{ kind: "text", idx }]);
  s.answerText(0, "none");
  assert.match(s.traps[0], /never returns None/);
});

test("progress round-trips through storage, hints included", () => {
  store.clear();
  const s = freshStore("python");
  s.start("python", 6);
  const first = s.itemAt(0);
  if (s.isMC(0)) s.answerMC(0, s.correctSlot(0));
  else s.answerText(0, "zzz");
  assert.equal(s.counts().done, 1);

  const again = new QuizStore(topics);
  again.start("python", 0);
  assert.equal(again.counts().done, 1, "the answer was restored");
  assert.equal(again.mix.text, 6, "the written mix was restored");
  assert.deepEqual(again.round, s.round, "the same round came back");
  assert.equal(again.itemAt(0).q, first.q);
});

test("a save from an older format is ignored instead of half-loaded", () => {
  store.clear();
  const s = freshStore("java");
  const raw = JSON.parse(localStorage.getItem("csq-java"));
  localStorage.setItem("csq-java", JSON.stringify({ ...raw, v: 2 }));
  assert.equal(readProgress("java", topics.java.questions.length, topics.java.text.length), null);
  const fresh = new QuizStore(topics);
  fresh.start("java", 0);
  assert.equal(fresh.counts().done, 0);
});

test("a corrupt or impossible round is rejected", () => {
  store.clear();
  const mcPool = topics.java.questions.length;
  const txPool = topics.java.text.length;
  const base = { v: 3, mix: { text: 0 }, answers: [null], revealed: [false], marks: [null], qTimes: [null] };

  localStorage.setItem("csq-java", JSON.stringify({ ...base, round: [{ kind: "mc", idx: 0, shuffle: [0, 1, 2, 2] }] }));
  assert.equal(readProgress("java", mcPool, txPool), null, "a shuffle must be a permutation");

  localStorage.setItem("csq-java", JSON.stringify({ ...base, round: [{ kind: "mc", idx: 9999, shuffle: [0, 1, 2, 3] }] }));
  assert.equal(readProgress("java", mcPool, txPool), null, "an out-of-range question");

  localStorage.setItem("csq-java", JSON.stringify({ ...base, round: [{ kind: "wat", idx: 0 }] }));
  assert.equal(readProgress("java", mcPool, txPool), null, "an unknown kind");

  localStorage.setItem(
    "csq-java",
    JSON.stringify({
      ...base,
      round: [
        { kind: "mc", idx: 0, shuffle: [0, 1, 2, 3] },
        { kind: "mc", idx: 0, shuffle: [0, 1, 2, 3] },
      ],
      answers: [null, null],
      revealed: [false, false],
      marks: [null, null],
      qTimes: [null, null],
    })
  );
  assert.equal(readProgress("java", mcPool, txPool), null, "the same question twice");
});

test("best score only ever improves", () => {
  store.clear();
  writeBest("java", "7/20");
  assert.equal(readBest("java"), "7/20");
  writeBest("java", "3/20");
  assert.equal(readBest("java"), "7/20", "a worse score does not overwrite");
  writeBest("java", "12/20");
  assert.equal(readBest("java"), "12/20");
});

test("finishing clears progress so the next round starts clean", () => {
  store.clear();
  const s = freshStore("java");
  s.answerMC(0, s.correctSlot(0));
  assert.ok(localStorage.getItem("csq-java"));
  s.clearProgress();
  assert.equal(localStorage.getItem("csq-java"), null);
});

test("the timer stamps each answered question", () => {
  store.clear();
  const s = freshStore("java");
  s.touchTimer();
  s.answerMC(0, s.correctSlot(0));
  assert.equal(typeof s.qTimes[0], "number");
  assert.ok(s.qTimes[0] >= 0);
});

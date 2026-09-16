/**
 * The two things this suite protects:
 *
 *  1. How much a typo costs depends on the question. Exact answers (syntax,
 *     output, literals) are marked character for character; conceptual answers
 *     accept a near miss and say what the exact answer was.
 *  2. The optional local model can only upgrade a rule-based fail on a
 *     conceptual question, is never asked about exact answers, and changes
 *     nothing at all when it cannot run.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { topics } from "../data/all.js";
import { aiReviewAllowed, editDistance, evaluate, gradeTextAnswer, normalizeText, typoAllowance, typoPolicy } from "../js/check.js";
import {
  AI_MODEL_ID,
  aiAvailable,
  aiSupport,
  buildJudgePrompt,
  judgeAnswer,
  parseVerdict,
  resetAIEngine,
  setAIEngineFactory,
  toPlainText,
} from "../js/ai/on-device.js";
import { QuizStore, readAIEnabled, writeAIEnabled } from "../js/store.js";

/* ---- a localStorage stand-in (Node has none) ---- */
const memory = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
    clear: () => memory.clear(),
  },
});

/* ------------------------- policy: strict vs accept ------------------------- */

test("the policy is derived from the shape of the accepted answer", () => {
  // Exact things you type: literals, code, single tokens, flags.
  assert.equal(typoPolicy({ values: ["None"] }), "strict");
  assert.equal(typoPolicy({ values: ["KeyError"] }), "strict");
  assert.equal(typoPolicy({ values: ["[1, 2, 3]"] }), "strict");
  assert.equal(typoPolicy({ values: ["'mission.txt'"] }), "strict");
  assert.equal(typoPolicy({ values: ["git add"], typo: "strict" }), "strict");
  // Ideas, in words.
  assert.equal(typoPolicy({ values: ["Wireless Fidelity", "wireless fidelity"] }), "accept");
  assert.equal(typoPolicy({ values: ["linked list"] }), "accept");
  // A question can force either way, in either direction.
  assert.equal(typoPolicy({ values: ["Linked list"], typo: "accept" }), "accept");
  assert.equal(typoPolicy({ values: ["progress"], typo: "accept" }), "accept");
  assert.equal(typoPolicy({ values: ["Product Owner", "PO"], typo: "strict" }), "strict");
});

test("a near miss on a conceptual question passes, and says what was expected", () => {
  const result = evaluate({ values: ["linked list"] }, "linked lis");
  assert.equal(result.ok, true, "the idea is right, so it counts");
  assert.equal(result.soft, true);
  assert.match(result.hint, /linked list/);
  assert.match(result.hint, /Accepted/);
});

test("a near miss on an exact answer is wrong, and says why", () => {
  const result = evaluate({ values: ["KeyError"] }, "KeyEror");
  assert.equal(result.ok, false);
  assert.match(result.hint, /character for character/i);
  assert.match(result.hint, /KeyError/);
  // Short exact answers get no typo hint at all (too short to guess safely),
  // but they are still wrong.
  const none = evaluate({ values: ["None"] }, "none");
  assert.equal(none.ok, false);
  assert.match(none.hint, /Capitalization/);
  // The structured cases that used to slip through.
  assert.equal(evaluate({ values: ["[1, 2, 3]", "[1,2,3]"] }, "[1, 2, 4]").ok, false);
  assert.equal(evaluate({ values: ["hihihi"] }, "hihih").ok, false);
});

test("capitalization is enforced whatever the typo policy is", () => {
  const conceptual = { values: ["HyperText Markup Language"] };
  assert.equal(typoPolicy(conceptual), "accept");
  const lower = evaluate(conceptual, "hypertext markup language");
  assert.equal(lower.ok, false, "case is not a typo to forgive");
  assert.match(lower.hint, /Capitalization/);
  assert.equal(evaluate(conceptual, "hypertext mark-up language").ok, false, "and neither is a rewrite");
});

test("a question can opt out of leniency entirely", () => {
  assert.equal(evaluate({ values: ["git add"], typo: "strict" }, "git ad").ok, false);
  assert.equal(evaluate({ values: ["Progress"], typo: "accept" }, "Progres").ok, true);
});

test("real data: every written answer follows its policy, near miss or not", () => {
  let concept = 0;
  let exact = 0;
  for (const topic of Object.values(topics)) {
    for (const q of topic.text || []) {
      if (!q.check || Array.isArray(q.blanks) || q.kind === "code") continue;
      const values = q.check.values;
      if (!values || !values[0]) continue;
      const target = values[0];
      const slip = target.slice(0, -1);
      if (slip === target || values.includes(slip)) continue;
      const inTolerance = editDistance(normalizeText(target), normalizeText(slip)) <= typoAllowance(normalizeText(target));
      const verdict = evaluate(q.check, slip);
      const where = topic.title + ": \"" + target + "\"; ";
      if (typoPolicy(q.check) === "accept") {
        concept += 1;
        if (inTolerance) {
          assert.equal(verdict.ok, true, where + "a near miss should count");
          assert.equal(verdict.soft, true, where + "and should be explained as accepted");
        } else {
          assert.equal(verdict.ok, false, where + "a miss beyond the tolerance is still wrong");
        }
        assert.equal(evaluate(q.check, "qwertyuiopzx").ok, false, where + "nonsense must never pass");
      } else {
        exact += 1;
        assert.equal(verdict.ok, false, where + "an exact answer must reject a one-character slip");
      }
    }
  }
  assert.ok(concept >= 20, "conceptual questions were exercised (" + concept + ")");
  assert.ok(exact >= 40, "exact questions were exercised (" + exact + ")");
});

test("every question in the app lands on a deliberate policy", () => {
  let exact = 0;
  let concept = 0;
  for (const topic of Object.values(topics)) {
    for (const q of topic.text || []) {
      if (Array.isArray(q.blanks) && q.blanks.length > 0) {
        for (const blank of q.blanks) {
          assert.ok(["strict", "accept"].includes(typoPolicy(blank)), "bad blank policy in " + topic.title);
          exact += 1;
        }
        continue;
      }
      if (!q.check || q.check.type === "number" || q.check.type === "regex") continue;
      const policy = typoPolicy(q.check);
      assert.ok(["strict", "accept"].includes(policy), "bad policy in " + topic.title);
      if (policy === "strict") exact += 1;
      else concept += 1;
    }
  }
  assert.ok(exact > 60, "most written answers are exact (" + exact + ")");
  assert.ok(concept >= 20, "conceptual answers are a real category (" + concept + ")");
});

/* ------------------------ what the local AI may touch ------------------------ */

test("the local model is only offered for conceptual answers", () => {
  assert.equal(aiReviewAllowed({ q: "Wi-Fi stands for what?", check: { values: ["Wireless Fidelity"] } }), true);
  assert.equal(aiReviewAllowed({ q: "What does None print as?", check: { values: ["None"] } }), false);
  assert.equal(aiReviewAllowed({ q: "How many bits?", check: { type: "number", value: 48 } }), false);
  assert.equal(aiReviewAllowed({ q: "Fill it in", blanks: [{ values: ["7"] }] }), false);
  assert.equal(aiReviewAllowed({ q: "Pop an empty stack?", check: { type: "keywords", any: ["exception"] } }), true);
  assert.equal(aiReviewAllowed(null), false);
});

/* ------------------------------- the AI module ------------------------------- */

test("the prompt asks for a verdict, not an essay", () => {
  const messages = buildJudgePrompt({ question: "What is <code>2**3</code>?", expected: "8", given: "eight" });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /JSON/);
  assert.match(messages[1].content, /Expected answer: 8/);
  assert.match(messages[1].content, /Student answer: eight/);
  assert.ok(!messages[1].content.includes("<code>"), "the model gets prose, not markup");
  assert.equal(toPlainText("<b>a</b>&nbsp;b"), "a b");
});

test("the verdict reader copes with the shapes models actually emit", () => {
  assert.deepEqual(parseVerdict('{"equivalent": true, "reason": "Same idea."}'), { equivalent: true, reason: "Same idea." });
  assert.equal(parseVerdict('Sure!\n```json\n{"equivalent": false, "reason": "No."}\n```').equivalent, false);
  assert.equal(parseVerdict("Yes, that is equivalent.").equivalent, true);
  assert.equal(parseVerdict("No, not equivalent: two different structures.").equivalent, false);
  assert.throws(() => parseVerdict(""), /nothing/);
  assert.throws(() => parseVerdict("hmm"), /verdict/);
});

test("judgeAnswer drives the prompt and the parser, with an injected engine", async () => {
  const seen = [];
  const engine = {
    chat: async (messages) => {
      seen.push(messages);
      return '{"equivalent": true, "reason": "Both describe a doubly linked list."}';
    },
  };
  const verdict = await judgeAnswer({ question: "Which structure?", expected: "linked list", given: "a list where each node points both ways", engine });
  assert.equal(verdict.equivalent, true);
  assert.match(verdict.reason, /doubly linked list/);
  assert.equal(seen.length, 1);
});

test("a stub engine counts as available; without one, WebGPU decides", async () => {
  resetAIEngine();
  const support = aiSupport();
  assert.equal(aiAvailable(), support.ok, "in Node there is no WebGPU, so the real path is unavailable");
  setAIEngineFactory(async () => ({ chat: async () => '{"equivalent": true, "reason": "stub"}' }));
  assert.equal(aiAvailable(), true);
  const verdict = await judgeAnswer({ question: "q", expected: "e", given: "g" });
  assert.equal(verdict.equivalent, true, "the injected factory is used");
  resetAIEngine();
  assert.equal(aiAvailable(), support.ok);
  assert.match(AI_MODEL_ID, /-MLC$/, "the model id is a pinned MLC build");
});

test("a model that cannot load does not become an exception in the UI", async () => {
  resetAIEngine();
  if (!aiSupport().ok) {
    await assert.rejects(() => judgeAnswer({ question: "q", expected: "e", given: "g" }), /WebGPU/);
  }
});

/* --------------------------- the store's AI review --------------------------- */

const fakeEngine = (reply) => ({
  chat: async () => reply,
});

function pinnedStore(topicId, questionIndex) {
  const s = new QuizStore(topics);
  s.start(topicId, 0);
  s.round = [{ kind: "text", idx: questionIndex }];
  s.answers = [null];
  s.revealed = [false];
  s.marks = [null];
  s.blanks = [null];
  s.hints = [""];
  s.traps = [""];
  s.codeMsg = [""];
  s.aiNotes = [""];
  s.aiState = ["idle"];
  s.qTimes = [null];
  return s;
}

const conceptualIndex = (topicId) =>
  topics[topicId].text.findIndex((q) => aiReviewAllowed(q) && q.check && Array.isArray(q.check.values));
const exactIndex = (topicId) =>
  topics[topicId].text.findIndex((q) => !aiReviewAllowed(q) && q.check && Array.isArray(q.check.values));

test("the local model can turn a rule-based miss into a pass", async () => {
  memory.clear();
  const s = pinnedStore("net", conceptualIndex("net"));
  const question = s.itemAt(0);
  s.answerText(0, "W" + String(question.check.values[0]).slice(1)); // one letter off
  assert.equal(s.marks[0], true, "this exercise starts from a pass (near miss accepted)");

  // Now a genuinely wrong conceptual answer: correct the rules first.
  const wrong = "something else entirely";
  s.aiNotes = [""];
  s.marks[0] = false;
  s.answers[0] = wrong;
  const result = await s.reviewWithAI(0, { engine: fakeEngine('{"equivalent": false, "reason": "Not the same idea."}') });
  assert.equal(result.status, "done");
  assert.equal(result.equivalent, false);
  assert.equal(s.marks[0], false, "a no verdict leaves the mark alone");
  assert.match(s.aiNotes[0], /Not the same idea/);

  const upgrade = await s.reviewWithAI(0, { engine: fakeEngine('{"equivalent": true, "reason": "Same idea, phrasing differs."}') });
  assert.equal(upgrade.status, "done");
  assert.equal(upgrade.equivalent, true);
  assert.equal(s.marks[0], true, "the model can upgrade it");
  assert.match(s.aiNotes[0], /Same idea/);
});

test("the local model is never asked about exact answers, and cannot downgrade", async () => {
  memory.clear();
  const exact = pinnedStore("python", exactIndex("python"));
  exact.answerText(0, "definitely wrong");
  assert.equal(exact.marks[0], false);
  const refused = await exact.reviewWithAI(0, { engine: fakeEngine('{"equivalent": true, "reason": "looks fine"}') });
  assert.equal(refused.status, "not-allowed");
  assert.equal(exact.marks[0], false, "the exact answer stays wrong");
  assert.match(refused.message, /exact|final/i);

  const conceptual = pinnedStore("net", conceptualIndex("net"));
  conceptual.answerText(0, "wrong");
  conceptual.marks[0] = true; // a pass the student earned
  const kept = await conceptual.reviewWithAI(0, { engine: fakeEngine('{"equivalent": false, "reason": "nope"}') });
  assert.equal(kept.status, "already-correct");
  assert.equal(conceptual.marks[0], true, "a pass is never taken away");
});

test("a broken or unsupported model leaves the mark untouched and says so", async () => {
  memory.clear();
  const s = pinnedStore("net", conceptualIndex("net"));
  s.answerText(0, "wrong");
  s.marks[0] = false;

  const broken = await s.reviewWithAI(0, {
    engine: {
      chat: async () => {
        throw new Error("model exploded");
      },
    },
  });
  assert.equal(broken.status, "error");
  assert.equal(s.marks[0], false);
  assert.equal(s.aiState[0], "error");
  assert.match(s.aiNotes[0], /model exploded/);

  // And with no engine at all in Node: the WebGPU explanation, not a crash.
  s.aiState[0] = "idle";
  resetAIEngine();
  const unsupported = await s.reviewWithAI(0, {});
  assert.equal(unsupported.status, "unsupported");
  assert.equal(s.marks[0], false);
  assert.match(s.aiNotes[0], /WebGPU/);
});

test("an AI pass is explained in the review and survives a reload", async () => {
  memory.clear();
  const s = pinnedStore("net", conceptualIndex("net"));
  s.answerText(0, "a list that goes both ways");
  s.marks[0] = false;
  await s.reviewWithAI(0, { engine: fakeEngine('{"equivalent": true, "reason": "Describes a doubly linked list."}') });
  assert.equal(s.marks[0], true);
  s.saveProgress();

  const reloaded = new QuizStore(topics);
  reloaded.start("net", 0);
  assert.equal(reloaded.marks[0], true, "the upgraded mark is persisted");
  assert.match(reloaded.aiNotes[0], /doubly linked list/);
});

test("the AI setting is opt-in, remembered, and off by default", () => {
  memory.clear();
  assert.equal(readAIEnabled(), false);
  writeAIEnabled(true);
  assert.equal(readAIEnabled(), true);
  writeAIEnabled(false);
  assert.equal(readAIEnabled(), false);
});

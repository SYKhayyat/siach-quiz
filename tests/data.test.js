import test from "node:test";
import assert from "node:assert/strict";

import { topics } from "../data/all.js";
import { ROUND_SIZE } from "../js/store.js";
import { engineLangs } from "../js/engines/index.js";
import { aiReviewAllowed, evaluate, gradeTextAnswer, typoPolicy } from "../js/check.js";
import { correctAnswer, wrongAnswer } from "./helpers/fixtures.mjs";

const ids = Object.keys(topics);

test("there are topics, each with a title and description", () => {
  assert.ok(ids.length >= 5, "expected several topics");
  for (const id of ids) {
    assert.equal(typeof topics[id].title, "string", id + " title");
    assert.ok(topics[id].title.length > 0, id + " title not empty");
    assert.equal(typeof topics[id].desc, "string", id + " desc");
  }
});

test("every topic can fill a 20-question round", () => {
  for (const id of ids) {
    const topic = topics[id];
    assert.ok(topic.questions.length >= ROUND_SIZE, id + " needs >= 20 multiple choice");
    assert.ok((topic.text || []).length >= ROUND_SIZE, id + " needs >= 20 written items");
  }
});

test("multiple-choice questions are well formed", () => {
  for (const id of ids) {
    const seen = new Set();
    topics[id].questions.forEach((q, i) => {
      const where = `${id} mc[${i}]`;
      assert.ok(!seen.has(q.q), where + " duplicate prompt");
      seen.add(q.q);
      assert.equal(q.choices.length, 4, where + " four choices");
      q.choices.forEach((c) => assert.equal(typeof c, "string", where + " choice is a string"));
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4, where + " answer index");
      if (q.notes) assert.equal(q.notes.length, 4, where + " one note per choice");
      assert.ok(q.why && q.why.length > 0, where + " needs a why");
    });
  }
});

test("written and coding questions are well formed", () => {
  for (const id of ids) {
    const seen = new Set();
    (topics[id].text || []).forEach((q, i) => {
      const where = `${id} text[${i}]`;
      assert.ok(!seen.has(q.q), where + " duplicate prompt");
      seen.add(q.q);
      assert.ok(q.kind === "text" || q.kind === "code", where + " kind is text or code");
      assert.ok(q.q && q.q.length > 0, where + " needs a prompt");
      assert.ok(q.why && q.why.length > 0, where + " needs a why");

      if (q.kind === "code") {
        assert.ok(engineLangs().includes(q.lang), where + " lang " + q.lang + " has an engine");
        assert.ok(q.starter && q.starter.trim().length > 0, where + " needs a starter");
        assert.ok(q.tests && q.tests.trim().length > 0, where + " needs tests");
        assert.ok(q.answer && q.answer.length > 0, where + " needs a reference approach");
      } else {
        const hasCheck = q.check && typeof q.check === "object";
        const hasBlanks = Array.isArray(q.blanks) && q.blanks.length > 0;
        assert.ok(hasCheck || hasBlanks, where + " needs check or blanks");
        assert.ok(q.answer && q.answer.length > 0, where + " needs an answer to show");
        if (hasCheck) assert.ok(validateSpec(q.check, where), where + " valid check spec");
        if (hasBlanks) {
          q.blanks.forEach((b, bi) => {
            assert.ok(Array.isArray(b.values) && b.values.length > 0, `${where} blank ${bi} values`);
            b.values.forEach((v) => assert.equal(typeof v, "string", `${where} blank ${bi} value is a string`));
          });
        }
      }

      if (q.traps) {
        q.traps.forEach((t, ti) => {
          assert.ok(t.match, `${where} trap ${ti} has a match`);
          assert.ok(t.note && t.note.length > 0, `${where} trap ${ti} has a note`);
          assert.ok(validateSpec(t.match, `${where} trap ${ti}`), `${where} trap ${ti} valid spec`);
        });
      }
    });
  }
});

function validateSpec(spec, where) {
  if (spec.type === "number") return Number.isFinite(spec.value);
  if (spec.type === "regex") {
    try {
      new RegExp(spec.pattern);
      return true;
    } catch {
      assert.fail(where + " regex does not compile");
    }
  }
  if (spec.type === "keywords") {
    return (Array.isArray(spec.any) && spec.any.length > 0) || (Array.isArray(spec.all) && spec.all.length > 0);
  }
  if (spec.type && spec.type !== "values") return false;
  return Array.isArray(spec.values) && spec.values.length > 0 && spec.values.every((v) => typeof v === "string" && v.length > 0);
}

test("every coding question really has a runner, and codes are labelled", () => {
  for (const id of ids) {
    for (const q of topics[id].text || []) {
      if (q.kind !== "code") continue;
      assert.ok(engineLangs().includes(q.lang), `${id}: ${q.lang} must be registered`);
      assert.equal(q.lang === undefined, false, `${id}: code question must declare its language`);
    }
  }
});

/**
 * The leniency added for conceptual answers must never make a "trap" answer
 * correct. A trap is the wrong answer a real student reaches for; if the grader
 * now accepts it, the question is teaching the wrong thing.
 */
test("no trap answer is accepted by the grader", () => {
  const collisions = [];
  for (const id of ids) {
    for (const q of topics[id].text || []) {
      if (!q.check) continue;
      for (const trap of q.traps || []) {
        const match = trap.match || {};
        const candidates = Array.isArray(match.values)
          ? match.values
          : typeof match.value === "number"
            ? [String(match.value)]
            : [];
        for (const candidate of candidates) {
          if (evaluate(q.check, candidate).ok) collisions.push(`${id}: "${candidate}" for "${q.q.slice(0, 40)}"`);
        }
      }
    }
  }
  assert.deepEqual(collisions, [], "these traps now grade as correct");
});

test("every written question declares how strictly it is marked", () => {
  for (const id of ids) {
    for (const q of topics[id].text || []) {
      if (q.kind === "code") continue;
      const specs = Array.isArray(q.blanks) && q.blanks.length > 0 ? q.blanks : q.check ? [q.check] : [];
      for (const spec of specs) {
        const policy = typoPolicy(spec);
        assert.ok(policy === "strict" || policy === "accept", `${id}: ${q.q.slice(0, 40)} has an unknown policy`);
        if (spec.typo !== undefined) {
          assert.ok(
            spec.typo === "strict" || spec.typo === "accept" || spec.typo === false,
            `${id}: ${q.q.slice(0, 40)} has a bad typo setting`
          );
        }
      }
      // Answers that are typed into code, or are numbers, are never handed to
      // the local model: the rules are the last word on those.
      if (Array.isArray(q.blanks) && q.blanks.length > 0) {
        assert.equal(aiReviewAllowed(q), false, `${id}: a fill-in-the-blank must not go to the model`);
      }
      if (q.check && (q.check.type === "number" || q.check.type === "regex")) {
        assert.equal(aiReviewAllowed(q), false, `${id}: ${q.q.slice(0, 40)} is a number/regex answer`);
      }
    }
  }
});

/**
 * The suites drive rounds with generated answers, so the fixtures themselves are
 * part of the contract: the "correct" answer must be accepted for every question
 * and the "wrong" one must be rejected — under the current marking policy, which
 * is where a lenient-typo rule can quietly break this.
 */
test("the fixtures agree with the grader for every written question", () => {
  for (const id of ids) {
    for (const q of topics[id].text || []) {
      if (q.kind !== "text") continue;
      const where = `${id}: ${q.q.slice(0, 45)}`;
      const good = gradeTextAnswer(q, correctAnswer(q));
      assert.equal(good.pass, true, `${where} — the correct fixture was rejected`);
      const bad = gradeTextAnswer(q, wrongAnswer(q));
      assert.equal(bad.pass, false, `${where} — the wrong fixture (${JSON.stringify(wrongAnswer(q))}) was accepted`);
    }
  }
});

test("each language with code questions has at least two", () => {
  const counts = {};
  for (const id of ids) {
    for (const q of topics[id].text || []) {
      if (q.kind === "code") counts[q.lang] = (counts[q.lang] || 0) + 1;
    }
  }
  for (const lang of ["python", "java", "javascript", "rust"]) {
    assert.ok((counts[lang] || 0) >= 2, lang + " should have at least two coding questions");
  }
});

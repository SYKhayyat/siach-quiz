import test from "node:test";
import assert from "node:assert/strict";

import { gradeTextAnswer, evaluate, parseNumber, normalizeText, findTrap } from "../js/check.js";
import { normalizeTextCount, ROUND_SIZE } from "../js/store.js";

test("case is enforced by default (the 'none' vs 'None' complaint)", () => {
  const spec = { values: ["None"] };
  assert.equal(evaluate(spec, "None").ok, true);
  const lower = evaluate(spec, "none");
  assert.equal(lower.ok, false);
  assert.match(lower.hint, /Capitalization/);
});

test("case can be opted out of when it truly does not matter", () => {
  assert.equal(evaluate({ values: ["Wireless Fidelity"], caseSensitive: false }, "wireless fidelity").ok, true);
  assert.equal(evaluate({ values: ["ABC"] }, "abc").ok, false);
});

test("a typo is wrong, and says so", () => {
  const spec = { values: ["KeyError"] };
  const result = evaluate(spec, "KeeyError");
  assert.equal(result.ok, false);
  assert.match(result.hint, /typo/i);
  assert.match(result.hint, /KeyError/);
});

test("typo tolerance never forgives structured answers", () => {
  assert.equal(evaluate({ values: ["[1, 2, 3]", "[1,2,3]"] }, "[1, 2, 4]").ok, false);
  assert.equal(evaluate({ values: ["[2, 5, 8]"] }, "[2, 5, 9]").ok, false);
  assert.equal(evaluate({ values: ["hihihi"] }, "hihih").ok, false);
});

test("numbers accept units and filler words", () => {
  assert.equal(evaluate({ type: "number", value: 48 }, "48 bits").ok, true);
  assert.equal(evaluate({ type: "number", value: 3 }, "3 packets").ok, true);
  assert.equal(evaluate({ type: "number", value: 200, tolerance: 100 }, "~200 lines").ok, true);
  assert.equal(evaluate({ type: "number", value: 4 }, "the answer is 4").ok, true);
  assert.equal(evaluate({ type: "number", value: 1000 }, "1,000").ok, true);
  assert.equal(evaluate({ type: "number", value: 1.5 }, "1,5").ok, true);
  assert.equal(evaluate({ type: "number", value: 48 }, "0x30").ok, true);
  assert.equal(evaluate({ type: "number", value: 48 }, "64").ok, false);
  assert.equal(evaluate({ type: "number", value: 48 }, "no idea").hint, "No number found in that answer — write just the number.");
});

test("parseNumber understands spelled-out numbers too", () => {
  assert.equal(parseNumber("eleven"), 11);
  assert.equal(parseNumber("Eleven"), 11);
  assert.equal(parseNumber("twenty-one"), 21);
  assert.equal(parseNumber("one hundred and five"), 105);
  assert.equal(parseNumber("two thousand"), 2000);
  assert.equal(parseNumber("eleven packets"), 11);
  assert.equal(parseNumber("the answer is eleven"), 11);
  assert.equal(parseNumber("banana"), null);
  // A spelled number that we read is still accepted, and told why.
  const spelled = evaluate({ type: "number", value: 11 }, "eleven");
  assert.equal(spelled.ok, true);
  assert.equal(spelled.soft, true);
  assert.match(spelled.hint, /11/);
});

test("parseNumber handles the awkward spellings", () => {
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("48 bits"), 48);
  assert.equal(parseNumber("1,000"), 1000);
  assert.equal(parseNumber("1,5"), 1.5);
  assert.equal(parseNumber("0b1010"), 10);
  assert.equal(parseNumber("twelve"), 12);
});

test("keywords accept a real sentence, not just one magic word", () => {
  const spec = { type: "keywords", any: ["exception", "error"] };
  assert.equal(evaluate(spec, "it raises an exception").ok, true);
  assert.equal(evaluate(spec, "the stack underflows").ok, false);
  assert.equal(evaluate({ type: "keywords", any: ["break"] }, "breakfast").ok, false);
  assert.equal(evaluate({ type: "keywords", any: ["break"] }, "the break keyword").ok, true);
});

test("regex specs still work", () => {
  const spec = {
    type: "regex",
    pattern: "^(192\\.168\\.\\d{1,3}\\.\\d{1,3}|10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})$",
  };
  assert.equal(evaluate(spec, "192.168.1.1").ok, true);
  assert.equal(evaluate(spec, "8.8.8.8").ok, false);
});

test("traps are matched loosely so lowercase wrong answers still get explained", () => {
  const question = {
    check: { values: ["KeyError"] },
    traps: [{ match: { values: ["None", "null"] }, note: "It raises — it never returns None." }],
    why: "",
  };
  assert.match(findTrap(question, "none"), /never returns None/);
  const graded = gradeTextAnswer(question, "none");
  assert.equal(graded.pass, false);
});

test("blanks report per-blank marks and a hint", () => {
  const question = {
    blanks: [
      { label: "filename", values: ["'mission.txt'"], answer: "'mission.txt'" },
      { label: "mode", values: ["'w'"], answer: "'w'" },
    ],
    why: "",
  };
  const good = gradeTextAnswer(question, ["'mission.txt'", "'w'"]);
  assert.equal(good.pass, true);
  assert.deepEqual(good.marks, [true, true]);

  const second = gradeTextAnswer(question, ["'mission.txt'", "'r'"]);
  assert.equal(second.pass, false);
  assert.deepEqual(second.marks, [true, false]);
  assert.equal(second.hints[1], "");
});

test("normalizeText collapses whitespace and smart quotes", () => {
  assert.equal(normalizeText("  a\u2019b   c  ", false), "a'b c");
});

test("text-count input clamps to 0..20 and to the topic's pool", () => {
  assert.equal(normalizeTextCount(-5, 26), 0);
  assert.equal(normalizeTextCount("25", 26), ROUND_SIZE);
  assert.equal(normalizeTextCount("12", 26), 12);
  assert.equal(normalizeTextCount("abc", 26), 0);
  assert.equal(normalizeTextCount("", 26), 0);
  assert.equal(normalizeTextCount("9", 7), 7);
  assert.equal(normalizeTextCount("3.9", 26), 3);
  assert.equal(normalizeTextCount(20, 26), 20);
});

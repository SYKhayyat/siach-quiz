import test from "node:test";
import assert from "node:assert/strict";

import { runCodeTests, engineLangs, hasEngine } from "../js/engines/index.js";
import { buildPythonScript, parsePythonResult, indentBlock, pyLiteral, PYODIDE_INDEX } from "../js/engines/python-script.js";
import { topics } from "../data/all.js";
import { solutionFor } from "./helpers/fixtures.mjs";

const jsCodeQuestions = Object.values(topics)
  .flatMap((t) => t.text || [])
  .filter((q) => q.kind === "code" && (q.lang || "javascript") === "javascript");

test("the three languages have engines registered", () => {
  assert.deepEqual(engineLangs(), ["java", "javascript", "python"]);
  assert.ok(hasEngine("python"));
  assert.ok(hasEngine("java"));
});

test("an unknown language fails as 'unavailable', not as a wrong answer", async () => {
  const result = await runCodeTests({ lang: "cobol", code: "", tests: "" });
  assert.equal(result.pass, false);
  assert.equal(result.unavailable, true);
});

test("every JavaScript coding question passes with a reference solution", async () => {
  assert.ok(jsCodeQuestions.length >= 4, "expected JS coding questions");
  for (const question of jsCodeQuestions) {
    const solution = solutionFor(question);
    assert.ok(solution, "missing reference solution for: " + question.q.slice(0, 60));
    const result = await runCodeTests({ lang: "javascript", code: solution, tests: question.tests });
    assert.equal(result.pass, true, question.q.slice(0, 60) + " -> " + result.message);
  }
});

test("every JavaScript coding question fails with its own starter", async () => {
  for (const question of jsCodeQuestions) {
    const result = await runCodeTests({ lang: "javascript", code: question.starter, tests: question.tests });
    assert.equal(result.pass, false, "starter should not pass: " + question.q.slice(0, 60));
    assert.ok(result.message.length > 0, "a failure needs a message");
  }
});

test("a thrown error in JavaScript is reported as a message", async () => {
  const result = await runCodeTests({
    lang: "javascript",
    code: "function boom() { throw new Error('kaboom'); }",
    tests: "assert(boom() === 1, 'never');",
  });
  assert.equal(result.pass, false);
  assert.match(result.message, /kaboom/);
});

test("python script assembly puts the tests in a function with the prelude first", () => {
  const script = buildPythonScript({ code: "def f():\n    return 1", tests: "assert f() == 1, 'f'", prelude: "BASE = 1" });
  const baseAt = script.indexOf("BASE = 1");
  const codeAt = script.indexOf("your solution");
  const testsAt = script.indexOf("def _run_tests():");
  assert.ok(baseAt >= 0 && codeAt > baseAt && testsAt > codeAt, "order should be prelude, code, tests");
  assert.match(script, /\n        assert f\(\) == 1/);
  assert.match(script, /_result = 'PASS'/);
  assert.ok(script.includes("exec(compile(") , "the student's code must be exec'd inside the try");
  assert.match(script, /except SyntaxError/);
});

test("an empty test body still produces valid Python", () => {
  const script = buildPythonScript({ code: "x = 1", tests: "" });
  assert.match(script, /def _run_tests\(\):\n        pass/);
});

test("quotes and newlines in an answer survive the round trip", () => {
  const tricky = ['def f():', '    return \'a "b" c\''].join("\n");
  const script = buildPythonScript({ code: tricky, tests: "assert f()" });
  assert.ok(script.includes(pyLiteral(tricky)));
});

test("python results map to verdicts", () => {
  assert.deepEqual(parsePythonResult("PASS", ""), { pass: true, message: "" });
  const failed = parsePythonResult("FAIL: expected 3", "");
  assert.equal(failed.pass, false);
  assert.equal(failed.message, "expected 3");
  const errored = parsePythonResult("ERROR: ZeroDivisionError: division by zero", "");
  assert.equal(errored.pass, false);
  assert.match(errored.message, /Python error: ZeroDivisionError/);
});

test("captured stdout is shown alongside a failure", () => {
  const result = parsePythonResult("FAIL: nope", "debug line");
  assert.match(result.message, /debug line/);
  assert.match(result.message, /nope/);
});

test("indentBlock indents code and leaves blank lines alone", () => {
  assert.equal(indentBlock("a\n\nb", 2), "  a\n\n  b");
});

test("the python CDN path is pinned", () => {
  assert.match(PYODIDE_INDEX, /^https:\/\/cdn\.jsdelivr\.net\/pyodide\/v[\d.]+\/full\/$/);
});

/**
 * Real Python execution, using the same script assembly the browser worker
 * uses (js/engines/python-script.js). Pyodide runs in Node, so CI checks the
 * Python grading path for real rather than trusting it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { loadPyodide } from "pyodide";

import { topics } from "../data/all.js";
import { buildPythonScript, parsePythonResult } from "../js/engines/python-script.js";
import { solutionFor } from "./helpers/fixtures.mjs";

const pythonQuestions = (topics.python.text || []).filter((q) => q.kind === "code" && q.lang === "python");

let pyodidePromise = null;
function getPyodide() {
  if (!pyodidePromise) pyodidePromise = loadPyodide();
  return pyodidePromise;
}

async function gradePython(question, code) {
  const pyodide = await getPyodide();
  let printed = "";
  pyodide.setStdout({ batched: (line) => { printed += line + "\n"; } });
  pyodide.setStderr({ batched: (line) => { printed += line + "\n"; } });
  const script = buildPythonScript({ code, tests: question.tests, prelude: question.prelude });
  const raw = await pyodide.runPythonAsync(script);
  return parsePythonResult(raw, printed);
}

test("the Python topic has coding questions", () => {
  assert.ok(pythonQuestions.length >= 3, "expected several Python coding questions");
});

test("every Python coding question passes with a reference solution", async () => {
  for (const question of pythonQuestions) {
    const solution = solutionFor(question);
    assert.ok(solution, "missing reference solution for: " + question.q.slice(0, 60));
    const verdict = await gradePython(question, solution);
    assert.equal(verdict.pass, true, question.q.slice(0, 60) + " -> " + verdict.message);
  }
});

test("every Python coding question fails with its own starter", async () => {
  for (const question of pythonQuestions) {
    const verdict = await gradePython(question, question.starter);
    assert.equal(verdict.pass, false, "starter should not pass: " + question.q.slice(0, 60));
    assert.ok(verdict.message.length > 0);
  }
});

test("the assertion message reaches the student", async () => {
  const question = pythonQuestions.find((q) => q.q.includes("Write middle(s)"));
  const verdict = await gradePython(question, "def middle(s):\n    return s[1:]");
  assert.equal(verdict.pass, false);
  assert.match(verdict.message, /ell/);
});

test("a syntax error is reported as a Python error, not a crash", async () => {
  const question = pythonQuestions[0];
  const verdict = await gradePython(question, "def broken(:\n    pass");
  assert.equal(verdict.pass, false);
  assert.match(verdict.message, /Python error/);
});

test("printed output is captured and shown when a test fails", async () => {
  const question = pythonQuestions.find((q) => q.q.includes("Write middle(s)"));
  const verdict = await gradePython(question, "def middle(s):\n    print('debug: got', s)\n    return 'wrong'");
  assert.equal(verdict.pass, false);
  assert.match(verdict.message, /debug: got/);
});

test("a prelude is available to the student's code", async () => {
  const verdict = await gradePython(
    {
      tests: "assert kick() == 'meow', 'kick'",
      prelude: "class Animal:\n    def speak(self):\n        return '...'",
    },
    "class Cat(Animal):\n    def speak(self):\n        return 'meow'\n\ndef kick():\n    return Cat().speak()"
  );
  assert.equal(verdict.pass, true, verdict.message);
});

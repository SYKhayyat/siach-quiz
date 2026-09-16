/**
 * Java answers are compiled and run by javac inside CheerpJ's WebAssembly JVM
 * in the browser. CheerpJ cannot boot in Node, but the part that decides
 * pass/fail is the generated harness — and that part is exercised here with a
 * real JDK, so the questions and the assertions are verified even though the
 * in-browser JVM itself is not.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { topics } from "../data/all.js";
import { buildJavaHarness, parseJavaOutput, CHEERPJ_LOADER_URL, JAVA_TOOLS_JAR, PASS_MARK, FAIL_MARK } from "../js/engines/java-harness.js";
import { solutionFor } from "./helpers/fixtures.mjs";
import { ROOT } from "./helpers/dom.mjs";

const javaQuestions = (topics.java.text || []).filter((q) => q.kind === "code" && q.lang === "java");
const hasJavac = spawnSync("javac", ["-version"], { encoding: "utf8" }).status === 0;

function compileAndRun(solution, tests) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "csq-java-"));
  try {
    writeFileSync(path.join(dir, "Solution.java"), solution);
    writeFileSync(path.join(dir, "SolutionTest.java"), buildJavaHarness(tests));
    const compile = spawnSync("javac", ["-d", dir, "Solution.java", "SolutionTest.java"], { cwd: dir, encoding: "utf8" });
    if (compile.status !== 0) return { compileError: (compile.stderr || compile.stdout || "").trim() };
    const run = spawnSync("java", ["-cp", dir, "SolutionTest"], { encoding: "utf8" });
    return { output: (run.stdout || "") + (run.stderr || "") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the harness declares a test class with the assertion helpers", () => {
  const harness = buildJavaHarness("assertTrue(true, \"ok\");");
  assert.match(harness, /import java\.util\.\*;/);
  assert.match(harness, /public class SolutionTest \{/);
  assert.match(harness, /static void assertTrue\(/);
  assert.match(harness, /static void assertEquals\(Object a, Object b, String msg\)/);
  assert.match(harness, new RegExp(PASS_MARK));
  assert.match(harness, new RegExp(FAIL_MARK));
  assert.match(harness, /\n {6}assertTrue/);
});

test("java output maps to verdicts", () => {
  assert.equal(parseJavaOutput(PASS_MARK).pass, true);
  assert.equal(parseJavaOutput("noise\n" + PASS_MARK + "\nmore").pass, true);
  const failed = parseJavaOutput("noise\n" + FAIL_MARK + " expected 6, got 5");
  assert.equal(failed.pass, false);
  assert.match(failed.message, /expected 6, got 5/);
  assert.equal(parseJavaOutput("").pass, false);
});

test("the worker loads the same CheerpJ build as the harness module", () => {
  const worker = readFileSync(path.join(ROOT, "js", "engines", "cheerpj-worker.js"), "utf8");
  assert.ok(worker.includes(CHEERPJ_LOADER_URL), "cheerpj-worker.js must import " + CHEERPJ_LOADER_URL);
  assert.ok(worker.includes(JAVA_TOOLS_JAR.replace(/^vendor\//, "")) || worker.includes(JAVA_TOOLS_JAR), "tools.jar path in sync");
});

test("the Java topic has coding questions", () => {
  assert.ok(javaQuestions.length >= 3, "expected several Java coding questions");
});

test("every Java coding question passes with a reference solution", { skip: !hasJavac && "javac not installed" }, () => {
  for (const question of javaQuestions) {
    const solution = solutionFor(question);
    assert.ok(solution, "missing reference solution for: " + question.q.slice(0, 60));
    const result = compileAndRun(solution, question.tests);
    assert.ok(!result.compileError, question.q.slice(0, 60) + " failed to compile:\n" + result.compileError);
    const verdict = parseJavaOutput(result.output);
    assert.equal(verdict.pass, true, question.q.slice(0, 60) + " -> " + verdict.message);
  }
});

test("every Java coding question fails with its own starter", { skip: !hasJavac && "javac not installed" }, () => {
  for (const question of javaQuestions) {
    const result = compileAndRun(question.starter, question.tests);
    if (result.compileError) continue; // a starter that cannot compile is also "not passing"
    const verdict = parseJavaOutput(result.output);
    assert.equal(verdict.pass, false, "starter should not pass: " + question.q.slice(0, 60));
    assert.ok(verdict.message.length > 0);
  }
});

test("a compile error is surfaced, not swallowed", { skip: !hasJavac && "javac not installed" }, () => {
  const result = compileAndRun("class Solution { static int broken( { }", "assertTrue(true, \"unused\");");
  assert.ok(result.compileError && result.compileError.length > 0);
});

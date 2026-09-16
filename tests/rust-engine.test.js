/**
 * The Rust engine, in two halves.
 *
 * 1. The pure parts (harness assembly, verdict parsing, message tidying) run
 *    everywhere, always.
 * 2. The real thing: every Rust coding question is compiled by the actual public
 *    playground (play.rust-lang.org). That needs the network, so if the service
 *    cannot be reached the live half reports itself as skipped rather than
 *    failing — the same "unavailable is not the student's fault" rule the app
 *    follows.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { topics } from "../data/all.js";
import { runCodeTests } from "../js/engines/index.js";
import runRust from "../js/engines/rust.js";
import { PASS_MARK, PLAYGROUND_URL, buildRustHarness, parseRustResult, playgroundRequest, tidyRustMessage } from "../js/engines/rust-harness.js";
import { RUST_SOLUTIONS, solutionFor } from "./helpers/fixtures.mjs";

const rustQuestions = Object.values(topics)
  .flatMap((t) => t.text || [])
  .filter((q) => q.kind === "code" && q.lang === "rust");

/* ------------------------------- pure parts ------------------------------- */

test("the playground URL and the request body are pinned", () => {
  assert.equal(PLAYGROUND_URL, "https://play.rust-lang.org/execute");
  const body = playgroundRequest("fn main() {}");
  assert.equal(body.channel, "stable");
  assert.equal(body.mode, "debug");
  assert.equal(body.edition, "2021");
  assert.equal(body.crateType, "bin");
  assert.equal(body.code, "fn main() {}");
});

test("the harness keeps the student's code and adds a main with the tests", () => {
  const source = buildRustHarness("fn double(n: i32) -> i32 {\n    n * 2\n}", "assert_eq!(double(2), 4);");
  assert.match(source, /^fn double\(n: i32\) -> i32 \{/);
  assert.match(source, /fn main\(\) \{/);
  assert.match(source, /\n    assert_eq!\(double\(2\), 4\);/);
  assert.ok(source.trimEnd().endsWith("}"), "the function must be closed");
  assert.ok(source.includes(PASS_MARK), "the pass marker proves the tests finished");
});

test("empty tests still produce compilable Rust", () => {
  const source = buildRustHarness("fn f() {}", "");
  assert.match(source, /\/\/ no tests/);
  assert.match(source, /fn main\(\) \{/);
});

test("rustc's progress chatter is stripped, the panic is kept", () => {
  const messy = [
    "   Compiling playground v0.0.1 (/playground)",
    "    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.5s",
    "     Running `target/debug/playground`",
    "",
    "thread 'main' panicked at src/main.rs:3:5:",
    "assertion `left == right` failed: results keep their input order",
  ].join("\n");
  const message = tidyRustMessage(messy);
  assert.ok(!message.includes("Compiling"));
  assert.match(message, /panicked/);
  assert.match(message, /results keep their input order/);
});

test("verdicts follow success plus the pass marker", () => {
  assert.deepEqual(parseRustResult({ success: true, stdout: "text\n" + PASS_MARK + "\n" }), { pass: true, message: "" });
  const failed = parseRustResult({ success: false, stdout: "", stderr: "error[E0308]: mismatched types" });
  assert.equal(failed.pass, false);
  assert.match(failed.message, /E0308/);
  // Tests ran but a marker-less exit means the program bailed out early.
  const early = parseRustResult({ success: true, stdout: "nothing useful" });
  assert.equal(early.pass, false);
  assert.match(early.message, /nothing useful/);
});

test("a network or rate-limit failure is 'unavailable', never a wrong answer", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 429 });
    const limited = await runRust({ code: "fn f() {}", tests: "" });
    assert.equal(limited.pass, false);
    assert.equal(limited.unavailable, true);
    assert.match(limited.message, /429/);

    globalThis.fetch = async () => {
      throw new Error("dns is on fire");
    };
    const offline = await runRust({ code: "fn f() {}", tests: "" });
    assert.equal(offline.unavailable, true);
    assert.match(offline.message, /Could not reach/);
  } finally {
    globalThis.fetch = original;
  }
});

test("the engine is registered for the questions that need it", () => {
  assert.ok(rustQuestions.length >= 4, "expected Rust coding questions");
  for (const q of rustQuestions) {
    assert.ok(q.starter && q.tests, q.q.slice(0, 40) + " needs a starter and tests");
  }
});

/* ------------------------------- live playground ------------------------------- */

const liveCheck = await (async () => {
  try {
    const result = await runCodeTests({ lang: "rust", code: "fn probe() -> i32 { 1 }", tests: "assert_eq!(probe(), 1);" });
    return result.unavailable ? result.message : null;
  } catch (err) {
    return String((err && err.message) || err);
  }
})();

if (liveCheck) {
  test("Rust questions against the live playground", { skip: "playground unreachable: " + liveCheck.slice(0, 120) }, () => {});
} else {
  test("every Rust coding question passes with a reference solution", async () => {
    for (const question of rustQuestions) {
      const solution = solutionFor(question) || RUST_SOLUTIONS[Object.keys(RUST_SOLUTIONS).find((k) => question.q.includes(k))];
      assert.ok(solution, "missing reference solution for: " + question.q.slice(0, 60));
      const result = await runCodeTests({ lang: "rust", code: solution, tests: question.tests });
      assert.equal(result.pass, true, question.q.slice(0, 60) + " -> " + result.message);
    }
  });

  test("every Rust coding question fails with its own starter", async () => {
    for (const question of rustQuestions) {
      const result = await runCodeTests({ lang: "rust", code: question.starter, tests: question.tests });
      assert.equal(result.pass, false, "starter should not pass: " + question.q.slice(0, 60));
      assert.ok(result.message.length > 0, "a failure needs a message to show the student");
    }
  });

  test("a Rust compile error is reported as a message, not as a broken engine", async () => {
    const result = await runCodeTests({ lang: "rust", code: "fn broken( {", tests: "assert!(true);" });
    assert.equal(result.pass, false);
    assert.notEqual(result.unavailable, true, "a syntax error must not look like an outage");
    assert.match(result.message, /error/i);
  });
}

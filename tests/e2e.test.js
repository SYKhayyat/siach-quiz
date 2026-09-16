/**
 * End-to-end suite: the real app (index.html + js/main.js) driven through the
 * DOM, with the real store, real grader and real JavaScript code runner.
 *
 * Python and Java need a browser (WebAssembly + workers), so those two engines
 * are replaced with a stub through the public engine registry — everything
 * else about those answers (storage, marking, feedback, resume) is the real
 * code. The Python and Java question content is verified for real in
 * tests/python-engine.test.js and tests/java-harness.test.js.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { registerEngine } from "../js/engines/index.js";
import { startApp } from "../js/main.js";
import { answerSummary } from "../js/views/quiz-view.js";
import { aiReviewAllowed } from "../js/check.js";
import { resetAIEngine, setAIEngineFactory } from "../js/ai/on-device.js";
import { readAIEnabled } from "../js/store.js";
import { bootDom, teardownDom, click, type, press, grade, settle, $, $$ } from "./helpers/dom.mjs";
import { correctAnswer, wrongAnswer, solutionFor } from "./helpers/fixtures.mjs";

/* ---- a stub engine for the languages that need a browser ---- */
const STUB_PASS = "GOOD_STUB";
const STUB_FAIL = "BAD_STUB";
const STUB_BROKEN = "BROKEN_STUB";
function stubEngine() {
  return async ({ code }) => {
    if (code.includes(STUB_BROKEN)) return { pass: false, unavailable: true, message: "stub engine could not start" };
    if (code.includes(STUB_PASS)) return { pass: true, message: "" };
    return { pass: false, message: "stub: a test failed" };
  };
}
registerEngine("python", stubEngine());
registerEngine("java", stubEngine());
// Rust's real engine talks to the public playground; the suite runs offline.
// The real thing is verified in tests/rust-engine.test.js and the browser suite.
registerEngine("rust", stubEngine());
const STUBBED_LANGS = ["python", "java", "rust"];

/* ------------------------------ helpers ------------------------------ */

function boot() {
  const dom = bootDom();
  window.localStorage.clear();
  const app = startApp();
  return {
    dom,
    app,
    done: () => {
      // Stop the quiz timer before closing the window, even when a test failed
      // mid-round: a live interval would keep the whole test process alive.
      try {
        const home = document.querySelector("#homeBtn") || document.querySelector("#topicsBtn") || document.querySelector("#setupHomeBtn");
        if (home) home.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      } catch {
        /* the DOM may already be gone */
      }
      teardownDom(dom);
    },
  };
}

const openTopic = (id) => click($(`.card[data-t="${id}"]`));
const setMix = (n) => type($("#mixInput"), String(n));
const startFresh = () => click($("#startBtn"));
const goHome = () => click($("#homeBtn") || $("#setupHomeBtn") || $("#topicsBtn"));
const kindOf = (app, i) => (app.store.isMC(i) ? "mc" : app.store.isCode(i) ? "code" : "text");
const ctxOf = (app, i) => ({ i, kind: kindOf(app, i), question: app.store.itemAt(i) });

async function startRound(app, topic, mix) {
  goHome();
  openTopic(topic);
  setMix(mix);
  startFresh();
  assert.equal(app.store.size, 20, "a round is 20 questions");
  return app.store.size;
}

/** Re-roll the round until `predicate(app)` holds (bounded, so it cannot hang). */
async function until(app, topic, mix, predicate, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await startRound(app, topic, mix);
    if (predicate(app)) return;
  }
  assert.fail("gave up looking for " + label);
}

function fillCode(app, code) {
  type($("#ta"), code);
  assert.equal($("#ta").value, code, "the code box should hold the code");
}

/** The plan for "just answer it correctly / wrongly". */
function defaultPlan(ctx, mode) {
  const wantPass = mode === "correct";
  if (ctx.kind === "mc") {
    const correct = ctx.app.store.correctSlot(ctx.i);
    return { slot: wantPass ? correct : (correct + 1) % 4, expect: wantPass };
  }
  if (ctx.kind === "code") {
    const stubbed = STUBBED_LANGS.includes(ctx.question.lang);
    const fixture = solutionFor(ctx.question);
    if (stubbed) return { value: wantPass ? STUB_PASS : STUB_FAIL, expect: wantPass };
    if (wantPass && fixture) return { value: fixture, expect: true };
    return { value: ctx.question.starter, expect: false };
  }
  const value = wantPass ? correctAnswer(ctx.question) : wrongAnswer(ctx.question);
  return { value, expect: wantPass };
}

/** Answer the question on screen, submit it, and check the recorded verdict. */
async function answerOne(app, ctx, plan, via = "buttons") {
  if (ctx.kind === "mc" && plan.slot !== undefined) {
    if (via === "keyboard") press(String(plan.slot + 1));
    else click($$(".opt")[plan.slot]);
  } else if (Array.isArray(plan.value)) {
    const inputs = $$(".blank");
    assert.ok(inputs.length > 0, "blanks question should render inputs");
    inputs.forEach((input, bi) => type(input, plan.value[bi]));
  } else if (ctx.kind === "code") {
    fillCode(app, plan.value);
  } else {
    type($("#ta"), plan.value);
  }
  if (via === "keyboard") {
    press("Enter");
    await settle();
  } else {
    await grade();
  }
  assert.equal(app.store.revealed[ctx.i], true, `Q${ctx.i + 1} (${ctx.kind}) should have been graded`);
  assert.equal(
    app.store.marks[ctx.i],
    plan.expect,
    `Q${ctx.i + 1} (${ctx.kind}, ${ctx.question.tag}) expected ${plan.expect ? "pass" : "fail"}`
  );
}

async function advance(app, via = "buttons") {
  if (via === "keyboard") press("Enter");
  else click($("#advBtn"));
  await settle();
}

/** Play the whole round; `plan` may special-case individual questions. */
async function playRound(app, { mode = "correct", via = "buttons", limit = Infinity, plan, afterGrade } = {}) {
  let answered = 0;
  while (answered < limit && app.store.currentIndex() < app.store.size) {
    const i = app.store.view;
    if (app.store.revealed[i]) {
      await advance(app, via);
      continue;
    }
    const ctx = { ...ctxOf(app, i), app };
    const chosen = (plan && plan(ctx)) || defaultPlan(ctx, mode);
    await answerOne(app, ctx, chosen, via);
    if (afterGrade) afterGrade(ctx, chosen);
    answered += 1;
    // Always advance: on the last question this is what opens the results screen.
    await advance(app, via);
  }
  return answered;
}

/** Answer questions until `predicate(ctx)` matches, leaving that one on screen. */
async function walkTo(app, predicate, mode = "correct") {
  while (app.store.currentIndex() < app.store.size) {
    const ctx = { ...ctxOf(app, app.store.currentIndex()), app };
    if (predicate(ctx)) return ctx;
    await answerOne(app, ctx, defaultPlan(ctx, mode));
    await advance(app);
  }
  return null;
}

/* ------------------------------- flows ------------------------------- */

test("flow 1: all multiple choice, keyboard only, through to the results screen", async () => {
  const { app, done } = boot();
  try {
    await startRound(app, "java", 0);
    assert.equal(app.store.mix.text, 0, "no written questions");

    let answers = 0;
    while (app.store.currentIndex() < app.store.size) {
      const i = app.store.view;
      assert.equal(kindOf(app, i), "mc", "every question should be multiple choice");
      press(String(app.store.correctSlot(i) + 1)); // 1-4 selects a choice
      assert.ok($(".opt.sel"), "the keyboard selection should be visible");
      press("Enter");
      await settle();
      assert.equal(app.store.marks[i], true, "Q" + (i + 1) + " should be right");
      answers += 1;
      press("Enter"); // Enter again advances
      await settle();
    }
    assert.equal(answers, 20);

    assert.ok($(".result"), "results screen renders");
    assert.match($(".result .score").textContent, /^20\/20$/);
    assert.equal(window.localStorage.getItem("csq-best-java"), "20/20");
    assert.equal(window.localStorage.getItem("csq-java"), null, "progress is cleared at the end");

    click($("#replayBtn"));
    assert.ok($(".q"), "quiz is back");
    assert.equal(app.store.counts().done, 0, "a replay starts empty");
    assert.equal(app.store.size, 20);

    goHome();
    assert.ok($(".card[data-t='java']"), "home screen renders");
  } finally {
    done();
  }
});

test("flow 2: the written-count box clamps, and a fully written round can be answered", async () => {
  const { app, done } = boot();
  try {
    goHome();
    openTopic("python");

    type($("#mixInput"), "25");
    assert.equal($("#mixInput").value, "20", "more than 20 clamps to 20");
    assert.match($("#mixText").textContent, /20 written \+ 0 multiple choice/);

    type($("#mixInput"), "-7");
    assert.equal($("#mixInput").value, "0", "less than 0 clamps to 0");

    type($("#mixInput"), "9999");
    assert.equal($("#mixInput").value, "20");

    type($("#mixInput"), "7");
    assert.match($("#mixText").textContent, /7 written \+ 13 multiple choice/);

    click($("#allBtn"));
    assert.equal($("#mixInput").value, "20", "the quick button fills the box");
    startFresh();
    assert.equal(app.store.mix.text, 20);
    assert.equal(app.store.size, 20);

    const kinds = app.store.round.map((_, i) => kindOf(app, i));
    assert.ok(kinds.includes("text"), "a written round contains written questions");
    assert.ok($(".qtag").textContent.length > 0, "each question is labelled");

    await playRound(app, { mode: "wrong" });
    assert.ok($(".result"), "results render after a bad round");
    assert.match($(".result .score").textContent, /^0\/20$/);
    assert.match($(".result .sub").textContent, /Needs work/);
    assert.equal(window.localStorage.getItem("csq-best-python"), "0/20");
  } finally {
    done();
  }
});

test("flow 3: hints, traps and case-sensitive grading show up in the feedback", async () => {
  const { app, done } = boot();
  try {
    const TARGETS = ["upper()", "missing dict key", "counts the characters", "Fill both blanks"];
    await until(
      app,
      "python",
      20,
      (a) => {
        const prompts = a.store.round.map((_, i) => a.store.itemAt(i).q);
        return TARGETS.every((t) => prompts.some((p) => p.includes(t)));
      },
      "the four target questions"
    );

    const seen = new Set();
    let sawGreen = false;

    const plan = (ctx) => {
      const p = ctx.question.q;
      if (p.includes("upper()")) return { value: "abc", expect: false, tag: "case-trap" };
      if (p.includes("missing dict key")) return { value: "KeeyError", expect: false, tag: "typo" };
      if (p.includes("counts the characters")) return { value: "11 characters", expect: true, tag: "units" };
      if (p.includes("Fill both blanks")) {
        return { value: [ctx.question.blanks[0].values[0], "nonsense"], expect: false, tag: "blanks" };
      }
      return null;
    };

    await playRound(app, {
      mode: "correct",
      plan,
      afterGrade: (ctx, chosen) => {
        const feed = $(".feed");
        assert.ok(feed, "feedback must be visible for Q" + (ctx.i + 1));
        if (!chosen || !chosen.tag) return;
        seen.add(chosen.tag);
        if (chosen.tag === "case-trap") {
          assert.match(feed.textContent, /Case matters/, "the trap explains that case matters");
        }
        if (chosen.tag === "typo") {
          const hint = $(".feed .hintline");
          assert.ok(hint, "the typo hint is rendered");
          assert.match(hint.textContent, /typo/i);
          assert.match(hint.textContent, /KeyError/);
        }
        if (chosen.tag === "units") {
          assert.ok($(".feed.g"), "a number with a unit passes");
          sawGreen = true;
        }
        if (chosen.tag === "blanks") {
          assert.deepEqual(app.store.blanks[ctx.i], [true, false], "each blank is scored separately");
          const summary = answerSummary(app.store, ctx.i);
          assert.match(summary.you, /Blank 1: ✓/, "the first blank is marked correct");
          assert.match(summary.you, /Blank 2: ✕/, "the second blank is marked wrong");
        }
      },
    });

    assert.deepEqual([...seen].sort(), ["blanks", "case-trap", "typo", "units"]);
    assert.ok(sawGreen, "at least one green verdict");
  } finally {
    done();
  }
});

test("flow 4: coding answers really execute, and their verdicts are honest", async () => {
  const { app, done } = boot();
  try {
    // algo has four JavaScript coding questions and exactly 20 written items,
    // so a fully written round contains all of them.
    await startRound(app, "algo", 20);
    const codeIndexes = app.store.round.map((_, i) => i).filter((i) => kindOf(app, i) === "code");
    assert.equal(codeIndexes.length, 4, "all four coding questions are in the round");

    let labelSeen = false;
    await playRound(app, {
      mode: "correct",
      plan: (ctx) => {
        if (ctx.kind !== "code") return null;
        if (ctx.i === codeIndexes[0]) return { value: solutionFor(ctx.question), expect: true, tag: "pass" };
        if (ctx.i === codeIndexes[1]) return { value: ctx.question.starter, expect: false, tag: "fail" };
        if (ctx.i === codeIndexes[2]) return { value: "function ( {", expect: false, tag: "syntax" };
        return null;
      },
      afterGrade: (ctx, chosen) => {
        if (ctx.kind !== "code") return;
        assert.match($(".qtag").textContent, /Coding · JavaScript/);
        labelSeen = true;
        const feed = $(".feed").textContent;
        if (chosen.tag === "pass") assert.match(feed, /all tests passed/);
        if (chosen.tag === "fail") {
          assert.match(feed, /Expected approach/);
          assert.ok(app.store.codeMsg[ctx.i].length > 0, "a failing test explains itself");
        }
        if (chosen.tag === "syntax") {
          assert.equal(app.store.revealed[ctx.i], true, "a syntax error is still graded");
          assert.ok(app.store.codeMsg[ctx.i].length > 0, "and it says what went wrong");
        }
      },
    });
    assert.ok(labelSeen, "coding questions are labelled with their language");
    goHome();
  } finally {
    done();
  }
});

test("flow 5: the review screen, best score and keyboard guards", async () => {
  const { app, done } = boot();
  try {
    // An EXACT question with a longish answer: there a near miss is wrong, which
    // is what this flow checks. On a conceptual question the same slip is
    // accepted, so it is excluded on purpose.
    const exactLongAnswer = (a) =>
      a.store.round.some((_, i) => {
        const q = a.store.itemAt(i);
        return (
          !a.store.isMC(i) &&
          !a.store.isCode(i) &&
          Array.isArray(q.check?.values) &&
          q.check.values[0].length >= 8 &&
          !aiReviewAllowed(q)
        );
      });
    await until(app, "meth", 6, exactLongAnswer, "an exact question with a longish accepted answer");
    assert.equal(app.store.mix.text, 6);

    let typoIndex = -1;
    let wrongQuestions = 0;
    await playRound(app, {
      mode: "wrong",
      plan: (ctx) => {
        const values = ctx.question.check?.values;
        if (
          !ctx.app.store.isMC(ctx.i) &&
          !ctx.app.store.isCode(ctx.i) &&
          Array.isArray(values) &&
          values[0].length >= 8 &&
          !aiReviewAllowed(ctx.question) &&
          typoIndex < 0
        ) {
          typoIndex = ctx.i;
          return { value: values[0] + "x", expect: false };
        }
        return null;
      },
      afterGrade: () => {
        wrongQuestions += 1;
      },
    });

    // Results screen: score, review of every question, and the hints we stored.
    assert.ok($(".result"), "the results screen is up");
    assert.match($(".result .sub").textContent, /Needs work/);
    const items = $$(".rev-item");
    assert.equal(items.length, 20, "every question appears in the review");
    assert.equal(wrongQuestions, 20);
    assert.ok(typoIndex >= 0, "the typo case was exercised");
    assert.match(items[typoIndex].innerHTML, /hintline/, "the typo hint survives into the review");
    assert.ok(
      items.some((el) => /Accepted:|answer <b>/.test(el.textContent)),
      "wrong answers show what was accepted"
    );
    assert.ok(
      items.some((el) => /<div class="rq">/.test(el.innerHTML)),
      "the review repeats each question"
    );

    // Best score lands on the home card.
    goHome();
    assert.match($(".card[data-t='meth']").textContent, /Best 0\/20/);
    openTopic("meth");
    assert.equal($("#resumeBtn"), null, "a finished round leaves nothing to resume");
    assert.match($(".gradingnote").textContent, /capitalization/i, "the grading rules are stated up front");

    // Typing into the answer box must never be hijacked by the quiz shortcuts.
    click($("#noneBtn"));
    assert.equal($("#mixInput").value, "0", "the 'None' shortcut zeroes the box");
    startFresh();
    const ctx = await walkTo(app, (c) => c.kind !== "mc");
    if (ctx) {
      const box = $("#ta") || $$(".blank")[0];
      type(box, "1");
      press("1", box);
      press("Enter", box);
      await settle();
      assert.equal($(".opt.sel"), null, "a keystroke inside the box selects no option");
      assert.equal(app.store.revealed[ctx.i], false, "and does not grade the question");
      assert.equal(box.value, "1", "the typed character stays put");
    }

    goHome();
  } finally {
    done();
  }
});

test("flow 6: resume keeps the mix, and a dead engine never marks you wrong", async () => {
  const { app, done } = boot();
  try {
    await startRound(app, "python", 12);
    assert.equal(app.store.mix.text, 12);

    await playRound(app, { mode: "correct", limit: 3 });
    const roundBefore = app.store.round.map((r) => r.idx + ":" + r.kind).join(",");
    goHome();
    assert.match($(".card[data-t='python']").textContent, /Resume 3\/20/);

    openTopic("python");
    assert.match($("#resumeBtn").textContent, /Resume — 3\/20/);
    click($("#resumeBtn"));
    assert.equal(app.store.mix.text, 12, "resuming keeps the written mix");
    assert.equal(app.store.round.map((r) => r.idx + ":" + r.kind).join(","), roundBefore, "the same round comes back");
    assert.equal(app.store.counts().done, 3, "the three answers were persisted");
    assert.equal(app.store.currentIndex(), 3, "resume jumps to the first unanswered question");

    await playRound(app, { mode: "correct", limit: 2 });
    goHome();

    // A dead engine must leave the question unanswered instead of marking it wrong.
    await until(
      app,
      "python",
      20,
      (a) => a.store.round.some((_, i) => kindOf(a, i) === "code" && a.store.itemAt(i).lang === "python"),
      "a python coding question"
    );
    const ctx = await walkTo(app, (c) => c.kind === "code" && c.question.lang === "python");
    assert.ok(ctx, "reached the python coding question");
    fillCode(app, STUB_BROKEN);
    click($("#gradeBtn"));
    await settle();
    assert.equal(app.store.revealed[ctx.i], false, "an engine that cannot start does not mark the answer");
    assert.ok($(".engine.warn"), "the student is told what happened");
    assert.match($(".engine.warn").textContent, /could not start/i);
    assert.equal($("#gradeBtn").disabled, false, "they can try again");
    assert.match($("#ta").value, /BROKEN_STUB/, "their code is still in the box");

    // ...and once the engine works, the same box grades normally.
    fillCode(app, STUB_PASS);
    await grade();
    assert.equal(app.store.marks[ctx.i], true);

    goHome();
  } finally {
    done();
  }
});

test("flow 7: a typo costs what the question deserves, and the optional local AI can only help", async () => {
  const { app, done } = boot();
  try {
    const isWritten = (c) => c.kind === "text";
    const longConcept = (c) => isWritten(c) && aiReviewAllowed(c.question) && ((c.question.check.values || [])[0] || "").length >= 6;
    const longExact = (c) =>
      isWritten(c) &&
      !aiReviewAllowed(c.question) &&
      !Array.isArray(c.question.blanks) &&
      ((c.question.check.values || [])[0] || "").length >= 5;
    const anyConcept = (a) => a.store.round.some((_, i) => isWritten(ctxOf(a, i)) && aiReviewAllowed(a.store.itemAt(i)));

    // 1. A one-letter slip on a conceptual question counts as right — with a note.
    await until(app, "net", 20, (a) => a.store.round.some((_, i) => longConcept(ctxOf(a, i))), "a long conceptual question");
    const near = await walkTo(app, longConcept);
    assert.ok(near, "reached a conceptual question");
    assert.match($(".qtag").textContent, /concept/, "the question is labelled as conceptual");
    const accepted = near.question.check.values[0];
    type($("#ta"), accepted.slice(0, -1));
    await grade();
    assert.equal(app.store.marks[near.i], true, "a near miss is accepted on a conceptual answer");
    assert.match($(".softline").textContent, /Accepted/);
    assert.ok($(".softline").textContent.includes(accepted), "the note still shows the exact answer");
    assert.ok($(".feed").className.includes("g"), "and the question is marked right");
    await advance(app);

    // 2. The same slip on an exact answer is wrong, says why, and offers no model.
    await until(app, "net", 20, (a) => a.store.round.some((_, i) => longExact(ctxOf(a, i))), "a long exact question");
    const exact = await walkTo(app, longExact);
    assert.ok(exact, "reached an exact question");
    assert.match($(".qtag").textContent, /exact/, "the question is labelled as exact");
    const target = exact.question.check.values[0];
    const slipped = target.slice(0, -1);
    assert.notEqual(slipped, target);
    type($("#ta"), slipped);
    await grade();
    assert.equal(app.store.marks[exact.i], false, "a typo on exact output is a wrong answer");
    assert.match($(".hintline").textContent, /character for character/i);
    assert.ok($(".hintline").textContent.includes(target), "the hint names the exact answer");
    assert.ok($(".aiout.small"), "the student is told exact answers are final");
    assert.equal($("#aiBtn"), null, "the local model is not offered for exact answers");
    assert.equal($("#aiEnableBtn"), null);
    await advance(app);

    // 3. The local AI is off by default, opt-in, and can upgrade a rule-based miss.
    await until(app, "net", 20, anyConcept, "a conceptual question");
    const ctx = await walkTo(app, (c) => isWritten(c) && aiReviewAllowed(c.question));
    assert.ok(ctx, "reached the conceptual question");
    type($("#ta"), wrongAnswer(ctx.question));
    await grade();
    assert.equal(app.store.marks[ctx.i], false, "a wrong conceptual answer is still wrong");
    const rightBefore = app.store.counts().right;
    assert.equal(readAIEnabled(), false, "the model is off unless asked for");
    assert.equal($("#aiBtn"), null, "so no model button yet");
    const enable = $("#aiEnableBtn");
    assert.ok(enable, "the opt-in is offered instead");
    click(enable);
    assert.equal(readAIEnabled(), true, "turning it on is remembered");
    assert.ok($("#aiBtn"), "now the review button is there");

    setAIEngineFactory(async () => ({
      chat: async () => '{"equivalent": true, "reason": "Same idea, stated differently."}',
    }));
    click($("#aiBtn"));
    await settle();
    assert.equal(app.store.marks[ctx.i], true, "the model's verdict upgrades the mark");
    assert.equal(app.store.counts().right, rightBefore + 1, "exactly one answer was rescued");
    assert.match($(".aiout.good").textContent, /Counted as correct by the local AI/);
    assert.match($(".aiout.good").textContent, /Same idea/);
    assert.match(answerSummary(app.store, ctx.i).aiNote, /Same idea/);

    // Finish the round: the review screen names the reason the answer improved.
    await advance(app);
    await playRound(app, { mode: "wrong" });
    assert.ok($(".result"), "the round finished");
    assert.match($(".rev").textContent, /Local AI: Same idea/, "the review credits the local model");
    assert.match($(".result .score").textContent, new RegExp("^" + app.store.counts().right + "\\/20$"));

    // The model is only ever asked about conceptual answers, so the exact
    // questions in the same round carry no AI verdict at all.
    const exactIndexes = app.store.round.map((_, i) => i).filter((i) => !app.store.isMC(i) && !app.store.isCode(i) && !aiReviewAllowed(app.store.itemAt(i)));
    assert.ok(exactIndexes.length > 0, "the round had exact questions too");
    for (const i of exactIndexes) assert.equal(app.store.aiNotes[i], "", "no model verdict on an exact question");

    goHome();
    assert.equal(window.localStorage.getItem("csq-net"), null, "a finished round leaves nothing to resume");
  } finally {
    resetAIEngine();
    done();
  }
});

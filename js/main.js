import { topics } from "../data/all.js";
import { Timer } from "./timer.js";
import { QuizStore, readBest, readProgress, writeAIEnabled, writeBest } from "./store.js";
import { renderHome } from "./views/home-view.js";
import { renderSetup } from "./views/setup-view.js";
import { renderQuiz, scrollToQuestion, handleQuizKey, freezeCircles, readGradeInput } from "./views/quiz-view.js";
import { renderResult } from "./views/result-view.js";
import { langLabel } from "./engines/index.js";
import { escapeHtml } from "./html.js";

const $ = (id) => document.getElementById(id);

/**
 * Boot the app against the current document.
 * Exported so the E2E suite can start a fresh app per scenario.
 */
export function startApp() {
  const els = {
    topbar: $("topbar"),
    topicsBtn: $("topicsBtn"),
    home: $("viewHome"),
    setup: $("viewSetup"),
    quiz: $("viewQuiz"),
    result: $("viewResult"),
    qwrap: $("questions"),
    circles: $("circles"),
    segG: $("segG"),
    segR: $("segR"),
    progFill: $("progFill"),
    progText: $("progText"),
    scoreText: $("scoreText"),
    topicBar: $("topicBar"),
  };

  const timer = new Timer($("timer"));
  const store = new QuizStore(topics);
  let quizHooks = null;
  let lastMix = 0;

  function onKeyDown(event) {
    if (quizHooks) handleQuizKey(event, store, quizHooks);
  }

  function show(name) {
    els.home.classList.toggle("hidden", name !== "home");
    els.setup.classList.toggle("hidden", name !== "setup");
    els.quiz.classList.toggle("hidden", name !== "quiz");
    els.result.classList.toggle("hidden", name !== "result");
    els.topbar.classList.toggle("idle", name === "home" || name === "setup");
    els.topicsBtn.style.display = name === "home" || name === "setup" ? "none" : "";
  }

  function progressOf(topicId) {
    const pool = topics[topicId].questions.length;
    const txPool = (topics[topicId].text || []).length;
    const saved = readProgress(topicId, pool, txPool);
    if (!saved) return 0;
    return saved.revealed.filter(Boolean).length;
  }

  function openHome() {
    quizHooks = null;
    document.removeEventListener("keydown", onKeyDown);
    timer.reset();
    renderHome(els, show, topics, readBest, progressOf, openSetup);
  }

  function openSetup(topicId) {
    quizHooks = null;
    document.removeEventListener("keydown", onKeyDown);
    timer.reset();
    const maxText = (topics[topicId].text || []).length;
    renderSetup(els, show, topics[topicId], maxText, progressOf(topicId), {
      onStart: (n) => {
        store.clearProgress(topicId);
        openQuiz(topicId, n);
      },
      onResume: () => openQuiz(topicId, 0),
      onToggleAI: (on) => writeAIEnabled(on),
      onHome: openHome,
    });
  }

  function refreshQuiz(keepScroll) {
    const y = keepScroll ? window.scrollY : 0;
    renderQuiz(els, show, store, quizHooks);
    if (keepScroll) window.scrollTo(0, y);
  }

  function openQuiz(topicId, textCount) {
    store.start(topicId, textCount);
    // `0` means "resume the saved round", so take the mix from the round itself —
    // otherwise "New test" after a resume would silently drop the written mix.
    lastMix = store.mix.text;
    startRound();
  }

  function replayQuiz() {
    store.replay();
    startRound();
  }

  function startRound() {
    timer.reset();
    timer.start();
    quizHooks = {
      onSelect: (slot) => {
        if (!store.isMC(store.view) || store.revealed[store.view]) return;
        store.pending = slot;
        refreshQuiz(true);
      },
      onGrade: async () => {
        const v = store.view;
        if (store.revealed[v]) return;
        if (store.isMC(v)) {
          if (store.pending == null) return;
          store.answerMC(v, store.pending);
          store.pending = null;
          refreshQuiz(true);
        } else if (store.isCode(v)) {
          const input = readGradeInput(store);
          const btn = els.qwrap.querySelector("#gradeBtn");
          const msg = els.qwrap.querySelector("#engineMsg");
          const lang = store.itemAt(v).lang || "javascript";
          if (btn) {
            btn.disabled = true;
            btn.textContent = "Running…";
          }
          const onStatus = (state) => {
            if (!msg) return;
            msg.className = "engine";
            msg.textContent =
              state === "loading"
                ? "Starting the " + langLabel(lang) + " engine — the first run downloads it (one time only)…"
                : "";
          };
          const result = await store.answerCode(v, input.value || "", onStatus);
          if (result && result.unavailable) {
            // The runtime failed to load. That is our problem, not the student's:
            // keep their code in the box and let them try again.
            if (msg) {
              msg.className = "engine warn";
              msg.textContent = "Couldn't run your code: " + result.message;
            }
            if (btn) {
              btn.disabled = false;
              btn.textContent = "Check →";
            }
            return;
          }
          refreshQuiz(true);
        } else {
          const input = readGradeInput(store);
          store.answerText(v, input.value ?? "");
          refreshQuiz(true);
        }
        const feed = els.qwrap.querySelector(".feed.show");
        if (feed && typeof feed.scrollIntoView === "function") feed.scrollIntoView({ behavior: "smooth", block: "nearest" });
      },
      onAdvance: () => {
        if (store.currentIndex() >= store.size) {
          finishQuiz();
          return;
        }
        store.view = store.currentIndex();
        store.touchTimer();
        refreshQuiz(false);
        scrollToQuestion(store.view);
      },
      onStepBack: () => {
        if (store.view <= 0) return;
        store.view -= 1;
        refreshQuiz(false);
        scrollToQuestion(store.view);
      },
      onEnableAI: () => {
        writeAIEnabled(true);
        refreshQuiz(true);
        const btn = els.qwrap.querySelector("#aiBtn");
        if (btn) btn.focus();
      },
      onAIReview: async (i) => {
        const btn = els.qwrap.querySelector("#aiBtn");
        const box = els.qwrap.querySelector("#aiStatus");
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Asking the local model…";
        }
        if (box) box.innerHTML = "<span class=\"ainote\">Waking the local model up — the first run downloads it once (a few hundred MB), then everything stays on this device…</span>";
        const result = await store.reviewWithAI(i, {
          onProgress: (progress, text) => {
            if (!box) return;
            const pct = Math.max(0, Math.min(100, Math.round((progress || 0) * 100)));
            box.innerHTML = "<span class=\"ainote\">Downloading the local model… <b>" + pct + "%</b>" + (text ? " — " + escapeHtml(text) : "") + "</span>";
          },
        });
        refreshQuiz(true);
        const feed = els.qwrap.querySelector(".feed.show");
        if (feed && typeof feed.scrollIntoView === "function") feed.scrollIntoView({ behavior: "smooth", block: "nearest" });
        void result;
      },
      onGoto: (i) => {
        const current = store.currentIndex();
        if (store.revealed[i]) {
          store.view = i;
        } else if (i === current) {
          store.view = i;
          store.touchTimer();
        } else {
          return;
        }
        refreshQuiz(false);
        scrollToQuestion(i);
      },
      onHome: openHome,
    };
    refreshQuiz(false);
    window.scrollTo(0, 0);
    document.removeEventListener("keydown", onKeyDown);
    document.addEventListener("keydown", onKeyDown);
  }

  function finishQuiz() {
    const { right, done, total } = store.counts();
    if (done < total) return;
    timer.stop();
    quizHooks = null;
    document.removeEventListener("keydown", onKeyDown);
    writeBest(store.topicId, right + "/" + total);
    store.clearProgress();
    freezeCircles(els, store);
    renderResult(els, show, store, timer.elapsedMs(), {
      onReplay: replayQuiz,
      onRetry: () => openQuiz(store.topicId, lastMix),
      onHome: openHome,
    });
  }

  els.topicsBtn.addEventListener("click", openHome);
  openHome();

  return { store, els, openSetup, openQuiz };
}

if (typeof document !== "undefined" && document.getElementById) startApp();

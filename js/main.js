import { topics } from "../data/all.js";
import { Timer } from "./timer.js";
import { QuizStore, readBest, readProgress, writeBest } from "./store.js";
import { renderHome } from "./views/home-view.js";
import { renderSetup } from "./views/setup-view.js";
import { renderQuiz, scrollToQuestion, handleQuizKey, freezeCircles, readGradeInput } from "./views/quiz-view.js";
import { renderResult } from "./views/result-view.js";

const $ = (id) => document.getElementById(id);

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
  renderSetup(els, show, topics[topicId], maxText, {
    onStart: (n) => openQuiz(topicId, n),
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
  lastMix = textCount;
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
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Running…";
        }
        await store.answerCode(v, input.value || "");
        refreshQuiz(true);
      } else {
        const input = readGradeInput(store);
        store.answerText(v, input.value ?? "");
        refreshQuiz(true);
      }
      const feed = els.qwrap.querySelector(".feed.show");
      if (feed) feed.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    onRetry: () => openQuiz(store.topicId, lastMix),
    onHome: openHome,
  });
}

els.topicsBtn.addEventListener("click", openHome);

openHome();

import { topics } from "../data/all.js";
import { Timer } from "./timer.js";
import { QuizStore, readBest, readProgress, writeBest } from "./store.js";
import { renderHome } from "./views/home-view.js";
import { renderQuiz, scrollToQuestion, handleQuizKey } from "./views/quiz-view.js";
import { renderResult } from "./views/result-view.js";

const $ = (id) => document.getElementById(id);

const els = {
  topbar: $("topbar"),
  topicsBtn: $("topicsBtn"),
  home: $("viewHome"),
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

function onKeyDown(event) {
  if (quizHooks) handleQuizKey(event, store, quizHooks);
}

function show(name) {
  els.home.classList.toggle("hidden", name !== "home");
  els.quiz.classList.toggle("hidden", name !== "quiz");
  els.result.classList.toggle("hidden", name !== "result");
  els.topbar.classList.toggle("idle", name === "home");
  els.topicsBtn.style.display = name === "home" ? "none" : "";
}

function progressOf(topicId) {
  const pool = topics[topicId].questions.length;
  const saved = readProgress(topicId, pool);
  if (!saved) return 0;
  return saved.revealed.filter(Boolean).length;
}

function openHome() {
  quizHooks = null;
  document.removeEventListener("keydown", onKeyDown);
  timer.reset();
  renderHome(els, show, topics, readBest, progressOf, openQuiz);
}

function refreshQuiz(keepScroll) {
  const y = keepScroll ? window.scrollY : 0;
  renderQuiz(els, show, store, quizHooks);
  if (keepScroll) window.scrollTo(0, y);
}

function openQuiz(topicId) {
  store.start(topicId);
  timer.reset();
  timer.start();
  quizHooks = {
    onSelect: (slot) => {
      if (store.revealed[store.view]) return;
      store.pending = slot;
      refreshQuiz(true);
    },
    onGrade: () => {
      const v = store.view;
      if (store.revealed[v] || store.pending == null) return;
      store.answer(v, store.pending);
      store.pending = null;
      refreshQuiz(true);
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
  renderResult(els, show, store, timer.elapsedMs(), {
    onRetry: () => openQuiz(store.topicId),
    onHome: openHome,
  });
}

els.topicsBtn.addEventListener("click", openHome);

openHome();

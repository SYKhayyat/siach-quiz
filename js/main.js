import { topics } from "../data/all.js";
import { Timer } from "./timer.js";
import { QuizStore, readBest, readProgress, writeBest } from "./store.js";
import { renderHome } from "./views/home-view.js";
import { renderQuiz, scrollToQuestion, handleQuizKey } from "./views/quiz-view.js";
import { renderResult } from "./views/result-view.js";

const $ = (id) => document.getElementById(id);

const els = {
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
}

function progressOf(topicId) {
  const total = topics[topicId].questions.length;
  const saved = readProgress(topicId, total);
  if (!saved) return 0;
  return saved.revealed.filter(Boolean).length;
}

function openHome() {
  quizHooks = null;
  document.removeEventListener("keydown", onKeyDown);
  timer.reset();
  renderHome(els, show, topics, readBest, progressOf, openQuiz);
}

function refreshQuiz() {
  renderQuiz(els, show, store, quizHooks);
}

function openQuiz(topicId) {
  store.start(topicId);
  timer.reset();
  timer.start();
  quizHooks = {
    onAnswer: (qi, choice) => {
      if (store.answer(qi, choice)) refreshQuiz();
    },
    onGoto: (i) => {
      store.pos = i;
      refreshQuiz();
      scrollToQuestion(i);
    },
    onFinish: finishQuiz,
    onHome: openHome,
  };
  refreshQuiz();
  window.scrollTo({ top: 0 });
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

$("homeLink").addEventListener("click", (event) => {
  event.preventDefault();
  openHome();
});

openHome();

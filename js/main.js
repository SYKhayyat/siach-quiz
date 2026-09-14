import { topics } from "../data/all.js";
import { Timer } from "./timer.js";
import { QuizStore, readBest, writeBest } from "./store.js";
import { renderHome } from "./views/home-view.js";
import { renderQuiz, scrollToQuestion } from "./views/quiz-view.js";
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

function show(name) {
  els.home.classList.toggle("hidden", name !== "home");
  els.quiz.classList.toggle("hidden", name !== "quiz");
  els.result.classList.toggle("hidden", name !== "result");
}

function openHome() {
  timer.reset();
  renderHome(els, show, topics, readBest, openQuiz);
}

function refreshQuiz() {
  renderQuiz(els, show, store, {
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
  });
}

function openQuiz(topicId) {
  store.start(topicId);
  timer.reset();
  timer.start();
  refreshQuiz();
  window.scrollTo({ top: 0 });
}

function finishQuiz() {
  const { right, done, total } = store.counts();
  if (done < total) return;
  timer.stop();
  writeBest(store.topicId, right + "/" + total);
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

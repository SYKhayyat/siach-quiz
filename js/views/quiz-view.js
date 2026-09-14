import { escapeHtml } from "../html.js";

const LETTERS = "ABCD";

function optionHTML(qi, text, ci, state) {
  const question = state.current().questions[qi];
  const revealed = state.revealed[qi];
  let cls = "opt";
  if (revealed) {
    if (ci === question.answer) cls += " right";
    else if (ci === state.answers[qi]) cls += " wrong";
    else cls += " dim";
  }
  const disabled = revealed ? " disabled" : "";
  return (
    '<button class="' +
    cls +
    '"' +
    disabled +
    ' data-q="' +
    qi +
    '" data-c="' +
    ci +
    '"><span class="k">' +
    LETTERS[ci] +
    "</span><span>" +
    text +
    "</span></button>"
  );
}

function feedbackHTML(question, selected) {
  const ok = selected === question.answer;
  return (
    '<div class="feed show ' +
    (ok ? "g" : "r") +
    '">' +
    (ok ? "Correct." : "Wrong — correct answer: <b>" + LETTERS[question.answer] + "</b>.") +
    '<span class="why">' +
    question.why +
    "</span></div>"
  );
}

function questionHTML(store, qi) {
  const topic = store.current();
  const question = topic.questions[qi];
  const total = topic.questions.length;
  const options = question.choices.map((choice, ci) => optionHTML(qi, choice, ci, store)).join("");
  const feed = store.revealed[qi] ? feedbackHTML(question, store.answers[qi]) : '<div class="feed"></div>';
  const prev = qi > 0 ? '<button class="btn ghost" data-goto="' + (qi - 1) + '">← Prev</button>' : "";
  const next = qi < total - 1 ? '<button class="btn ghost" data-goto="' + (qi + 1) + '">Next →</button>' : "";
  return (
    '<div class="q" id="q-' +
    qi +
    '"><div class="qhead"><span class="qnum">Q' +
    (qi + 1) +
    " · " +
    escapeHtml(topic.title) +
    '</span><span class="qtag">' +
    escapeHtml(question.tag || "") +
    '</span></div><div class="prompt">' +
    question.q +
    "</div>" +
    (question.code ? '<pre class="code">' + escapeHtml(question.code) + "</pre>" : "") +
    '<div class="opts">' +
    options +
    "</div>" +
    feed +
    '<div class="nav">' +
    prev +
    next +
    "</div></div>"
  );
}

export function renderQuiz(els, show, store, hooks) {
  show("quiz");
  const topic = store.current();
  const { right, wrong, done, total } = store.counts();
  els.segG.style.width = (right / total) * 100 + "%";
  els.segR.style.width = (wrong / total) * 100 + "%";
  els.progFill.style.width = (done / total) * 100 + "%";
  els.progText.textContent = done + "/" + total + " answered";
  els.scoreText.innerHTML = done ? "<b>" + right + "</b> right · <b>" + wrong + "</b> wrong" : "";
  els.circles.innerHTML = topic.questions
    .map((q, i) => {
      let cls = "c";
      if (store.revealed[i]) cls += store.answers[i] === q.answer ? " pass" : " fail";
      if (i === store.pos) cls += " cur";
      return '<div class="' + cls + '" data-i="' + i + '">' + (i + 1) + "</div>";
    })
    .join("");
  els.circles.querySelectorAll(".c").forEach((dot) => dot.addEventListener("click", () => hooks.onGoto(+dot.dataset.i)));
  els.qwrap.innerHTML =
    topic.questions.map((_, i) => questionHTML(store, i)).join("") +
    '<div class="nav"><button class="btn" id="finishBtn"' +
    (done < total ? " disabled" : "") +
    '>Finish — see score</button><button class="btn ghost" id="homeBtn">All topics</button></div>';
  els.qwrap.querySelectorAll(".opt").forEach((btn) => btn.addEventListener("click", () => hooks.onAnswer(+btn.dataset.q, +btn.dataset.c)));
  els.qwrap.querySelectorAll("[data-goto]").forEach((btn) => btn.addEventListener("click", () => hooks.onGoto(+btn.dataset.goto)));
  els.qwrap.querySelector("#finishBtn").addEventListener("click", hooks.onFinish);
  els.qwrap.querySelector("#homeBtn").addEventListener("click", hooks.onHome);
}

export function scrollToQuestion(qi) {
  const el = document.getElementById("q-" + qi);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

const KEY_TO_CHOICE = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };

export function handleQuizKey(event, store, hooks) {
  if (/^(input|textarea)$/i.test(event.target.tagName)) return;
  const total = store.current().questions.length;
  const key = event.key.toLowerCase();
  if (key === "arrowright") {
    hooks.onGoto(Math.min(store.pos + 1, total - 1));
  } else if (key === "arrowleft") {
    hooks.onGoto(Math.max(store.pos - 1, 0));
  } else if (Object.hasOwn(KEY_TO_CHOICE, key)) {
    if (!store.revealed[store.pos]) hooks.onAnswer(store.pos, KEY_TO_CHOICE[key]);
  }
}

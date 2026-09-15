import { escapeHtml } from "../html.js";

const LETTERS = "ABCD";

function fmtSecs(ms) {
  if (ms == null) return "–";
  return Math.max(1, Math.round(ms / 1000)) + "s";
}

function optionHTML(store, qi, slot) {
  const revealed = store.revealed[qi];
  const correct = store.correctSlot(qi);
  let cls = "opt";
  if (revealed) {
    if (slot === correct) cls += " right";
    else if (slot === store.answers[qi]) cls += " wrong";
    else cls += " dim";
  } else if (slot === store.pending) {
    cls += " sel";
  }
  const disabled = revealed ? " disabled" : "";
  return (
    '<button class="' +
    cls +
    '"' +
    disabled +
    ' data-c="' +
    slot +
    '"><span class="k">' +
    LETTERS[slot] +
    "</span><span>" +
    store.choiceText(qi, slot) +
    "</span></button>"
  );
}

function feedbackHTML(store, qi) {
  const correct = store.correctSlot(qi);
  const ok = store.answers[qi] === correct;
  return (
    '<div class="feed show ' +
    (ok ? "g" : "r") +
    '">' +
    (ok ? "Correct." : "Wrong — correct answer: <b>" + LETTERS[correct] + "</b>.") +
    '<span class="why">' +
    store.questionAt(qi).why +
    "</span>" +
    '<span class="why time">Answered in ' +
    fmtSecs(store.qTimes[qi]) +
    ".</span></div>"
  );
}

function questionHTML(store, qi) {
  const topic = store.current();
  const question = store.questionAt(qi);
  const options = [0, 1, 2, 3].map((slot) => optionHTML(store, qi, slot)).join("");
  const feed = store.revealed[qi] ? feedbackHTML(store, qi) : "";
  return (
    '<div class="q" id="q-' +
    qi +
    '"><div class="qhead"><span class="qnum">Q' +
    (qi + 1) +
    " of " +
    store.size +
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
    "</div>"
  );
}

function navHTML(store) {
  const view = store.view;
  const revealed = store.revealed[view];
  let html = '<div class="nav">';
  if (view > 0) html += '<button class="btn ghost" id="backBtn">← Back</button>';
  if (!revealed) {
    html +=
      '<button class="btn" id="nextBtn"' +
      (store.pending == null ? " disabled" : "") +
      ">Next →</button>";
  } else if (store.currentIndex() >= store.size) {
    html += '<button class="btn" id="advBtn">See results →</button>';
  } else {
    html += '<button class="btn" id="advBtn">Continue →</button>';
  }
  html += '<button class="btn ghost" id="homeBtn">All topics</button></div>';
  return html;
}

export function renderQuiz(els, show, store, hooks) {
  show("quiz");
  const { right, wrong, done, total } = store.counts();
  els.segG.style.width = (right / total) * 100 + "%";
  els.segR.style.width = (wrong / total) * 100 + "%";
  els.progFill.style.width = (done / total) * 100 + "%";
  els.progText.textContent = done + "/" + total + " answered";
  els.scoreText.innerHTML = done ? "<b>" + right + "</b> right · <b>" + wrong + "</b> wrong" : "";
  els.circles.innerHTML = store.order
    .map((_, i) => {
      const current = store.currentIndex();
      let cls = "c";
      let clickable = true;
      if (store.revealed[i]) {
        cls += store.answers[i] === store.correctSlot(i) ? " pass" : " fail";
      } else if (i !== current) {
        cls += " todo";
        clickable = false;
      }
      if (i === current || i === store.view) cls += " cur";
      return '<div class="' + cls + '"' + (clickable ? ' data-i="' + i + '"' : "") + ">" + (i + 1) + "</div>";
    })
    .join("");
  els.circles.querySelectorAll("[data-i]").forEach((dot) => dot.addEventListener("click", () => hooks.onGoto(+dot.dataset.i)));
  els.qwrap.innerHTML = questionHTML(store, store.view) + navHTML(store);
  els.qwrap.querySelectorAll(".opt").forEach((btn) => {
    if (!btn.disabled) btn.addEventListener("click", () => hooks.onSelect(+btn.dataset.c));
  });
  const nextBtn = els.qwrap.querySelector("#nextBtn");
  if (nextBtn) nextBtn.addEventListener("click", hooks.onGrade);
  const advBtn = els.qwrap.querySelector("#advBtn");
  if (advBtn) advBtn.addEventListener("click", hooks.onAdvance);
  const backBtn = els.qwrap.querySelector("#backBtn");
  if (backBtn) backBtn.addEventListener("click", hooks.onStepBack);
  els.qwrap.querySelector("#homeBtn").addEventListener("click", hooks.onHome);
}

export function freezeCircles(els, store) {
  els.circles.innerHTML = store.order
    .map(
      (_, i) =>
        '<div class="c' +
        (store.answers[i] === store.correctSlot(i) ? " pass" : " fail") +
        '">' +
        (i + 1) +
        "</div>"
    )
    .join("");
}

export function scrollToQuestion(qi) {
  const el = document.getElementById("q-" + qi);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

const KEY_TO_CHOICE = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };

export function handleQuizKey(event, store, hooks) {
  if (/^(input|textarea)$/i.test(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  if (key === "enter") {
    if (store.revealed[store.view]) hooks.onAdvance();
    else hooks.onGrade();
  } else if (key === "arrowleft") {
    hooks.onStepBack();
  } else if (Object.hasOwn(KEY_TO_CHOICE, key)) {
    hooks.onSelect(KEY_TO_CHOICE[key]);
  }
}

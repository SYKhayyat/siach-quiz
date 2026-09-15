import { escapeHtml } from "../html.js";

const LETTERS = "ABCD";

function fmtSecs(ms) {
  if (ms == null) return "–";
  return Math.max(1, Math.round(ms / 1000)) + "s";
}

function acceptedText(q) {
  if (Array.isArray(q.blanks) && q.blanks.length > 0) {
    return q.blanks.map((b) => b.answer || (b.values || [])[0] || "").join(" / ");
  }
  if (q.check && Array.isArray(q.check.values)) return q.check.values.join(" / ");
  if (q.check && q.check.type === "number") return String(q.check.value);
  return q.answer || "";
}

export function answerSummary(store, i) {
  const q = store.itemAt(i);
  if (store.isMC(i)) {
    return {
      ok: store.marks[i],
      you: LETTERS[store.answers[i]],
      expected: LETTERS[store.correctSlot(i)],
    };
  }
  if (store.isCode(i)) {
    return { ok: store.marks[i], you: "your code below", expected: q.answer || "" };
  }
  if (Array.isArray(q.blanks) && q.blanks.length > 0) {
    const given = store.answers[i] || [];
    const marks = store.blanks[i] || [];
    const lines = q.blanks.map((b, bi) => {
      const acc = b.answer || (b.values || [])[0] || "";
      const got = given[bi] == null || given[bi] === "" ? "—" : String(given[bi]);
      return marks[bi] ? `Blank ${bi + 1}: ✓ <b>${escapeHtml(got)}</b>` : `Blank ${bi + 1}: ✕ you wrote <b>${escapeHtml(got)}</b> — accepted: <b>${escapeHtml(acc)}</b>`;
    });
    return { ok: store.marks[i], you: lines.join("<br>"), expected: acceptedText(q) };
  }
  const got = store.answers[i] == null || store.answers[i] === "" ? "—" : String(store.answers[i]);
  return { ok: store.marks[i], you: got, expected: acceptedText(q) };
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
    '<button class="' + cls + '"' + disabled + ' data-c="' + slot + '"><span class="k">' + LETTERS[slot] + "</span><span>" + store.choiceText(qi, slot) + "</span></button>"
  );
}

function textInputs(store, qi) {
  const q = store.itemAt(qi);
  if (store.revealed[qi]) return "";
  if (Array.isArray(q.blanks) && q.blanks.length > 0) {
    return (
      '<div class="blanks">' +
      q.blanks
        .map((b, bi) => '<label class="blabel">' + escapeHtml(b.label || "Blank " + (bi + 1)) + '<input class="blank" data-b="' + bi + '" autocomplete="off" spellcheck="false"></label>')
        .join("") +
      "</div>"
    );
  }
  return '<textarea id="ta" rows="2" autocomplete="off" spellcheck="false" placeholder="Type your answer"></textarea>';
}

function codeInput(store, qi) {
  const q = store.itemAt(qi);
  if (store.revealed[qi]) return '<pre class="code">' + escapeHtml(store.answers[qi] || "") + "</pre>";
  return '<textarea id="ta" class="codeta" rows="10" spellcheck="false">' + escapeHtml(q.starter || "") + "</textarea>";
}

function feedbackHTML(store, qi) {
  const s = answerSummary(store, qi);
  const q = store.itemAt(qi);
  let head;
  if (store.isMC(qi)) {
    head = s.ok ? "Correct." : "Wrong — correct answer: <b>" + s.expected + "</b>.";
  } else if (store.isCode(qi)) {
    head = s.ok ? "Correct — all tests passed." : "Not quite — <b>" + escapeHtml(store.codeMsg[qi] || "a test failed") + "</b>. Expected: <b>" + escapeHtml(s.expected) + "</b>.";
  } else {
    head = s.ok ? "Correct." : "Not quite — accepted answer: <b>" + escapeHtml(s.expected) + "</b>.";
  }
  return (
    '<div class="feed show ' + (s.ok ? "g" : "r") + '">' + head + '<span class="why">' + q.why + "</span>" + '<span class="why time">Answered in ' + fmtSecs(store.qTimes[qi]) + ".</span></div>"
  );
}

function questionHTML(store, qi) {
  const topic = store.current();
  const question = store.itemAt(qi);
  let body = "";
  if (store.isMC(qi)) {
    body = '<div class="opts">' + [0, 1, 2, 3].map((slot) => optionHTML(store, qi, slot)).join("") + "</div>";
  } else if (store.isCode(qi)) {
    body = codeInput(store, qi);
  } else {
    body = textInputs(store, qi);
  }
  const kindTag = store.isMC(qi) ? "Multiple choice" : store.isCode(qi) ? "Code" : "Written";
  const feed = store.revealed[qi] ? feedbackHTML(store, qi) : "";
  return (
    '<div class="q" id="q-' + qi + '"><div class="qhead"><span class="qnum">Q' + (qi + 1) + " of " + store.size + " · " + escapeHtml(topic.title) + '</span><span class="qtag">' + kindTag + (question.tag ? " · " + escapeHtml(question.tag) : "") + "</span></div>" +
    '<div class="prompt">' + question.q + "</div>" +
    (question.code && !store.isCode(qi) ? '<pre class="code">' + escapeHtml(question.code) + "</pre>" : "") +
    body + feed + "</div>"
  );
}

function navHTML(store) {
  const view = store.view;
  const revealed = store.revealed[view];
  let html = '<div class="nav">';
  if (view > 0) html += '<button class="btn ghost" id="backBtn">← Back</button>';
  if (!revealed) {
    const label = store.isMC(view) ? "Next →" : "Check →";
    const ready = store.isMC(view) ? store.pending != null : true;
    html += '<button class="btn" id="gradeBtn"' + (ready ? "" : " disabled") + ">" + label + "</button>";
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
  els.circles.innerHTML = store.round
    .map((_, i) => {
      const current = store.currentIndex();
      let cls = "c";
      let clickable = true;
      if (store.revealed[i]) {
        cls += store.marks[i] ? " pass" : " fail";
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
  const gradeBtn = els.qwrap.querySelector("#gradeBtn");
  if (gradeBtn) {
    gradeBtn.addEventListener("click", hooks.onGrade);
    if (!store.isMC(store.view) && !store.revealed[store.view]) {
      const arm = () => {
        gradeBtn.disabled = readGradeInput(store).empty;
      };
      els.qwrap.querySelectorAll("#ta, .blank").forEach((el) => el.addEventListener("input", arm));
      arm();
    }
  }
  const advBtn = els.qwrap.querySelector("#advBtn");
  if (advBtn) advBtn.addEventListener("click", hooks.onAdvance);
  const backBtn = els.qwrap.querySelector("#backBtn");
  if (backBtn) backBtn.addEventListener("click", hooks.onStepBack);
  els.qwrap.querySelector("#homeBtn").addEventListener("click", hooks.onHome);
}

export function readGradeInput(store) {
  const qi = store.view;
  if (store.isMC(qi)) return { empty: store.pending == null };
  const ta = document.querySelector("#ta");
  if (ta) return { empty: ta.value.trim() === "", value: ta.value };
  const blanks = [...document.querySelectorAll(".blank")];
  if (blanks.length > 0) {
    const values = blanks.map((b) => b.value);
    return { empty: values.every((v) => v.trim() === ""), value: values };
  }
  return { empty: true };
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

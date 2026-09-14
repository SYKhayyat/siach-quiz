import { escapeHtml } from "../html.js";
import { Timer } from "../timer.js";

const LETTERS = "ABCD";

function grade(pct) {
  if (pct >= 90) return "Outstanding.";
  if (pct >= 70) return "Solid — graduation-ready on this topic.";
  if (pct >= 50) return "Passing — review the red ones below.";
  return "Needs work — retry after reviewing.";
}

export function renderResult(els, show, store, elapsedMs, hooks) {
  const topic = store.current();
  const { right, wrong, done, total } = store.counts();
  const pct = Math.round((right / total) * 100);
  const review = topic.questions
    .map((q, i) => {
      const ok = store.answers[i] === q.answer;
      return (
        '<div class="rev-item">' +
        (ok ? '<b class="g">✓</b>' : '<b class="r">✕</b>') +
        " Q" +
        (i + 1) +
        " — you picked <b>" +
        LETTERS[store.answers[i]] +
        "</b>, answer <b>" +
        LETTERS[q.answer] +
        "</b><br>" +
        q.why +
        "</div>"
      );
    })
    .join("");
  els.result.innerHTML =
    '<div class="result"><h2>' +
    escapeHtml(topic.title) +
    " — done</h2>" +
    '<div class="score">' +
    right +
    "/" +
    total +
    "</div>" +
    '<div class="sub">' +
    pct +
    "% · " +
    wrong +
    " wrong · time <b>" +
    Timer.formatClock(elapsedMs) +
    "</b> (" +
    Timer.formatLong(elapsedMs) +
    ") · " +
    grade(pct) +
    "</div>" +
    '<div class="nav" style="justify-content:center;margin-top:16px"><button class="btn" id="retryBtn">Retry</button>' +
    '<button class="btn ghost" id="backBtn">All topics</button></div>' +
    '<div class="rev">' +
    review +
    "</div></div>";
  els.result.querySelector("#retryBtn").addEventListener("click", hooks.onRetry);
  els.result.querySelector("#backBtn").addEventListener("click", hooks.onHome);
  show("result");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

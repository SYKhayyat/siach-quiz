import { escapeHtml } from "../html.js";
import { Timer } from "../timer.js";
import { answerSummary } from "./quiz-view.js";

function grade(pct) {
  if (pct >= 90) return "Outstanding.";
  if (pct >= 70) return "Solid — graduation-ready on this topic.";
  if (pct >= 50) return "Passing — review the red ones below.";
  return "Needs work — retry after reviewing.";
}

export function renderResult(els, show, store, elapsedMs, hooks) {
  const topic = store.current();
  const { right, wrong, total } = store.counts();
  const pct = Math.round((right / total) * 100);
  const times = store.qTimes.filter((t) => t != null);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length / 1000) : 0;
  const review = store.round
    .map((_, i) => {
      const q = store.itemAt(i);
      const s = answerSummary(store, i);
      const secs = store.qTimes[i] == null ? "" : " · " + Math.max(1, Math.round(store.qTimes[i] / 1000)) + "s";
      const kind = store.isMC(i) ? "Multiple choice" : store.isCode(i) ? "Code" : "Written";
      const detail = store.isMC(i)
        ? "you picked <b>" + s.you + "</b>, answer <b>" + s.expected + "</b>"
        : store.isCode(i)
          ? "your code:<pre class=\"code\">" + escapeHtml(store.answers[i] || "") + "</pre>" +
            (s.ok ? "" : "Expected approach: <b>" + escapeHtml(s.expected) + "</b>")
          : s.you + (s.ok ? "" : "<br>Accepted: <b>" + s.expected + "</b>");
      const note = !s.ok && s.note ? "<br>Why that pick fails: " + escapeHtml(s.note) : "";
      return (
        '<div class="rev-item">' +
        (ok ? '<b class="g">✓</b>' : '<b class="r">✕</b>') +
        " Q" + (i + 1) + " <small>(" + kind + secs + ")</small>" +
        '<div class="rq">' + q.q + "</div>" + detail + note +
        "<br>" + q.why + "</div>"
      );
    })
    .join("");
  els.result.innerHTML =
    '<div class="result"><h2>' + escapeHtml(topic.title) + " — done</h2>" +
    '<div class="score">' + right + "/" + total + "</div>" +
    '<div class="sub">' + pct + "% · " + wrong + " wrong · time <b>" + Timer.formatClock(elapsedMs) + "</b> (" + Timer.formatLong(elapsedMs) + ", avg " + avg + "s/question) · " + grade(pct) + "</div>" +
    '<div class="nav" style="justify-content:center;margin-top:16px"><button class="btn" id="replayBtn">Retake this test</button>' +
    '<button class="btn ghost" id="retryBtn">New test</button>' +
    '<button class="btn ghost" id="backBtn">All topics</button></div>' +
    '<div class="rev">' + review + "</div></div>";
  els.result.querySelector("#replayBtn").addEventListener("click", hooks.onReplay);
  els.result.querySelector("#retryBtn").addEventListener("click", hooks.onRetry);
  els.result.querySelector("#backBtn").addEventListener("click", hooks.onHome);
  show("result");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

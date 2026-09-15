import { escapeHtml } from "../html.js";
import { ROUND_SIZE } from "../store.js";

export function renderSetup(els, show, topic, maxText, hooks) {
  let count = Math.min(5, maxText);
  const paint = () => {
    els.setup.innerHTML =
      '<div class="hero"><h2>' +
      escapeHtml(topic.title) +
      "</h2><p>" +
      escapeHtml(topic.desc) +
      "</p></div>" +
      '<div class="setup">' +
      "<h3>How many written questions?</h3>" +
      "<p>The rest of the 20 are multiple choice. Written answers are checked on the spot — no AI involved.</p>" +
      '<div class="stepper"><button class="btn ghost" id="lessBtn" aria-label="fewer">−</button>' +
      '<span id="mixText"><b>' +
      count +
      "</b> written + <b>" +
      (ROUND_SIZE - count) +
      "</b> multiple-choice</span>" +
      '<button class="btn ghost" id="moreBtn" aria-label="more">+</button></div>' +
      '<div class="nav"><button class="btn" id="startBtn">Start</button>' +
      '<button class="btn ghost" id="setupHomeBtn">All topics</button></div>' +
      "</div>";
    els.setup.querySelector("#lessBtn").addEventListener("click", () => {
      count = Math.max(0, count - 1);
      paint();
    });
    els.setup.querySelector("#moreBtn").addEventListener("click", () => {
      count = Math.min(maxText, count + 1);
      paint();
    });
    els.setup.querySelector("#startBtn").addEventListener("click", () => hooks.onStart(count));
    els.setup.querySelector("#setupHomeBtn").addEventListener("click", hooks.onHome);
  };
  paint();
  show("setup");
}

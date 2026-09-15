import { escapeHtml } from "../html.js";
import { ROUND_SIZE } from "../store.js";

export function renderHome(els, show, topics, readBest, progressOf, onStart) {
  els.circles.innerHTML = "";
  els.segG.style.width = "0";
  els.segR.style.width = "0";
  els.progFill.style.width = "0";
  els.progText.textContent = "pick a topic";
  els.scoreText.textContent = "";
  const ids = Object.keys(topics);
  els.home.innerHTML =
    '<div class="hero"><h2>Pick a topic</h2>' +
    "<p>20 questions per round, right-or-wrong with an explanation after each one. Your time always counts.</p></div>" +
    '<div class="grid">' +
    ids
      .map((id) => {
        const round = Math.min(topics[id].questions.length, ROUND_SIZE);
        const done = progressOf(id);
        const best = readBest(id);
        const bits = [];
        if (done > 0 && done < round) bits.push("Resume — " + done + "/" + round);
        if (best) bits.push("Best: " + best);
        const sub = bits.length ? '<div class="n">' + escapeHtml(bits.join(" · ")) + "</div>" : "";
        return (
          '<div class="card" data-t="' +
          id +
          '" tabindex="0" role="button"><h3>' +
          escapeHtml(topics[id].title) +
          "</h3><p>" +
          escapeHtml(topics[id].desc) +
          "</p>" +
          sub +
          "</div>"
        );
      })
      .join("") +
    "</div>";
  els.home.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("click", () => onStart(card.dataset.t));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") onStart(card.dataset.t);
    });
  });
  show("home");
}

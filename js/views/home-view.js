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
    '<div class="hero"><h2>Pick a topic — 20 random questions each</h2>' +
    "<p>Multiple choice, drawn fresh from a large pool every run. Answer to see instantly if you were right and why. Green/red bar on top tracks right vs wrong, thin blue bar tracks progress. Timer always runs. Tip: keys 1–4 / A–D answer, ← / → move.</p></div>" +
    '<div class="grid">' +
    ids
      .map((id) => {
        const pool = topics[id].questions.length;
        const round = Math.min(pool, ROUND_SIZE);
        const done = progressOf(id);
        const best = readBest(id);
        const bits = [];
        if (done > 0 && done < round) bits.push("Resume — " + done + "/" + round);
        else if (done >= round) bits.push("Completed");
        else bits.push(pool + " in pool · " + round + " sampled");
        if (best) bits.push("Best: " + best);
        return (
          '<div class="card" data-t="' +
          id +
          '" tabindex="0" role="button"><h3>' +
          escapeHtml(topics[id].title) +
          "</h3><p>" +
          escapeHtml(topics[id].desc) +
          '</p><div class="n">' +
          escapeHtml(bits.join(" · ")) +
          "</div></div>"
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

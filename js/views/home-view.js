import { escapeHtml } from "../html.js";

export function renderHome(els, show, topics, readBest, onStart) {
  els.circles.innerHTML = "";
  els.segG.style.width = "0";
  els.segR.style.width = "0";
  els.progFill.style.width = "0";
  els.progText.textContent = "pick a topic";
  els.scoreText.textContent = "";
  const ids = Object.keys(topics);
  els.home.innerHTML =
    '<div class="hero"><h2>Pick a topic — 20 questions each</h2>' +
    "<p>Multiple choice. Answer to see instantly if you were right and why. Green/red bar on top tracks right vs wrong, thin blue bar tracks progress. Timer always runs. Tip: keys 1–4 / A–D answer, ← / → move.</p></div>" +
    '<div class="grid">' +
    ids
      .map((id) => {
        const best = readBest(id);
        const sub = best ? "Best: " + escapeHtml(best) : "20 questions";
        return (
          '<div class="card" data-t="' +
          id +
          '" tabindex="0" role="button"><h3>' +
          escapeHtml(topics[id].title) +
          "</h3><p>" +
          escapeHtml(topics[id].desc) +
          '</p><div class="n">' +
          sub +
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

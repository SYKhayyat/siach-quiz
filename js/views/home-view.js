import { escapeHtml } from "../html.js";
import { ROUND_SIZE } from "../store.js";
import { topicGroups, totals } from "../../data/all.js";
import { langLabel } from "../engines/index.js";

/**
 * The home screen: a brand line, one instruction, then the topics in labelled
 * rows of four. Counts come from the data, so adding a topic or a question never
 * means editing this file.
 */
export function renderHome(els, show, topics, readBest, progressOf, onStart) {
  els.circles.innerHTML = "";
  els.segG.style.width = "0";
  els.segR.style.width = "0";
  els.progFill.style.width = "0";
  els.progText.textContent = "pick a topic";
  els.scoreText.textContent = "";
  els.topicBar.textContent = "";

  const all = totals();
  const groups = topicGroups();

  const card = (id) => {
    const topic = topics[id];
    const round = Math.min(topic.questions.length, ROUND_SIZE);
    const done = progressOf(id);
    const best = readBest(id);
    const written = (topic.text || []).length;
    const codeCount = (topic.text || []).filter((q) => q.kind === "code").length;
    const langs = [...new Set((topic.text || []).filter((q) => q.kind === "code").map((q) => langLabel(q.lang)))];
    const chip = codeCount > 0 ? '<span class="chip">' + codeCount + " code · " + escapeHtml(langs.join("/")) + "</span>" : "";
    const badges = [];
    if (done > 0 && done < round) badges.push('<span class="badge resume">Resume ' + done + "/" + round + "</span>");
    if (best) badges.push('<span class="badge best">Best ' + escapeHtml(best) + "</span>");
    return (
      '<div class="card" data-t="' +
      id +
      '" tabindex="0" role="button" aria-label="Start ' +
      escapeHtml(topic.title) +
      '"><div class="chead"><h3>' +
      escapeHtml(topic.title) +
      "</h3>" +
      chip +
      '</div><p>' +
      escapeHtml(topic.desc) +
      '</p><div class="cfoot"><span class="stat">' +
      written +
      ' written</span><span class="stat">' +
      topic.questions.length +
      " multiple choice</span>" +
      (badges.length ? '<span class="badges">' + badges.join("") + "</span>" : "") +
      "</div></div>"
    );
  };

  els.home.innerHTML =
    '<div class="brandbar"><div class="mark" aria-hidden="true">CS</div><div><h1>' +
    all.topics +
    " computer-science topics</h1><p>" +
    all.questions +
    " questions · 20 per round · written answers graded on the spot, code run in your browser</p></div></div>" +
    '<nav class="portal-grid" aria-label="Choose an activity"><a class="portal-card portal-quiz" href="./"><span class="portal-kicker">Study</span><strong>Quiz</strong><small>Computer-science questions</small></a><a class="portal-card portal-games" href="https://games.siachshai.online"><span class="portal-kicker">Play</span><strong>Games</strong><small>The Cocktail Cabinet arcade</small></a></nav>' +
    '<div class="hero"><h2>Pick a topic</h2><p>Each round is 20 questions — you choose how many are written. You are marked after every one, with the reason why.</p></div>' +
    groups
      .map(
        (group) =>
          '<section class="tgroup"><div class="ghead"><h3>' +
          escapeHtml(group.title) +
          "</h3>" +
          (group.blurb ? "<span>" + escapeHtml(group.blurb) + "</span>" : "") +
          "</div><div class=\"grid\">" +
          group.ids.map(card).join("") +
          "</div></section>"
      )
      .join("");

  els.home.querySelectorAll(".card").forEach((node) => {
    node.addEventListener("click", () => onStart(node.dataset.t));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") onStart(node.dataset.t);
    });
  });
  show("home");
}

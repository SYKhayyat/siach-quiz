import { escapeHtml } from "../html.js";
import { ROUND_SIZE, normalizeTextCount, readAIEnabled } from "../store.js";

/**
 * Only one number needs choosing: how many of the 20 questions are written
 * (typed) instead of multiple choice. It is a plain text box, not a stepper —
 * type any number and it settles into 0..20.
 */
export function renderSetup(els, show, topic, maxText, savedDone, hooks) {
  const cap = Math.min(ROUND_SIZE, Math.max(0, maxText));
  const written = (topic.text || []).length;
  const codeCount = (topic.text || []).filter((q) => q.kind === "code").length;
  let count = Math.min(5, cap);

  const resume = savedDone > 0
    ? '<button class="btn" id="resumeBtn">Resume — ' + savedDone + "/" + ROUND_SIZE + " answered</button>"
    : "";

  els.setup.innerHTML =
    '<div class="hero"><h2>' +
    escapeHtml(topic.title) +
    "</h2><p>" +
    escapeHtml(topic.desc) +
    "</p></div>" +
    '<div class="setup">' +
    (resume ? '<div class="nav" style="justify-content:center;margin-bottom:14px">' + resume + "</div>" : "") +
    "<h3>How many written questions?</h3>" +
    "<p>Type any number. The rest of the 20 are multiple choice. " +
    (written > 0 ? "This topic has " + written + " written questions to draw from" + (codeCount > 0 ? " (" + codeCount + " of them are coding)" : "") + "." : "") +
    "</p>" +
    '<div class="mixrow"><label for="mixInput">Written</label>' +
    '<input id="mixInput" type="number" inputmode="numeric" min="0" max="' + cap + '" step="1" value="' + count + '" aria-describedby="mixText">' +
    '<span id="mixText" class="mixtext"></span></div>' +
    '<div class="mixquick"><button class="btn ghost" id="noneBtn">None — all multiple choice</button>' +
    '<button class="btn ghost" id="allBtn">All ' + cap + " written</button></div>" +
    '<p class="gradingnote"><b>How answers are graded:</b> written answers are checked against the accepted answer. ' +
    "Where the answer <i>is</i> the output — a literal, a value, syntax — capitalization and spelling both count: <code>none</code> is wrong for <code>None</code>, and a near miss is marked wrong with a note saying why. " +
    "Where the question asks for an idea, a small spelling slip (\"linked lis\") is accepted and the exact answer is shown. " +
    "Coding answers are run for real in your browser and judged by their tests — JavaScript, Python and Java. Nothing is uploaded.</p>" +
    '<p class="gradingnote"><label class="aitoggle"><input type="checkbox" id="aiToggle"' + (readAIEnabled() ? " checked" : "") + ">" +
    "<span><b>Local AI review (optional, beta).</b> Off by default. When on, a concept answer the rules mark wrong can be " +
    "re-checked by a small language model running <i>on this device</i> (first use downloads it once; no key, no account, nothing sent). " +
    "It can only turn a miss into a pass — never the other way — and exact answers are never re-litigated.</span></label></p>" +
    '<div class="nav"><button class="btn" id="startBtn">Start fresh</button>' +
    '<button class="btn ghost" id="setupHomeBtn">All topics</button></div>' +
    "</div>";

  const input = els.setup.querySelector("#mixInput");
  const summary = els.setup.querySelector("#mixText");

  const sync = () => {
    summary.innerHTML = "<b>" + count + "</b> written + <b>" + (ROUND_SIZE - count) + "</b> multiple choice";
    input.value = String(count);
  };

  const setCount = (next) => {
    count = normalizeTextCount(next, cap);
    sync();
    return count;
  };

  input.addEventListener("input", () => {
    const raw = input.value.trim();
    if (raw === "" || raw === "-") return; // still typing
    const clamped = normalizeTextCount(raw, cap);
    if (String(clamped) !== raw) input.value = String(clamped);
    count = clamped;
    summary.innerHTML = "<b>" + count + "</b> written + <b>" + (ROUND_SIZE - count) + "</b> multiple choice";
  });
  input.addEventListener("change", () => setCount(input.value));
  input.addEventListener("blur", () => setCount(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") hooks.onStart(count);
  });
  const aiToggle = els.setup.querySelector("#aiToggle");
  if (aiToggle) aiToggle.addEventListener("change", () => hooks.onToggleAI(aiToggle.checked));
  els.setup.querySelector("#noneBtn").addEventListener("click", () => setCount(0));
  els.setup.querySelector("#allBtn").addEventListener("click", () => setCount(cap));

  const resumeBtn = els.setup.querySelector("#resumeBtn");
  if (resumeBtn) resumeBtn.addEventListener("click", hooks.onResume);
  els.setup.querySelector("#startBtn").addEventListener("click", () => hooks.onStart(normalizeTextCount(count, cap)));
  els.setup.querySelector("#setupHomeBtn").addEventListener("click", hooks.onHome);

  sync();
  show("setup");
}

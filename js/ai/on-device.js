/**
 * Optional second opinion on written answers, using a language model that runs
 * on the student's own machine (WebLLM / WebGPU). There is no API key, no
 * server and no request: the model is downloaded once from a CDN, then every
 * answer is judged locally.
 *
 * It is OFF by default and deliberately narrow:
 *   - it is only ever offered for conceptual questions (`aiReviewAllowed`),
 *     never for exact output, numbers or code;
 *   - it can only turn a rules-based FAIL into a pass, never the other way;
 *   - if WebGPU is missing, or the download is refused, the rules stand and the
 *     UI says so, in plain words.
 *
 * `judgeAnswer` takes an optional `engine` so tests can drive the real prompt
 * and parser with a stub instead of a 500 MB download.
 */

export const AI_MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

/** Pinned, so a CDN release cannot change what students run. */
export const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm";

export function aiSupport() {
  if (typeof navigator !== "undefined" && navigator.gpu) return { ok: true, reason: "" };
  return {
    ok: false,
    reason:
      "This browser has no WebGPU, so a local model cannot run here. Use a desktop Chrome or Edge, or keep the rules-based grade.",
  };
}

/** Question text is HTML (inline <code> and friends); the model wants prose. */
export function toPlainText(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildJudgePrompt({ question, expected, given }) {
  return [
    {
      role: "system",
      content:
        "You check one written answer in a computer science quiz. Decide whether the student's answer means the same thing as the expected answer. " +
        "Judge the idea, not the wording: ignore spelling, capitalisation and word order. If the answer is wrong, misses the point, or is empty, say false. " +
        'Reply with JSON only, no prose: {"equivalent": true|false, "reason": "one short sentence"}',
    },
    {
      role: "user",
      content:
        "Question: " + toPlainText(question).slice(0, 500) +
        "\nExpected answer: " + String(expected ?? "").slice(0, 400) +
        "\nStudent answer: " + String(given ?? "").slice(0, 400),
    },
  ];
}

/** Tolerant reader: models wrap JSON in prose, fences or nothing at all. */
export function parseVerdict(text) {
  const raw = String(text ?? "").trim();
  const json = raw.match(/\{[\s\S]*\}/);
  if (json) {
    try {
      const data = JSON.parse(json[0]);
      if (typeof data.equivalent === "boolean") {
        return { equivalent: data.equivalent, reason: String(data.reason || "").trim().slice(0, 300) };
      }
    } catch {
      /* fall through to the wording heuristic */
    }
  }
  const reason = raw.replace(/\s+/g, " ").slice(0, 300);
  if (!reason) throw new Error("The local model returned nothing.");
  if (/\bno\b|not equivalent|\bincorrect\b|\bwrong\b|\bfalse\b/i.test(raw)) return { equivalent: false, reason };
  if (/\byes\b|equivalent|\bcorrect\b|\btrue\b/i.test(raw)) return { equivalent: true, reason };
  throw new Error("Could not read the local model's verdict: " + reason.slice(0, 120));
}

async function defaultEngineFactory(onProgress) {
  const webllm = await import(/* @vite-ignore */ WEBLLM_URL);
  const worker = new Worker(new URL("./ai-worker.js", import.meta.url), { type: "module" });
  const engine = await webllm.CreateWebWorkerMLCEngine(worker, AI_MODEL_ID, {
    initProgressCallback: (report) => {
      if (onProgress) onProgress(report && typeof report.progress === "number" ? report.progress : 0, (report && report.text) || "");
    },
  });
  return {
    async chat(messages) {
      const reply = await engine.chat.completions.create({ messages, temperature: 0, max_tokens: 160 });
      return reply?.choices?.[0]?.message?.content ?? "";
    },
  };
}

let enginePromise = null;
let engineFactory = defaultEngineFactory;

/** Test seam: swap the model for a stub. */
export function setAIEngineFactory(factory) {
  engineFactory = factory || defaultEngineFactory;
  enginePromise = null;
}

export function resetAIEngine() {
  engineFactory = defaultEngineFactory;
  enginePromise = null;
}

/**
 * Is a local model usable at all? Needs WebGPU in a real browser; a stubbed
 * factory (tests) counts as available so the whole path can be exercised.
 */
export function aiAvailable() {
  return engineFactory !== defaultEngineFactory || aiSupport().ok;
}

/** Load (once per session) and keep the engine alive. */
export function loadAI(onProgress) {
  if (!aiAvailable()) return Promise.reject(new Error(aiSupport().reason));
  if (!enginePromise) {
    enginePromise = engineFactory(onProgress).catch((err) => {
      enginePromise = null; // a failed load must not poison later attempts
      throw err;
    });
  }
  return enginePromise;
}

export async function judgeAnswer({ question, expected, given, engine, onProgress } = {}) {
  const messages = buildJudgePrompt({ question, expected, given });
  const active = engine || (await loadAI(onProgress));
  return parseVerdict(await active.chat(messages));
}

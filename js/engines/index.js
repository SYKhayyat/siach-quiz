/**
 * Code-question engines.
 *
 * A "code" question is answered by writing code; the answer is checked by
 * actually running it in the browser, not by guessing. Each language is backed
 * by an engine registered here, so the rest of the app only ever calls
 * `runCodeTests({ lang, code, tests })`.
 *
 *   javascript — runs in a worker (see ./javascript.js)
 *   python     — Pyodide, CPython compiled to WebAssembly (./python.js)
 *   java       — CheerpJ, a WebAssembly JVM running javac (./java.js)
 *
 * Registering a new engine (or replacing one in tests) is a one-liner.
 */

import runJavaScript from "./javascript.js";
import runPython from "./python.js";
import runJava from "./java.js";

const engines = new Map();

export function registerEngine(lang, engine) {
  engines.set(lang, engine);
  return engine;
}

export function hasEngine(lang) {
  return engines.has(lang);
}

export function engineLangs() {
  return [...engines.keys()].sort();
}

/** Human labels used in the UI. */
export const LANG_LABELS = {
  javascript: "JavaScript",
  python: "Python",
  java: "Java",
};

export function langLabel(lang) {
  return LANG_LABELS[lang] || String(lang || "code");
}

/**
 * Run a code answer against its tests.
 * Always resolves to `{ pass, message, hint }` — never throws, never hangs.
 */
export async function runCodeTests({ lang = "javascript", code, tests, prelude, onStatus, timeoutMs } = {}) {
  const engine = engines.get(lang);
  if (!engine) {
    return {
      pass: false,
      unavailable: true,
      message: "No runner is available for " + langLabel(lang) + " in this browser.",
      hint: "",
    };
  }
  try {
    const result = await engine({
      code: String(code ?? ""),
      tests: String(tests ?? ""),
      prelude: prelude ? String(prelude) : "",
      onStatus,
      timeoutMs,
    });
    return {
      pass: !!result.pass,
      unavailable: !!result.unavailable,
      message: String(result.message || "").slice(0, 400),
      hint: result.hint || "",
    };
  } catch (err) {
    return { pass: false, message: String((err && err.message) || err).slice(0, 400), hint: "" };
  }
}

registerEngine("javascript", runJavaScript);
registerEngine("python", runPython);
registerEngine("java", runJava);

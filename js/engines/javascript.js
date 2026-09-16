/**
 * JavaScript answers run inside a worker when the browser allows it, and fall
 * back to inline evaluation when it does not (older browsers, test harnesses).
 * The worker is created once and reused: creating one per question would be
 * wasteful and would throw away a warm JIT.
 */

const WORKER_TIMEOUT_MS = 3000;

let worker = null;
let nextId = 1;
const pending = new Map();

function canUseWorker() {
  return typeof Worker === "function";
}

function failAllPending(result) {
  for (const [, entry] of pending) entry.resolve(result);
  pending.clear();
}

function teardownWorker() {
  if (!worker) return;
  try {
    worker.terminate();
  } catch {
    /* already gone */
  }
  worker = null;
}

function getWorker(onStatus) {
  if (worker) return worker;
  if (onStatus) onStatus("loading");
  worker = new Worker(new URL("./js-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const data = event.data || {};
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    entry.resolve({ pass: !!data.pass, message: data.message || "" });
  };
  worker.onerror = (event) => {
    teardownWorker();
    failAllPending({
      unavailable: true,
      pass: false,
      message: "Test runner crashed: " + String((event && event.message) || "unknown error"),
    });
  };
  if (onStatus) onStatus("ready");
  return worker;
}

/**
 * Same contract as the worker, without one. The tests are wrapped in an async
 * function so `await` works here too (the concurrency questions rely on it).
 */
export async function runInline(userCode, tests) {
  try {
    const run = new Function("assert", `return (async () => {\n${String(userCode)}\n${String(tests)}\n})()`);
    await run((cond, msg) => {
      if (!cond) throw new Error(msg || "Assertion failed");
    });
    return { pass: true, message: "" };
  } catch (err) {
    return { pass: false, message: String((err && err.message) || err).slice(0, 300) };
  }
}

export default async function runJavaScript({ code, tests, onStatus }) {
  if (!canUseWorker()) {
    if (onStatus) onStatus("ready");
    return runInline(code, tests);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let id;
    let timer; // declared here so the fallback below can still settle safely
    try {
      const w = getWorker(onStatus);
      id = nextId++;
      pending.set(id, { resolve: finish });
      w.postMessage({ id, userCode: code, tests });
    } catch {
      // No worker available: evaluate inline instead of failing the student.
      if (id !== undefined) pending.delete(id);
      runInline(code, tests).then(finish);
      return;
    }
    timer = setTimeout(() => {
      pending.delete(id);
      teardownWorker();
      finish({ pass: false, message: "Timed out after 3s — check for an infinite loop." });
    }, WORKER_TIMEOUT_MS);
  });
}

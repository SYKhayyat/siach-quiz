/**
 * Python engine (main-thread side): owns the Pyodide worker.
 *
 * Loading Pyodide means downloading a few MB the first time, so the worker is
 * kept alive for the rest of the session, the first run gets a long budget, and
 * the UI gets told when the engine is warming up. If the engine cannot start we
 * say so — we never mark a code answer wrong because a download failed.
 */

const BOOT_TIMEOUT_MS = 90_000;
const RUN_TIMEOUT_MS = 20_000;

let worker = null;
let booted = false;
let nextId = 1;
const pending = new Map();

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
  booted = false;
}

function getWorker(onStatus) {
  if (worker) return worker;
  if (onStatus) onStatus("loading");
  worker = new Worker(new URL("./pyodide-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === "status") {
      if (data.state === "ready") booted = true;
      if (onStatus) onStatus(data.state);
      return;
    }
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    entry.resolve({ pass: !!data.pass, message: data.message || "" });
  };
  worker.onerror = (event) => {
    const message = "Python engine crashed: " + String((event && event.message) || "unknown error");
    teardownWorker();
    failAllPending({ unavailable: true, pass: false, message });
  };
  return worker;
}

export default async function runPython({ code, tests, prelude, onStatus }) {
  if (typeof Worker !== "function") {
    return {
      unavailable: true,
      pass: false,
      message: "Python answers need Web Workers, which this browser does not expose.",
    };
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
    try {
      const w = getWorker(onStatus);
      id = nextId++;
      pending.set(id, { resolve: finish });
      w.postMessage({ id, code, tests, prelude });
    } catch (err) {
      if (id !== undefined) pending.delete(id);
      return finish({
        unavailable: true,
        pass: false,
        message: "Could not start the Python engine: " + String((err && err.message) || err),
      });
    }
    const budget = booted ? RUN_TIMEOUT_MS : BOOT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      pending.delete(id);
      teardownWorker();
      finish({
        unavailable: !booted,
        pass: false,
        message: booted
          ? "Timed out after 20s — check for an infinite loop."
          : "The Python engine did not finish loading. Check your connection and try again.",
      });
    }, budget);
  });
}

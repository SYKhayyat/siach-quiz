/**
 * Java engine (main-thread side): owns the CheerpJ worker.
 *
 * CheerpJ boots a WebAssembly JVM and needs a one-time download, so the worker
 * is kept alive for the session and the first run gets a long budget. If the
 * JVM cannot start we say so — a code answer is never marked wrong because a
 * runtime failed to load.
 */

import { buildJavaHarness } from "./java-harness.js";

const BOOT_TIMEOUT_MS = 150_000;
const RUN_TIMEOUT_MS = 45_000;

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
  // Classic worker: CheerpJ's loader is not an ES module.
  worker = new Worker(new URL("./cheerpj-worker.js", import.meta.url));
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
    const message = "Java engine crashed: " + String((event && event.message) || "unknown error");
    teardownWorker();
    failAllPending({ unavailable: true, pass: false, message });
  };
  return worker;
}

export default async function runJava({ code, tests, onStatus }) {
  if (typeof Worker !== "function") {
    return {
      unavailable: true,
      pass: false,
      message: "Java answers need Web Workers, which this browser does not expose.",
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
      w.postMessage({ id, solution: String(code ?? ""), testsSource: buildJavaHarness(tests) });
    } catch (err) {
      if (id !== undefined) pending.delete(id);
      return finish({
        unavailable: true,
        pass: false,
        message: "Could not start the Java engine: " + String((err && err.message) || err),
      });
    }
    const timer = setTimeout(() => {
      pending.delete(id);
      teardownWorker();
      finish({
        unavailable: !booted,
        pass: false,
        message: booted
          ? "Timed out after 45s — check for an infinite loop."
          : "The Java runtime did not finish loading (it is a large one-time download). Try again on a faster connection.",
      });
    }, booted ? RUN_TIMEOUT_MS : BOOT_TIMEOUT_MS);
  });
}

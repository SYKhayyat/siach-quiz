/**
 * Rust engine: compiles and runs the answer on the public Rust playground.
 *
 * It is the only engine that is not local. The request is a plain POST with no
 * credentials, and the playground does not keep submissions, but the code does
 * leave the machine — the UI says so on every Rust question.
 *
 * A network problem is never the student's fault: if the playground cannot be
 * reached the answer is reported as `unavailable` and left unanswered.
 */

import { PLAYGROUND_URL, buildRustHarness, parseRustResult, playgroundRequest } from "./rust-harness.js";

const TIMEOUT_MS = 60_000;
const BOOT_TIMEOUT_MS = 90_000;

export default async function runRust({ code, tests, onStatus }) {
  if (typeof fetch !== "function") {
    return { pass: false, unavailable: true, message: "This browser cannot reach the Rust playground." };
  }
  const harness = buildRustHarness(code, tests);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  // The playground compiles from scratch, so the first call pays the cold start.
  const firstRun = runRust.ranOnce !== true;
  const timer = setTimeout(() => controller?.abort(), firstRun ? BOOT_TIMEOUT_MS : TIMEOUT_MS);
  if (onStatus) onStatus("loading");
  try {
    const response = await fetch(PLAYGROUND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(playgroundRequest(harness)),
      signal: controller ? controller.signal : undefined,
    });
    if (!response.ok) {
      return {
        pass: false,
        unavailable: true,
        message:
          "The Rust playground answered " + response.status + " — it may be rate-limiting. Your code is safe in the box; try again in a moment.",
      };
    }
    const result = parseRustResult(await response.json());
    runRust.ranOnce = true;
    if (onStatus) onStatus("ready");
    return { pass: result.pass, message: result.message };
  } catch (err) {
    const message = String((err && err.message) || err);
    return {
      pass: false,
      unavailable: true,
      message: /abort/i.test(String(err && err.name)) || /abort/i.test(message)
        ? "The Rust playground took too long to answer. Try again — a cold playground is slow for everyone."
        : "Could not reach the Rust playground (" + message + "). Check your connection and try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}

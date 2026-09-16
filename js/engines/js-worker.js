/**
 * Runs one JavaScript answer plus its hidden tests.
 *
 * The tests run inside an async function, so they may `await` — necessary for
 * the concurrency questions, where the point is *when* work happens, not just
 * the final value. Synchronous tests behave exactly as before.
 */
self.onmessage = async (event) => {
  const { id, userCode, tests } = event.data || {};
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg || "Assertion failed");
  };
  try {
    const run = new Function("assert", `return (async () => {\n${String(userCode)}\n${String(tests)}\n})()`);
    await run(assert);
    self.postMessage({ id, pass: true, message: "" });
  } catch (err) {
    self.postMessage({ id, pass: false, message: String((err && err.message) || err).slice(0, 300) });
  }
};

function runInline(userCode, tests) {
  try {
    new Function("assert", `${String(userCode)}\n${String(tests)}`)((cond, msg) => {
      if (!cond) throw new Error(msg || "Assertion failed");
    });
    return { pass: true, message: "" };
  } catch (err) {
    return { pass: false, message: String((err && err.message) || err).slice(0, 300) };
  }
}

export function runCodeTests(userCode, tests, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let done = false;
    let worker = null;
    let timer = 0;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        if (worker) worker.terminate();
      } catch {
        /* already gone */
      }
      resolve(result);
    };
    try {
      worker = new Worker(new URL("./test-worker.js", import.meta.url), { type: "module" });
    } catch {
      resolve(runInline(userCode, tests));
      return;
    }
    timer = setTimeout(() => finish({ pass: false, message: "Timed out after 3s — check for an infinite loop." }), timeoutMs);
    worker.onmessage = (e) => finish({ pass: !!e.data.pass, message: e.data.message || "" });
    worker.onerror = (e) => finish({ pass: false, message: String((e && e.message) || "Test runner error") });
    worker.postMessage({ userCode: String(userCode ?? ""), tests: String(tests ?? "") });
  });
}

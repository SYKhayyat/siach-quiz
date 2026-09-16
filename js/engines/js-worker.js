self.onmessage = (event) => {
  const { id, userCode, tests } = event.data || {};
  try {
    const run = new Function("assert", `${String(userCode)}\n${String(tests)}`);
    run((cond, msg) => {
      if (!cond) throw new Error(msg || "Assertion failed");
    });
    self.postMessage({ id, pass: true, message: "" });
  } catch (err) {
    self.postMessage({ id, pass: false, message: String((err && err.message) || err).slice(0, 300) });
  }
};

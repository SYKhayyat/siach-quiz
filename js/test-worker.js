self.onmessage = (e) => {
  const { userCode, tests } = e.data || {};
  try {
    const run = new Function("assert", `${String(userCode)}\n${String(tests)}`);
    run((cond, msg) => {
      if (!cond) throw new Error(msg || "Assertion failed");
    });
    self.postMessage({ pass: true, message: "" });
  } catch (err) {
    self.postMessage({ pass: false, message: String((err && err.message) || err).slice(0, 300) });
  }
};

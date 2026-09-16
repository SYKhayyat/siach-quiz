/**
 * Python answer grading: pure helpers shared by the browser worker and the
 * Node test suite (so the same script assembly is actually exercised in CI).
 *
 * The shape mirrors the pattern used by the standalone "20-Problem Trial"
 * pages: the student's code and the hidden tests are concatenated, the tests
 * run inside a function, and a `try/except` turns the first failure into a
 * concise message. Nothing is guessed: the code really executes.
 */

export const PYODIDE_VERSION = "314.0.7";
export const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export const PASS = "PASS";
export const FAIL = "FAIL";
export const ERROR = "ERROR";

export function indentBlock(src, spaces = 4) {
  const pad = " ".repeat(spaces);
  return String(src ?? "")
    .replace(/\s+$/, "")
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : pad + line))
    .join("\n");
}

/**
 * A source string as a Python string literal, so the student's code can be
 * exec'd inside the try block. JSON escaping is valid Python string escaping.
 */
export function pyLiteral(source) {
  return JSON.stringify(String(source ?? ""));
}

/**
 * Assemble the script that is handed to Pyodide.
 *
 * The student's code is exec'd *inside* the try, so a syntax error is reported
 * as a message to the student instead of escaping as an engine failure.
 */
export function buildPythonScript({ code = "", tests = "", prelude = "" } = {}) {
  const body = indentBlock(tests, 8).trim() === "" ? "        pass" : indentBlock(tests, 8);
  return [
    "_result = None",
    "try:",
    ...(prelude
      ? ["    # ---- provided code (do not change) ----", "    exec(compile(" + pyLiteral(prelude) + ", '<provided>', 'exec'), globals())"]
      : []),
    "    # ---- your solution ----",
    "    exec(compile(" + pyLiteral(code) + ", '<your solution>', 'exec'), globals())",
    "    # ---- hidden tests ----",
    "    def _run_tests():",
    body,
    "    _run_tests()",
    "    _result = 'PASS'",
    "except AssertionError as _e:",
    "    _result = 'FAIL: ' + str(_e)",
    "except SyntaxError as _e:",
    "    _result = 'ERROR: SyntaxError: ' + str(_e.msg) + ' on line ' + str(_e.lineno)",
    "except Exception as _e:",
    "    _result = 'ERROR: ' + type(_e).__name__ + ': ' + str(_e)",
    "_result",
  ].join("\n");
}

/** Turn Pyodide's result string (+ captured stdout) into a verdict. */
export function parsePythonResult(raw, stdout = "") {
  const text = raw == null ? "" : String(raw);
  const printed = String(stdout || "").trim();
  if (text === PASS) return { pass: true, message: printed.slice(0, 300) };
  const body = text.replace(/^(FAIL|ERROR):\s*/, "");
  const prefix = text.startsWith(ERROR) ? "Python error: " : "";
  const message = (prefix + body).trim() || "A test failed.";
  return {
    pass: false,
    message: (printed ? printed + "\n" + message : message).slice(0, 400),
  };
}

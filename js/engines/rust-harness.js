/**
 * Rust answer grading: pure helpers shared by the browser runner and the Node
 * test suite.
 *
 * A browser cannot compile Rust, so — exactly like the standalone Rust tutorial
 * page — the source is compiled by the public Rust playground
 * (play.rust-lang.org/execute, which allows cross-origin calls). The student
 * writes a function; the hidden tests are Rust statements that run inside a
 * generated `main`, and a marker line proves the tests finished.
 *
 * The trade-off is deliberate and stated in the UI: Rust answers are the one
 * thing on this site that leaves the machine. Everything else (JavaScript,
 * Python, Java) runs locally.
 */

export const PLAYGROUND_URL = "https://play.rust-lang.org/execute";
export const PLAYGROUND_EDITION = "2021";
export const PASS_MARK = "__PASS__";

/** The source sent to the playground: the answer plus a generated main(). */
export function buildRustHarness(code, tests) {
  const body = String(tests ?? "")
    .replace(/\s+$/, "")
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : "    " + line))
    .join("\n");
  return [
    String(code ?? "").replace(/\s+$/, ""),
    "",
    "fn main() {",
    body.trim() === "" ? "    // no tests" : body,
    '    println!("' + PASS_MARK + '");',
    "}",
    "",
  ].join("\n");
}

/** The playground's JSON body for one compile+run. */
export function playgroundRequest(harness) {
  return {
    channel: "stable",
    mode: "debug",
    edition: PLAYGROUND_EDITION,
    crateType: "bin",
    tests: false,
    code: harness,
  };
}

/** rustc's progress chatter is noise; keep what a student can act on. */
export function tidyRustMessage(text) {
  const lines = String(text ?? "").split("\n");
  const keep = lines.filter(
    (line) => !/^\s*(Compiling|Finished|Running|warning: unused)\b/.test(line) && line.trim() !== ""
  );
  return (keep.length > 0 ? keep : lines).join("\n").trim().slice(0, 400);
}

/**
 * Turn the playground's response into a verdict.
 * `success` is rustc's exit status; the marker proves the tests ran to the end.
 */
export function parseRustResult(payload) {
  const data = payload || {};
  const stdout = String(data.stdout ?? "");
  const stderr = String(data.stderr ?? "");
  if (data.success && stdout.includes(PASS_MARK)) return { pass: true, message: "" };
  const detail = data.success ? stdout : stderr || stdout;
  return { pass: false, message: tidyRustMessage(detail) || "Tests failed — compare with the expected approach." };
}

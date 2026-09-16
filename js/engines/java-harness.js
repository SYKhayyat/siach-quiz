/**
 * Java answer grading: pure helpers shared by the browser worker and the Node
 * test suite.
 *
 * Java cannot be interpreted from source, so a Java answer is checked the same
 * way the JDK checks it: `javac` compiles the student's class in the browser
 * (CheerpJ ships a WebAssembly JVM), then a generated test class runs it.
 *
 * The student always writes a class named `Solution`; the hidden tests are
 * plain Java statements using the assertion helpers below.
 */

export const CHEERPJ_VERSION = "4.3";
export const CHEERPJ_LOADER_URL = `https://cjrtnc.leaningtech.com/${CHEERPJ_VERSION}/loader.js`;

/**
 * javac itself lives in the JDK's tools.jar, which is not part of the Java SE
 * runtime. It is a one-time ~18 MB asset served from this site (see README).
 */
export const JAVA_TOOLS_JAR = "vendor/jdk/tools.jar";

export const PASS_MARK = "__PASS__";
export const FAIL_MARK = "__FAIL__";

export function indentBlock(src, spaces = 4) {
  const pad = " ".repeat(spaces);
  return String(src ?? "")
    .replace(/\s+$/, "")
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : pad + line))
    .join("\n");
}

/** The generated test driver wrapped around the question's hidden tests. */
export function buildJavaHarness(tests) {
  const body = indentBlock(tests, 6);
  return [
    "import java.util.*;",
    "",
    "public class SolutionTest {",
    '  static void assertTrue(boolean cond, String msg) { if (!cond) throw new AssertionError(msg); }',
    '  static void assertEquals(Object a, Object b, String msg) {',
    '    if (!java.util.Objects.equals(a, b)) throw new AssertionError(msg + " — expected " + b + ", got " + a);',
    "  }",
    "  public static void main(String[] args) {",
    "    try {",
    body.trim() === "" ? "      // no tests" : body,
    '      System.out.println("' + PASS_MARK + '");',
    "    } catch (Throwable t) {",
    '      System.out.println("' + FAIL_MARK + ' " + t.getMessage());',
    "    }",
    "  }",
    "}",
  ].join("\n");
}

/** Turn the run phase's captured console output into a verdict. */
export function parseJavaOutput(stdout) {
  const text = String(stdout ?? "");
  const lines = text.split("\n").map((l) => l.trim());
  const failLine = lines.find((l) => l.startsWith(FAIL_MARK));
  if (failLine) {
    return { pass: false, message: failLine.slice(FAIL_MARK.length).trim() || "A test failed." };
  }
  if (lines.includes(PASS_MARK)) return { pass: true, message: "" };
  return {
    pass: false,
    message: text.trim() ? text.trim().slice(0, 400) : "No test output produced — did the program exit early?",
  };
}

/**
 * Java worker: runs the student's class under CheerpJ, a WebAssembly JVM.
 *
 * Classic worker on purpose — CheerpJ's loader is a classic script, so it is
 * pulled in with importScripts (module workers cannot use importScripts).
 *
 * Flow (verified against CheerpJ's filesystem docs and a working in-browser
 * Java grader): write the sources into /str, compile with tools.jar javac into
 * /files, then run the test class from /files and read the console output.
 */

/* Keep in sync with CHEERPJ_LOADER_URL in ./java-harness.js (a test enforces it). */
importScripts("https://cjrtnc.leaningtech.com/4.3/loader.js");

var SOURCE_FILE = "/str/Solution.java";
var TEST_FILE = "/str/SolutionTest.java";
var CLASS_OUT = "/files/";
var TOOLS_JAR = "/app/vendor/jdk/tools.jar";
var PASS_MARK = "__PASS__";
var FAIL_MARK = "__FAIL__";

var lines = [];
var initPromise = null;
var initialized = false;

function captureConsole() {
  ["log", "warn", "error", "info"].forEach(function (key) {
    var original = console[key] ? console[key].bind(console) : function () {};
    console[key] = function () {
      lines.push(Array.prototype.map.call(arguments, String).join(" "));
      original.apply(null, arguments);
    };
  });
}

function ensureInit() {
  if (!initPromise) {
    self.postMessage({ type: "status", state: "loading" });
    captureConsole();
    initPromise = cheerpjInit().then(function () {
      initialized = true;
      self.postMessage({ type: "status", state: "ready" });
    });
  }
  return initPromise;
}

async function checkToolsJar() {
  if (typeof fetch !== "function") return true;
  try {
    var res = await fetch("/app/vendor/jdk/tools.jar".slice(4), { method: "HEAD" });
    return res.ok;
  } catch {
    return true; // offline or blocked: let javac report the real error
  }
}

self.onmessage = async function (event) {
  var data = event.data || {};
  if (!data.id) return;
  try {
    await ensureInit();
    var addFile = typeof cheerpOSAddStringFile === "function" ? cheerpOSAddStringFile : cheerpjAddStringFile;
    if (typeof addFile !== "function") {
      self.postMessage({ id: data.id, pass: false, message: "This CheerpJ build is missing its file API." });
      return;
    }
    var encoder = new TextEncoder();
    addFile(SOURCE_FILE, encoder.encode(String(data.solution || "")));
    addFile(TEST_FILE, encoder.encode(String(data.testsSource || "")));

    var compileClassPath = TOOLS_JAR;
    lines.length = 0;
    var compileExit = await cheerpjRunMain(
      "com.sun.tools.javac.Main",
      compileClassPath,
      "-d",
      CLASS_OUT,
      "-cp",
      compileClassPath,
      SOURCE_FILE,
      TEST_FILE
    );
    var compileOut = lines.join("\n").trim();
    if (compileExit !== 0) {
      var hint = compileOut || "javac exited with code " + compileExit;
      var missingTools = !compileOut && !(await checkToolsJar());
      if (missingTools) {
        hint = "The Java runner needs " + TOOLS_JAR.slice(5) + " (see README) — it is not on this server yet.";
      }
      self.postMessage({
        id: data.id,
        pass: false,
        unavailable: missingTools,
        message: (missingTools ? hint : "Compilation failed:\n" + hint).slice(0, 400),
      });
      return;
    }

    lines.length = 0;
    var runExit = await cheerpjRunMain("SolutionTest", CLASS_OUT + ":" + compileClassPath);
    var out = lines.join("\n").trim();
    var failAt = out.split("\n").map(function (l) { return l.trim(); }).find(function (l) { return l.indexOf(FAIL_MARK) === 0; });
    if (failAt) {
      self.postMessage({ id: data.id, pass: false, message: failAt.slice(FAIL_MARK.length).trim() || "A test failed." });
      return;
    }
    if (out.split("\n").map(function (l) { return l.trim(); }).indexOf(PASS_MARK) >= 0) {
      self.postMessage({ id: data.id, pass: true, message: "" });
      return;
    }
    self.postMessage({
      id: data.id,
      pass: false,
      message: (out || "No test output produced (exit code " + runExit + ").").slice(0, 400),
    });
  } catch (err) {
    self.postMessage({
      id: data.id,
      pass: false,
      unavailable: !initialized,
      message: (initialized ? "Java engine failed: " : "The Java runtime did not start: ") +
        String((err && err.message) || err).slice(0, 300),
    });
  }
};

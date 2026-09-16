#!/usr/bin/env node
/**
 * Real-browser verification for the parts jsdom cannot run:
 * Pyodide (Python in WebAssembly), CheerpJ (a WebAssembly JVM running javac),
 * the Rust playground, the written-answer policy across all the real data, the
 * opt-in local-AI gating, and the Web Worker code path.
 *
 * Usage:
 *   node tools/browser-check.mjs [baseUrl]
 *
 * It serves the repo itself (a range-capable static server, because CheerpJ
 * fetches jar bytes by range), so there is nothing to start by hand. Pass a
 * baseUrl to check something already running instead.
 *
 * Requirements: Chromium (or CHROMIUM_BIN) and, for the Java checks,
 * vendor/jdk/tools.jar. Checks whose requirements are missing are skipped with
 * a printed reason rather than failing.
 *
 * Set ONLY=python,java to run a subset (the Java checks are slow because the
 * WebAssembly JVM is a big one-time download).
 */
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JAVA_SOLUTIONS, JS_SOLUTIONS, PYTHON_SOLUTIONS, RUST_SOLUTIONS } from "../tests/helpers/fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.CDP_PORT || 9333);
const SERVE_PORT = Number(process.env.SERVE_PORT || 8123);
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const TOOLS_JAR = path.join(ROOT, "vendor", "jdk", "tools.jar");

/** Every language that must have a real runner. Rust's runs off-machine. */
const EXPECTED_ENGINES = ["java", "javascript", "python", "rust"];

/** Filled in from the page at boot, so adding a topic never edits this file. */
let TOPIC_COUNT = 0;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".jar": "application/java-archive",
  ".zip": "application/zip",
  ".data": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** Static file server with byte-range support (CheerpJ needs it for jars). */
function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (path.relative(ROOT, file).startsWith("..")) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (url.pathname === "/") file = path.join(ROOT, "index.html");
    let size;
    try {
      const st = statSync(file);
      if (!st.isFile()) throw new Error("not a file");
      size = st.size;
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { "content-range": "bytes */" + size }).end();
        return;
      }
      res.writeHead(206, {
        "content-type": type,
        "content-length": end - start + 1,
        "content-range": "bytes " + start + "-" + end + "/" + size,
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", "cache-control": "no-store" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(SERVE_PORT, "127.0.0.1", () => resolve(server));
  });
}

/* ------------------------------- helpers ------------------------------- */

const results = [];
let current = null;

function wanted(name) {
  if (ONLY.length === 0) return true;
  const lower = name.toLowerCase();
  return ONLY.some((tag) => lower.includes(tag));
}

async function check(name, fn) {
  if (!wanted(name)) {
    results.push({ name, ok: true, skipped: true, reason: "not in ONLY=" + ONLY.join(",") });
    return true;
  }
  current = { name, ok: false, notes: [] };
  results.push(current);
  process.stdout.write("\n▶ " + name + "\n");
  try {
    await fn(current);
    current.ok = true;
    process.stdout.write("  ✔ passed\n");
  } catch (err) {
    current.ok = false;
    process.stdout.write("  ✖ " + (err && err.message ? err.message : String(err)) + "\n");
  }
  return current.ok;
}

function skip(name, reason) {
  const entry = { name, ok: true, skipped: true, reason };
  if (!wanted(name)) entry.reason = "not in ONLY=" + ONLY.join(",");
  results.push(entry);
  process.stdout.write("\n▶ " + name + "\n  ⃝ skipped: " + reason + "\n");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function which(bin) {
  const res = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : null;
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === "string" ? event.data : "");
      } catch {
        return;
      }
      if (msg.id) {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) entry.reject(new Error(msg.error.message || "CDP error"));
        else entry.resolve(msg.result);
        return;
      }
      for (const listener of this.listeners) listener(msg);
    };
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const fail = (err) => reject(err instanceof Error ? err : new Error("CDP socket failed"));
      ws.onopen = () => resolve(new CDP(ws));
      ws.onerror = (event) => fail(event?.error || new Error("CDP socket error"));
    });
  }

  on(fn) {
    this.listeners.add(fn);
  }

  send(method, params = {}, sessionId = null, timeoutMs = 30_000) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(method + " timed out after " + timeoutMs + "ms"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

/* --------------------------- chromium launcher --------------------------- */

async function launchChromium(bin) {
  const profile = path.join(ROOT, ".tools", "chromium-profile");
  mkdirSync(profile, { recursive: true });
  const child = spawn(bin, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + profile,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return { child, wsUrl: (await res.json()).webSocketDebuggerUrl };
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  child.kill("SIGKILL");
  throw new Error("chromium did not expose CDP on port " + PORT + "\n" + log.join("").slice(-2000));
}

/* ------------------------------- main flow ------------------------------- */

const chromiumBin = process.env.CHROMIUM_BIN || which("chromium") || which("chromium-browser") || which("google-chrome");
if (!chromiumBin) {
  console.error("No chromium found. Set CHROMIUM_BIN or install chromium (e.g. nix-shell -p chromium).");
  process.exit(2);
}
const ownServer = process.argv[2] ? null : await startServer();
const BASE_URL = process.argv[2] || "http://127.0.0.1:" + SERVE_PORT;

console.log("chromium: " + chromiumBin);
console.log("base url: " + BASE_URL + (ownServer ? " (served from the repo)" : ""));
if (ONLY.length > 0) console.log("only: " + ONLY.join(", "));

const { child, wsUrl } = await launchChromium(chromiumBin);
const cdp = await CDP.connect(wsUrl);

const pageErrors = [];
const consoleLines = [];

// One page target, driven through a flattened session.
const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
const sess = sessionId;

cdp.on((msg) => {
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params?.exceptionDetails;
    pageErrors.push(d?.exception?.description || d?.text || "unknown page error");
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = (msg.params?.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    consoleLines.push(msg.params.type + ": " + text);
  }
});

const evaluate = async (expression, timeoutMs = 60_000) => {
  const res = await cdp.send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true, userGesture: true },
    sess,
    timeoutMs
  );
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error("page exception: " + (d.exception?.description || d.text || "unknown"));
  }
  return res.result.value;
};

/** Click a selector inside the page (real DOM click, same as a user). */
const clickSel = (selector) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);

/** Wait until an in-page expression is truthy. */
async function waitForPage(expression, { timeoutMs = 60_000, label = expression, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true;
    await sleep(intervalMs);
  }
  throw new Error("timed out waiting for: " + label);
}

await cdp.send("Page.enable", {}, sess);
await cdp.send("Runtime.enable", {}, sess);
await cdp.send("Network.enable", {}, sess);

/**
 * Load the app once, before any check runs. Every check below evaluates in the
 * page, so the page has to be the real document even when ONLY filters the
 * checks down (an about:blank context cannot resolve the app's modules).
 */
async function bootPage() {
  const loaded = new Promise((resolve) => cdp.on((m) => m.method === "Page.loadEventFired" && resolve()));
  await cdp.send("Page.navigate", { url: BASE_URL }, sess);
  await loaded;
  await waitForPage("document.querySelectorAll('.card').length > 0", { label: "the topic cards" });
  TOPIC_COUNT = await evaluate("document.querySelectorAll('.card').length");
  await sleep(500); // let late module work settle
}

await bootPage();

await check("the app loads in a real browser without page errors", async () => {
  if (pageErrors.length > 0) throw new Error("page errors: " + pageErrors.join(" | "));
  const cards = await evaluate("document.querySelectorAll('.card').length");
  if (cards !== TOPIC_COUNT) throw new Error("expected " + TOPIC_COUNT + " topic cards, got " + cards);
  const groups = await evaluate("document.querySelectorAll('.tgroup').length");
  if (groups < 3) throw new Error("expected the topics grouped into sections, got " + groups);
  const sections = await evaluate("[...document.querySelectorAll('.tgroup .ghead h3')].map((h) => h.textContent).join(' / ')");
  const listed = await evaluate("[...document.querySelectorAll('.card h3')].map((h) => h.textContent).join(', ')");
  const blurbs = await evaluate("document.querySelector('.brandbar p').textContent");
  current.notes.push(cards + " topic cards in " + groups + " labelled rows");
  current.notes.push("sections: " + sections);
  current.notes.push("topics: " + listed);
  current.notes.push("intro: " + blurbs);
});

await check("the app's modules resolve in the page (absolute and relative)", async () => {
  const info = await evaluate(`(async () => {
    const out = {};
    try {
      out.topics = Object.keys((await import('/data/all.js')).topics).length;
      out.engines = (await import('/js/engines/index.js')).engineLangs();
    } catch (e) {
      out.error = String((e && e.message) || e);
    }
    return out;
  })()`);
  if (info.error) throw new Error(info.error);
  if (info.topics !== TOPIC_COUNT) throw new Error("expected " + TOPIC_COUNT + " topics from /data/all.js, got " + info.topics);
  if (JSON.stringify(info.engines) !== JSON.stringify(EXPECTED_ENGINES)) {
    throw new Error("engines: " + JSON.stringify(info.engines));
  }
  current.notes.push(TOPIC_COUNT + " topics and " + info.engines.join(", ") + " resolve");
});

/**
 * The home screen must look deliberate at every width: full rows of four, cards
 * of equal height inside a row, and never a horizontal scrollbar. This is the
 * only way to check a layout without a pair of eyes.
 */
await check("the topic grid stays even at every width", async (c) => {
  const notes = [];
  for (const width of [1280, 1000, 900, 700, 420]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false }, sess);
    await sleep(150);
    const info = await evaluate(`(() => {
      const grid = document.querySelector('.grid');
      const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
      const rows = [...document.querySelectorAll('.tgroup')].map((g) => g.querySelectorAll('.card').length);
      const spread = [...document.querySelectorAll('.tgroup')].map((g) => {
        const heights = [...g.querySelectorAll('.card')].map((card) => Math.round(card.getBoundingClientRect().height));
        return Math.max(...heights) - Math.min(...heights);
      });
      const widths = [...document.querySelectorAll('.tgroup')].map((g) => {
        const boxes = [...g.querySelectorAll('.card')].map((card) => Math.round(card.getBoundingClientRect().width));
        return Math.max(...boxes) - Math.min(...boxes);
      });
      return { cols, rows, spread, widths, overflow: document.documentElement.scrollWidth - window.innerWidth };
    })()`);
    const where = width + "px";
    if (TOPIC_COUNT % info.cols !== 0) throw new Error(where + ": " + info.cols + " columns leave a ragged last row");
    if (info.rows.some((n) => n % info.cols !== 0)) {
      throw new Error(where + ": a section's " + info.rows.join("/") + " cards leave a ragged row at " + info.cols + " columns");
    }
    if (info.spread.some((d) => d > 2)) throw new Error(where + ": cards in a row differ in height by " + info.spread.join("/") + "px");
    if (info.widths.some((d) => d > 2)) throw new Error(where + ": cards in a row differ in width by " + info.widths.join("/") + "px");
    if (info.overflow > 1) throw new Error(where + ": the page scrolls sideways by " + info.overflow + "px");
    notes.push(where + " → " + info.cols + " across, " + TOPIC_COUNT / info.cols + " rows");
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride", {}, sess);
  await sleep(150);
  c.notes.push(notes.join("; "));
});

await check("all four engines are registered in the browser", async () => {
  const langs = await evaluate("(async () => (await import('/js/engines/index.js')).engineLangs())()");
  const expected = EXPECTED_ENGINES;
  if (JSON.stringify(langs) !== JSON.stringify(expected)) throw new Error("got " + JSON.stringify(langs));
  current.notes.push(langs.join(", "));
});

await check("JavaScript answers run in a Worker and a runaway loop is killed", async () => {
  const hasWorker = await evaluate("typeof Worker === 'function'");
  if (!hasWorker) throw new Error("no Worker in this browser, so the inline fallback would be used");
  const result = await evaluate(
    `(async () => {
       const { runCodeTests } = await import('/js/engines/index.js');
       const started = Date.now();
       const timedOut = await runCodeTests({ lang: 'javascript', code: 'while (true) {}', tests: 'assert(true)' });
       return { message: timedOut.message, ms: Date.now() - started, pass: timedOut.pass };
     })()`,
    30_000
  );
  if (result.pass) throw new Error("an infinite loop must not pass");
  if (!/Timed out/.test(result.message)) throw new Error("expected a timeout message, got: " + result.message);
  if (result.ms > 10_000) throw new Error("the loop was not killed promptly (" + result.ms + "ms)");
  current.notes.push("runaway loop killed in " + result.ms + "ms: " + result.message);
});

await check("JavaScript coding questions pass with a reference solution", async (c) => {
  const payload = JSON.stringify(JS_SOLUTIONS);
  const outcome = await evaluate(
    `(async () => {
       const { topics } = await import('/data/all.js');
       const { runCodeTests } = await import('/js/engines/index.js');
       const solutions = ${payload};
       const out = [];
       for (const topic of Object.values(topics)) {
         for (const q of topic.text || []) {
           if (q.kind !== 'code' || (q.lang || 'javascript') !== 'javascript') continue;
           const key = Object.keys(solutions).find(k => q.q.includes(k));
           if (!key) continue;
           const r = await runCodeTests({ lang: 'javascript', code: solutions[key], tests: q.tests });
           out.push({ prompt: q.q.slice(0, 40), pass: r.pass, message: r.message });
         }
       }
       return out;
     })()`,
    60_000
  );
  const failures = outcome.filter((o) => !o.pass);
  if (outcome.length === 0) throw new Error("no JavaScript coding questions were found");
  if (failures.length > 0) throw new Error("failures: " + JSON.stringify(failures.slice(0, 3)));
  c.notes.push(outcome.length + " JavaScript questions passed in-browser");
});

/* ---- Python (Pyodide) ---- */

const pythonQuestions = await evaluate(
  `(async () => {
     const { topics } = await import('/data/all.js');
     return topics.python.text.filter(q => q.kind === 'code' && q.lang === 'python').map(q => ({ q: q.q, tests: q.tests, starter: q.starter }));
   })()`
);

await check("Python answers really run (Pyodide) and report pass/fail", async (c) => {
  const statuses = [];
  const solution = PYTHON_SOLUTIONS["Write middle(s)"];
  const data = JSON.stringify({ questions: pythonQuestions, solution, solutionKey: "Write middle(s)" });
  const outcome = await evaluate(
    `(async () => {
       const { runCodeTests } = await import('/js/engines/index.js');
       const info = ${data};
       const answerKey = info.solutionKey;
       const question = info.questions.find(q => q.q.includes(answerKey));
       const statuses = [];
       const onStatus = (s) => statuses.push(s);
       const good = await runCodeTests({ lang: 'python', code: info.solution, tests: question.tests, onStatus });
       let bad = null;
       for (const q of info.questions) {
         const starter = q.starter;
         const r = await runCodeTests({ lang: 'python', code: starter, tests: q.tests });
         if (!r.pass) { bad = { prompt: q.q.slice(0, 40), message: r.message }; break; }
       }
       return { good, bad, statuses };
     })()`,
    240_000
  );
  statuses.push(...(outcome.statuses || []));
  if (!outcome.good.pass) throw new Error("a correct Python answer failed: " + outcome.good.message);
  if (!outcome.bad || outcome.bad.message.length === 0) throw new Error("a wrong Python answer produced no message");
  if (!statuses.includes("loading")) throw new Error("the loading status was never reported: " + JSON.stringify(statuses));
  if (!statuses.includes("ready")) throw new Error("the ready status was never reported: " + JSON.stringify(statuses));
  c.notes.push("engine status: " + statuses.join(" -> "));
  c.notes.push("wrong answer message: " + outcome.bad.message.split("\n")[0].slice(0, 90));
});

await check("the Python engine reports a syntax error as a message", async () => {
  const result = await evaluate(
    `(async () => {
       const { runCodeTests } = await import('/js/engines/index.js');
       return runCodeTests({ lang: 'python', code: 'def broken(:\\n  pass', tests: 'assert True' });
     })()`,
    120_000
  );
  if (result.pass) throw new Error("broken syntax must not pass");
  if (result.unavailable) throw new Error("a syntax error must not look like a broken engine");
  if (!/SyntaxError/.test(result.message)) throw new Error("expected a SyntaxError message, got: " + result.message);
  current.notes.push(result.message.split("\n")[0].slice(0, 90));
});

/* ---- Java (CheerpJ + javac) ---- */

let toolsJarOk = false;
try {
  toolsJarOk = statSync(TOOLS_JAR).size > 1_000_000;
} catch {
  toolsJarOk = false;
}

if (!toolsJarOk) {
  skip("Java answers really run (CheerpJ + javac)", "vendor/jdk/tools.jar is missing (see vendor/jdk/README.md)");
} else {
  await check("Java answers really run (CheerpJ + javac) and report pass/fail", async (c) => {
    const javaQuestions = await evaluate(
      `(async () => {
         const { topics } = await import('/data/all.js');
         return topics.java.text.filter(q => q.kind === 'code' && q.lang === 'java').map(q => ({ q: q.q, tests: q.tests, starter: q.starter }));
       })()`
    );
    const statuses = [];
    const payload = JSON.stringify({
      questions: javaQuestions,
      solutions: JAVA_SOLUTIONS,
    });
    const outcome = await evaluate(
      `(async () => {
         const { runCodeTests } = await import('/js/engines/index.js');
         const info = ${payload};
         const statuses = [];
         const onStatus = (s) => statuses.push(s);
         const results = [];
         for (const q of info.questions) {
           const key = Object.keys(info.solutions).find(k => q.q.includes(k));
           if (!key) { results.push({ prompt: q.q.slice(0, 40), skipped: true }); continue; }
           const good = await runCodeTests({ lang: 'java', code: info.solutions[key], tests: q.tests, onStatus });
           const bad = await runCodeTests({ lang: 'java', code: q.starter, tests: q.tests });
           results.push({ prompt: q.q.slice(0, 40), good: good.pass, goodMessage: good.message, badPass: bad.pass, badMessage: bad.message });
         }
         return { results, statuses };
       })()`,
      600_000
    );
    statuses.push(...(outcome.statuses || []));
    const ran = outcome.results.filter((r) => !r.skipped);
    const wrong = ran.filter((r) => !r.good || r.badPass);
    if (ran.length === 0) throw new Error("no Java question could be matched to a reference solution");
    if (wrong.length > 0) throw new Error("Java verdicts wrong: " + JSON.stringify(wrong.slice(0, 2)));
    if (!statuses.includes("ready")) throw new Error("the Java engine never reported ready");
    c.notes.push(ran.length + " Java questions compiled and ran in the browser");
    c.notes.push("engine status: " + (statuses.includes("loading") ? "loading -> ready" : statuses.join(" -> ")));
  });
}

/* ---- Rust (the public playground) ---- */

await check("Rust answers really compile and run (play.rust-lang.org)", async (c) => {
  const rustQuestions = await evaluate(
    `(async () => {
       const { topics } = await import('/data/all.js');
       return topics.rust.text.filter(q => q.kind === 'code' && q.lang === 'rust').map(q => ({ q: q.q, tests: q.tests, starter: q.starter }));
     })()`
  );
  if (rustQuestions.length === 0) throw new Error("no Rust coding questions were found");
  const payload = JSON.stringify({ questions: rustQuestions, solutions: RUST_SOLUTIONS });
  const outcome = await evaluate(
    `(async () => {
       const { runCodeTests } = await import('/js/engines/index.js');
       const info = ${payload};
       const statuses = [];
       const results = [];
       for (const q of info.questions) {
         const key = Object.keys(info.solutions).find(k => q.q.includes(k));
         if (!key) { results.push({ prompt: q.q.slice(0, 40), skipped: true }); continue; }
         const good = await runCodeTests({ lang: 'rust', code: info.solutions[key], tests: q.tests, onStatus: (s) => statuses.push(s) });
         const bad = await runCodeTests({ lang: 'rust', code: q.starter, tests: q.tests });
         results.push({ prompt: q.q.slice(0, 40), good: good.pass, goodMessage: good.message, badPass: bad.pass });
       }
       const broken = await runCodeTests({ lang: 'rust', code: 'fn oops( {', tests: 'assert!(true);' });
       return { results, statuses, broken };
     })()`,
    300_000
  );
  if (outcome.broken.unavailable) throw new Error("a Rust syntax error must not look like an outage");
  if (!/error/i.test(outcome.broken.message)) throw new Error("expected a compiler message, got: " + outcome.broken.message);
  const ran = outcome.results.filter((r) => !r.skipped);
  const wrong = ran.filter((r) => !r.good || r.badPass);
  if (ran.length === 0) throw new Error("no Rust question could be matched to a reference solution");
  if (wrong.length > 0) throw new Error("Rust verdicts wrong: " + JSON.stringify(wrong.slice(0, 2)));
  c.notes.push(ran.length + " Rust questions compiled and ran on the playground");
  c.notes.push("a syntax error is reported as: " + outcome.broken.message.split("\n")[0].slice(0, 80));
});

/* ---- written-answer policy (real browser, real data) ---- */

await check("every written answer is marked the way its question deserves", async (c) => {
  const report = await evaluate(
    `(async () => {
       const { topics } = await import('/data/all.js');
       const { evaluate, typoPolicy, editDistance, typoAllowance, normalizeText } = await import('/js/check.js');
       const out = { conceptOk: 0, concept: 0, exactOk: 0, exact: 0, wrong: [] };
       for (const [tid, topic] of Object.entries(topics)) {
         for (const q of topic.text || []) {
           const check = q.check;
           const values = check && check.values;
           if (!check || !values || !values[0] || Array.isArray(q.blanks) || q.kind === 'code') continue;
           const target = values[0];
           const slip = target.slice(0, -1);
           if (slip === target || values.includes(slip)) continue;  // nothing to compare
           // The tolerance the grader would offer for this answer, if any.
           const withinTolerance = editDistance(normalizeText(target), normalizeText(slip)) <= typoAllowance(normalizeText(target));
           const verdict = evaluate(check, slip);
           if (typoPolicy(check) === 'accept') {
             out.concept += 1;
             if (withinTolerance && verdict.ok && verdict.soft) out.conceptOk += 1;
             else if (!withinTolerance && !verdict.ok) out.conceptOk += 1;
             else out.wrong.push(tid + ': near miss on \"' + target + '\" -> ok=' + verdict.ok + ', tolerance=' + withinTolerance + ', soft=' + verdict.soft);
             if (evaluate(check, 'qwertyuiopzx').ok) out.wrong.push(tid + ': accepted nonsense for \"' + target + '\"');
           } else {
             out.exact += 1;
             if (!verdict.ok) out.exactOk += 1;
             else out.wrong.push(tid + ': a one-character slip of \"' + target + '\" was accepted');
           }
         }
       }
       return out;
     })()`,
    60_000
  );
  if (report.wrong.length > 0) throw new Error(report.wrong.slice(0, 3).join(" | "));
  if (report.concept === 0 || report.exact === 0) throw new Error("no questions were exercised: " + JSON.stringify(report));
  c.notes.push(report.conceptOk + "/" + report.concept + " conceptual answers follow the note-or-wrong rule");
  c.notes.push(report.exactOk + "/" + report.exact + " exact-answer slips rejected");
});

await check("the optional local AI is opt-in, and cannot help => cannot change a mark", async (c) => {
  const enabled = await evaluate("(async () => (await import('/js/store.js')).readAIEnabled())()");
  if (enabled) throw new Error("the local AI must be off until a student turns it on");

  // Turn it on, block the model's CDN, then walk to a conceptual question and
  // ask for a review. This is the "it cannot run" path, which must degrade in
  // plain words without silently changing the student's mark.
  await evaluate(`(() => { window.localStorage.setItem('csq-ai-review', 'on'); return true; })()`);
  await cdp.send("Network.setBlockedURLs", { urls: ["*web-llm*", "*esm.run*"] }, sess);
  await evaluate(`(() => { const c = document.querySelector('.card[data-t="net"]'); if (c) c.click(); return true; })()`);
  await waitForPage("!!document.querySelector('#mixInput')", { label: "setup screen" });
  await evaluate(`(() => {
    const input = document.querySelector('#mixInput');
    input.value = '20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#startBtn').click();
    return true;
  })()`);
  await waitForPage("!!document.querySelector('#gradeBtn')", { label: "first question" });

  let reached = false;
  for (let step = 0; step < 22 && !reached; step += 1) {
    const tag = await evaluate("document.querySelector('.qtag')?.textContent || ''");
    if (tag.includes("Written · concept")) {
      reached = true;
      break;
    }
    await evaluate(`(() => {
      const blanks = [...document.querySelectorAll('.blank')];
      if (blanks.length) blanks.forEach((b) => { b.value = 'zzz'; b.dispatchEvent(new Event('input', { bubbles: true })); });
      else {
        const box = document.querySelector('#ta');
        if (box) { box.value = 'zzz'; box.dispatchEvent(new Event('input', { bubbles: true })); }
        else { const opt = document.querySelector('.opt'); if (opt) opt.click(); }
      }
      document.querySelector('#gradeBtn').click();
      return true;
    })()`);
    await waitForPage("!!document.querySelector('#advBtn')", { label: "grade to finish" });
    await clickSel("#advBtn");
    await waitForPage("!!document.querySelector('#gradeBtn')", { label: "next question" });
  }
  if (!reached) throw new Error("no conceptual written question appeared in a fully written round");

  // Answer it wrongly (the model is only ever offered on a failed attempt).
  await evaluate(`(() => {
    const box = document.querySelector('#ta');
    box.value = 'zzz';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#gradeBtn').click();
    return true;
  })()`);
  await waitForPage("!!document.querySelector('.feed.show')", { label: "the answer to be graded" });
  const markedWrong = await evaluate("(document.querySelector('.feed')?.className || '').includes('r')");
  if (!markedWrong) throw new Error("this check needs a question marked wrong by the rules first");
  if (!(await evaluate("!!document.querySelector('#aiBtn')"))) throw new Error("the review button is missing after opting in");

  await clickSel("#aiBtn");
  await waitForPage("!!document.querySelector('.aiout.bad') || !!document.querySelector('.aiout.good')", {
    timeoutMs: 120_000,
    label: "an AI verdict or an explanation",
  });
  const outcome = await evaluate(`(() => ({
    bad: document.querySelector('.aiout.bad')?.textContent || '',
    good: document.querySelector('.aiout.good')?.textContent || '',
    stillWrong: (document.querySelector('.feed')?.className || '').includes('r'),
  }))()`);
  if (outcome.bad && !outcome.stillWrong) throw new Error("a model that cannot run must not change the mark");
  if (!outcome.bad && !outcome.good) throw new Error("neither a verdict nor an explanation was shown");
  c.notes.push("navigator.gpu in this browser: " + (await evaluate("!!navigator.gpu")));
  c.notes.push(outcome.bad ? "clean failure: " + outcome.bad.slice(0, 90) : "verdict shown: " + outcome.good.slice(0, 90));

  await cdp.send("Network.setBlockedURLs", { urls: [] }, sess);
  await evaluate(`(() => { window.localStorage.removeItem('csq-ai-review'); return true; })()`);
  await clickSel("#homeBtn");
  await waitForPage("document.querySelectorAll('.card').length === " + TOPIC_COUNT, { label: "home screen" });
});

/* ---- UI integration ---- */

await check("a Python coding question can be answered through the UI", async (c) => {
  await evaluate(`(() => {
    const card = document.querySelector('.card[data-t="python"]');
    if (card) card.click();
    return true;
  })()`);
  await waitForPage("!!document.querySelector('#mixInput')", { label: "setup screen" });
  await evaluate(`(() => {
    const input = document.querySelector('#mixInput');
    input.value = '20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#startBtn').click();
    return true;
  })()`);
  await waitForPage("!!document.querySelector('#gradeBtn')", { label: "first question" });

  let reached = null;
  for (let step = 0; step < 22 && !reached; step += 1) {
    const info = await evaluate(`(() => {
      const tag = document.querySelector('.qtag')?.textContent || '';
      const prompt = document.querySelector('.prompt')?.textContent || '';
      return { tag, prompt, blanks: document.querySelectorAll('.blank').length, hasBox: !!document.querySelector('#ta') };
    })()`);
    if (info.tag.startsWith("Coding") && info.tag.includes("Python")) {
      reached = info;
      break;
    }
    // Answer generically, just to get past this question.
    await evaluate(`(() => {
      const blanks = [...document.querySelectorAll('.blank')];
      if (blanks.length) blanks.forEach((b) => { b.value = 'zzz'; b.dispatchEvent(new Event('input', { bubbles: true })); });
      else {
        const box = document.querySelector('#ta');
        if (box) { box.value = 'zzz'; box.dispatchEvent(new Event('input', { bubbles: true })); }
        else { const opt = document.querySelector('.opt'); if (opt) opt.click(); }
      }
      document.querySelector('#gradeBtn').click();
      return true;
    })()`);
    await waitForPage("!!document.querySelector('#advBtn')", { label: "grade to finish" });
    await clickSel("#advBtn");
    await waitForPage("!!document.querySelector('#gradeBtn')", { label: "next question" });
  }
  if (!reached) throw new Error("no Python coding question appeared in a fully written round");

  const key = Object.keys(PYTHON_SOLUTIONS).find((k) => reached.prompt.includes(k));
  if (!key) throw new Error("no reference solution matches the question: " + reached.prompt.slice(0, 60));
  c.notes.push("question: " + reached.prompt.slice(0, 60));
  const typed = PYTHON_SOLUTIONS[key];
  await evaluate(`(() => {
    const box = document.querySelector('#ta');
    box.value = ${JSON.stringify(typed)};
    box.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#gradeBtn').click();
    return true;
  })()`);
  await waitForPage("!!document.querySelector('.feed.show')", { timeoutMs: 240_000, label: "code feedback" });
  const feedback = await evaluate("document.querySelector('.feed.show').textContent");
  const passed = await evaluate("!!document.querySelector('.feed.g')");
  c.notes.push("feedback: " + feedback.slice(0, 100).replace(/\\s+/g, " "));
  if (!passed) throw new Error("a correct in-UI Python answer was marked wrong: " + feedback.slice(0, 160));
});

await check("an engine that cannot start leaves the question unanswered and warns the student", async (c) => {
  // CheerpJ/Pyodide are fetched from inside their own module workers, which
  // CDP's Network.setBlockedURLs does not reach, so the engine is made to fail
  // through the public registry instead (the same seam the unit suites use).
  // The engine is swapped back to the real one below, in place, to prove the
  // student can retry without a reload.
  await evaluate(`(async () => {
    const { registerEngine } = await import('/js/engines/index.js');
    registerEngine('python', async () => ({ pass: false, unavailable: true, message: 'the engine could not be started for this test' }));
    return true;
  })()`);

  // Start a fresh round and walk to a Python coding question again.
  await clickSel("#homeBtn");
  await waitForPage("document.querySelectorAll('.card').length === " + TOPIC_COUNT, { label: "home screen" });
  await evaluate(`(() => { document.querySelector('.card[data-t="python"]').click(); return true; })()`);
  await waitForPage("!!document.querySelector('#mixInput')", { label: "setup screen" });
  await evaluate(`(() => {
    const input = document.querySelector('#mixInput');
    input.value = '20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#startBtn').click();
    return true;
  })()`);
  await waitForPage("!!document.querySelector('#gradeBtn')", { label: "first question" });

  let reached = null;
  for (let step = 0; step < 22 && !reached; step += 1) {
    const info = await evaluate(`(() => ({
      tag: document.querySelector('.qtag')?.textContent || '',
      prompt: document.querySelector('.prompt')?.textContent || '',
    }))()`);
    if (info.tag.startsWith("Coding") && info.tag.includes("Python")) {
      reached = info;
      break;
    }
    await evaluate(`(() => {
      const blanks = [...document.querySelectorAll('.blank')];
      if (blanks.length) blanks.forEach((b) => { b.value = 'zzz'; b.dispatchEvent(new Event('input', { bubbles: true })); });
      else {
        const box = document.querySelector('#ta');
        if (box) { box.value = 'zzz'; box.dispatchEvent(new Event('input', { bubbles: true })); }
        else { const opt = document.querySelector('.opt'); if (opt) opt.click(); }
      }
      document.querySelector('#gradeBtn').click();
      return true;
    })()`);
    await waitForPage("!!document.querySelector('#advBtn')", { label: "grade to finish" });
    await clickSel("#advBtn");
    await waitForPage("!!document.querySelector('#gradeBtn')", { label: "next question" });
  }
  if (!reached) throw new Error("no Python coding question appeared");

  const key = Object.keys(PYTHON_SOLUTIONS).find((k) => reached.prompt.includes(k));
  if (!key) throw new Error("no reference solution matches: " + reached.prompt.slice(0, 60));
  const answerCode = PYTHON_SOLUTIONS[key];
  const marker = answerCode.split("\n")[0].trim().slice(0, 24);
  c.notes.push("question: " + reached.prompt.slice(0, 60));

  await evaluate(`(() => {
    const box = document.querySelector('#ta');
    box.value = ${JSON.stringify(answerCode)};
    box.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#gradeBtn').click();
    return true;
  })()`);
  await waitForPage("!!document.querySelector('.engine.warn') || !!document.querySelector('.feed.show')", {
    timeoutMs: 240_000,
    label: "either a warning or feedback",
  });
  const state = await evaluate(`(() => ({
    revealed: !!document.querySelector('.feed.show'),
    warn: document.querySelector('.engine.warn')?.textContent || '',
    buttonDisabled: document.querySelector('#gradeBtn')?.disabled ?? null,
    boxKept: (document.querySelector('#ta')?.value || '').includes(${JSON.stringify(marker)}),
  }))()`);
  if (state.revealed) throw new Error("an engine that cannot start must not grade the answer");
  if (!state.warn) throw new Error("no warning was shown to the student");
  if (state.buttonDisabled !== false) throw new Error("the student could not retry");
  if (!state.boxKept) throw new Error("the student's code was lost");
  c.notes.push("warning: " + state.warn.slice(0, 90));

  // Put the real engine back and retry: recovery must work without a reload.
  await evaluate(`(async () => {
    const { registerEngine } = await import('/js/engines/index.js');
    const real = (await import('/js/engines/python.js')).default;
    registerEngine('python', real);
    return true;
  })()`);
  await clickSel("#gradeBtn");
  await waitForPage("!!document.querySelector('.feed.show')", { timeoutMs: 240_000, label: "feedback after unblocking" });
  const recovered = await evaluate("!!document.querySelector('.feed.g')");
  if (!recovered) throw new Error("retrying after the engine recovered did not pass");
  c.notes.push("recovered after unblocking");
});

/* ------------------------------- summary ------------------------------- */

console.log("\n" + "=".repeat(60));
for (const r of results) {
  const mark = r.skipped ? "⃝ skip" : r.ok ? "✔ pass" : "✖ FAIL";
  console.log(mark + "  " + r.name);
  for (const note of r.notes || []) console.log("        · " + note);
  if (r.reason) console.log("        · " + r.reason);
}
const failed = results.filter((r) => !r.ok);
console.log("=".repeat(60));
if (consoleLines.length > 0) {
  const noisy = consoleLines.filter((l) => /^error|^warning/.test(l)).slice(0, 5);
  if (noisy.length > 0) console.log("browser console (errors/warnings):\n  " + noisy.join("\n  "));
}

try {
  child.kill("SIGKILL");
} catch {
  /* already gone */
}
try {
  ownServer?.close();
} catch {
  /* already closed */
}

if (failed.length > 0) {
  console.log("\n" + failed.length + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll browser checks passed.");
process.exit(0);

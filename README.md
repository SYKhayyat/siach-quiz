# CS Quiz — 20 questions, written answers included

A static quiz site (no server, no build step) covering 12 computer science
topics. Each round is 20 questions drawn from that topic's pool:

- **Multiple choice** — four options, shuffled per question, with an explanation
  for the wrong pick you made.
- **Written** — type the answer: a number, a keyword, an exact output, or fill
  in the blanks.
- **Coding** — write a function; your code **actually runs in the browser** and
  is judged by its tests.

You choose how many of the 20 are written by typing a number (0–20); the rest
are multiple choice. Progress is saved per topic, so a round can be resumed.

## How written answers are graded

Everything is a documented rule — there is no AI and nothing is uploaded. The
rules are also stated on the setup screen so students know what is happening.

| Behaviour | Rule |
| --- | --- |
| Case | **Significant by default.** `None`, `KeyError`, `GET`, `ABC` must be spelled the way the language spells them. A question can opt out with `caseSensitive: false`. |
| Traps | A wrong answer that matches a known misconception gets the explanation for *that* misconception ("Case matters — upper() capitalizes"). |
| Typos | Depends on the question. Where the answer *is* the output — a literal, a value, syntax, a flag, a command — one wrong character is **wrong**, and the feedback names the exact answer. Where the question asks for an **idea** ("Wi-Fi stands for what?", "which structure gives O(1) lookup?"), a one-letter slip is **accepted with a note** giving the exact spelling. A question can force either way with `typo: "strict"` or `typo: "accept"`. |
| Numbers | Units, filler and **spelled-out words** are understood: `48`, `48 bits`, `about 48` and `eleven` (for `11`) all pass, and a spelled number is accepted with a note saying which numeral was read. Thousands/decimal commas and `0x30` work too. Tolerance is per question. |
| Prose | A `keywords` spec accepts a real sentence ("it raises an exception") instead of demanding one magic word. |
| Blanks | Each blank is marked separately and shown as ✓/✕ with the accepted text. |

Which rule applies is derived from the shape of the accepted answer
(`typoPolicy()` in `js/check.js`): answers containing code punctuation, or made
only of single words, are exact; answers that are all plain phrases are ideas.
Roughly 90 of the written questions are exact and 30 are conceptual. A lint in
`tests/data.test.js` fails the build if a *trap* answer ever becomes acceptable
under the lenient policy.

Rule details live in `js/check.js`; the per-question expectations live in
`data/*.js`.

## Optional: on-device answer review (no API key)

Off by default, and turned on per browser from the setup screen. When it is on
and the rules mark a **conceptual** answer wrong, the student can press *Review
with the local AI*: a small language model ([WebLLM](https://webllm.mlc.ai/),
`Llama-3.2-1B-Instruct`) runs **on their device** via WebGPU. First use downloads
the model once; after that everything — including every verdict — stays local.

Guarantees, enforced in `js/store.js` and tested:

- It can only turn a rules-based **fail** into a pass, never the other way.
- Exact answers (syntax, output, numbers, fill-in-the-blanks) are never sent to
  it: a model is not allowed to overrule `None` vs `none`.
- If WebGPU is missing, or the model cannot be downloaded, the rules stand and
  the UI says so in plain words — the mark is untouched.
- Every AI-granted mark is labelled, in the feedback and in the results review,
  as *Counted as correct by the local AI*.

The grader it augments is still `gradeTextAnswer()`; `js/ai/on-device.js` is the
only file that knows a model exists, so the feature can be deleted or swapped
without touching the views, the store or the round logic.

## How coding answers are checked

`js/engines/` dispatches on the question's `lang`:

| Language | Engine | Notes |
| --- | --- | --- |
| JavaScript | Web Worker running the tests with `assert` | instant; tests may `await` |
| Python | [Pyodide](https://pyodide.org) (CPython in WebAssembly) | ~10 MB, fetched once, cached |
| Java | [CheerpJ](https://cheerpj.com) (a WebAssembly JVM) running `javac` | needs `vendor/jdk/tools.jar` (see `vendor/jdk/README.md`) |
| Rust | the [public Rust playground](https://play.rust-lang.org) (`/execute`, no key) | **the one thing that leaves the machine**; a browser has no Rust compiler |

Rust is the honest exception: a browser cannot compile Rust, so the source is
POSTed to the public playground (the same approach as the standalone Rust trial
page). The question screen says so before the student types anything, a
rate-limit or outage is reported as *unavailable* rather than a wrong answer, and
the other three languages never leave the machine.

Details that matter:

- Each engine boots **once per session** and is reused; first use shows
  "Starting the … engine", later answers are immediate.
- If an engine cannot load (offline, blocked CDN, unsupported browser) the
  question is **left unanswered** with a visible warning and the student's code
  stays in the box. It is never marked wrong because a runtime failed.
- Answers submitted while an answer is wrong say *why*: the assertion message,
  the Python error, or the javac error.

### Vendoring for offline use

Pyodide is loaded from jsDelivr (`PYODIDE_INDEX` in
`js/engines/python-script.js`). To run without a CDN, copy a Pyodide
distribution into `vendor/pyodide/` and point `PYODIDE_INDEX` at it — for
example the `pyodide/` folder from the standalone "20-Problem Trial" pages.

## Running it

```
npm run serve          # static server on :8000 (no build step)
```

Then open <http://localhost:8000>. A `file://` open will not work: the Python
and Java engines need `http(s)` for WebAssembly and workers.

## Tests

```
npm test               # everything (~15s on a laptop)
npm run test:unit      # grader, data lint, store, policy + local-AI unit tests
npm run test:e2e       # seven end-to-end user journeys in jsdom
npm run test:python    # real Pyodide execution of the Python questions
npm run test:java      # real javac execution of the generated Java harness
npm run browser        # a real Chromium: the whole site, Pyodide, CheerpJ, the UI
```

What each suite is responsible for:

| File | Covers |
| --- | --- |
| `tests/grader.test.js` | case policy, typo → wrong + hint, units and filler, keyword specs, traps, blanks, count clamping |
| `tests/policy-ai.test.js` | strict-vs-concept policy over the real data, the prompt/verdict parser, and the store's AI review (upgrade only, opt-in, load failure) |
| `tests/data.test.js` | every question is well formed, codes declare a language that has an engine, each topic can fill a round, no trap is gradeable as correct, every written answer declares a marking policy |
| `tests/store.test.js` | round building, no duplicates in a round, MC explanation indexing, persistence round-trip, rejected corrupt/old saves, best score |
| `tests/engines.test.js` | engine registry, JavaScript questions pass with a solution and fail with their starter, Python/Java script assembly |
| `tests/python-engine.test.js` | the Python questions executed for real by Pyodide (pass, fail, syntax error, stdout, prelude) |
| `tests/java-harness.test.js` | the generated Java harness compiled and run by a real JDK; loader-version drift check |
| `tests/rust-engine.test.js` | harness assembly and verdict parsing, the "unavailable is not a wrong answer" paths, and every Rust question compiled by the real playground (skipped if the network is down) |
| `tests/e2e.test.js` | seven journeys: keyboard-only round → results; count box clamping + fully written round; hints/traps/case; coding answers; review screen + best score + typing guards; resume, mix persistence and a dead engine; typo policy + opting into the local AI |

Python, Java and Rust need a browser, so the E2E suite stubs those engines through
the public `registerEngine()` registry while keeping storage, marking, feedback
and resume real. The question content for those languages is verified against the
real runtimes (and the real playground) in their own suites.

### Layout

The home screen shows the twelve topics in three labelled sections of four
(`Languages`, `Foundations`, `Systems & practice`). Column counts are chosen so a
section never ends in a ragged row — 4 across on desktop, 2 on tablet, 1 on a
phone — and the browser suite fails the build if a card in a row is a different
size or the page ever scrolls sideways.

CI (`.github/workflows/ci.yml`) runs `npm test` on Node 22 with a JDK 21 on
PATH, so a broken Java harness or a Python regression fails the build. A second
job installs Chrome and runs the browser suite above.

### The browser suite

`npm run browser` (see `tools/browser-check.mjs`) drives a real Chromium over
CDP against a static server it starts itself. It is the only place the
WebAssembly engines and the real DOM can be checked together:

- the app loads with no page errors; modules resolve; all three engines register
- the JavaScript worker kills a runaway loop promptly
- every JavaScript coding question passes with its reference solution
- **Python really runs** (Pyodide): pass, fail with a message, syntax error
- **Java really compiles and runs** (CheerpJ + `javac` + `vendor/jdk/tools.jar`)
- **Rust really compiles and runs** on the playground, and a syntax error comes
  back as a compiler message rather than an outage
- the topic grid stays even at every width (full rows, equal card sizes, no
  sideways scroll) — see the layout note below
- all ~120 written answers follow their marking policy, in the browser
- the local AI is off until asked for, and when it cannot load it says so and
  never changes a mark
- a coding answer typed through the UI is graded correctly; an engine that
  cannot start warns the student, keeps their code, and recovers in place once
  the engine works again

```
npm run browser                                  # everything
ONLY="python,java" npm run browser               # just those checks
CHROMIUM_BIN=/path/to/chromium npm run browser   # pick a browser
```

Checks whose requirements are missing (no Chromium, no `tools.jar`) are skipped
with a printed reason rather than failing.

The real WebGPU model path cannot run in a headless container, so the AI check
verifies the opt-in, the gating and the clean-failure path; the model's actual
judgement is exercised with an injected stub in `tests/policy-ai.test.js`.

## Adding questions

- Multiple choice: `data/<topic>.js` → `questions[]` with `choices`, `answer`
  (index), `notes` (one per choice), `why`, `tag`.
- Written: same file → `text[]` with `kind: "text"` and either
  `check: {type: "number"|"values"|"regex"|"keywords", …}` or `blanks[]`, plus
  `answer` (what to show) and `traps[]` for misconceptions.
- Coding: `kind: "code"`, `lang: "javascript"|"python"|"java"`, `starter`,
  `tests`, plus `answer`/`why` describing the expected approach. Python tests are
  `assert` statements; Java tests are statements using `assertTrue/assertEquals`
  inside a generated harness (the student writes `class Solution`).

Add `typo: "strict"` or `typo: "accept"` when the derived policy would be wrong
for a question (a command to type is strict; a paradigm name is a concept).

`tests/data.test.js` fails the build if a question is malformed, if a trap answer
becomes acceptable, or if the marking policy is missing, so the fastest way to
check new content is `npm run test:unit`.

## Notes and constraints

- The graded rules are **fully deterministic** and are stated on the setup
  screen. The only model in the project is the optional on-device review above,
  which is off by default, never sees exact answers, and can only add credit.
- `registerEngine()` in `js/engines/index.js` (code execution) and
  `setAIEngineFactory()` in `js/ai/on-device.js` (written-answer review) are the
  two seams where a different implementation can be dropped in.
- GitHub Pages cannot set custom headers. If a future engine needs
  `SharedArrayBuffer`, a `coi-serviceworker` shim would be required; Pyodide and
  CheerpJ as used here do not.
- Java's first run downloads CheerpJ plus `tools.jar` (~18 MB) — expect a slow
  first question on that language and fast ones afterwards.
- The optional local model is a few hundred MB on first use. It is fetched from
  the same CDNs as the engines and never leaves the device once loaded.

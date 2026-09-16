/**
 * Answer grading for written questions.
 *
 * Design rules (deliberate, and deliberately boring):
 *  - There is no AI here. Every verdict comes from the rule below and is
 *    explainable to the student.
 *  - A near miss is WRONG. It never becomes a pass. When we can see *why* it
 *    missed (case, spelling, missing idea) we say so in `hint`.
 *  - Case matters by default. Programming literals (`None`, `KeyError`, `ABC`)
 *    and protocol tokens (`GET`, `ICMP`) are case-significant, so an answer has
 *    to spell them the way the language does. A spec can opt out with
 *    `caseSensitive: false` when case genuinely carries no meaning.
 *  - How much a typo costs depends on the question. Where the answer IS the
 *    output — a literal, identifier, syntax or an exact string — one wrong
 *    character is a wrong answer. Where the answer is an idea ("what does
 *    HTTPS stand for?", "which structure gives O(1) lookup?"), a near miss is
 *    accepted with a note about the spelling, because the idea is what was
 *    asked for. See `typoPolicy()`; a question can force either way.
 */

export function normalizeText(value, caseSensitive = true) {
  const s = String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00A0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return caseSensitive ? s : s.toLowerCase();
}

export function editDistance(a, b) {
  const x = String(a);
  const y = String(b);
  if (x === y) return 0;
  const prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[y.length];
}

/** Characters that only ever appear in something you would type into code. */
const CODE_PUNCTUATION = /[[\](){}<>;:'"`\\|]/;

/**
 * "strict" — a typo is a wrong answer (syntax, output, literals, identifiers).
 * "accept" — a near miss passes with a spelling note (conceptual questions).
 *
 * Derived from the shape of the accepted answer, so the ~200 existing written
 * questions get a sane policy without hand-labelling every one:
 *   - any answer with code punctuation, or where every accepted answer is a
 *     single word, is something you type: strict.
 *   - answers that are all plain phrases ("wireless fidelity", "product owner")
 *     are ideas: accept.
 * A question can override either way with `typo: "strict" | "accept"`.
 */
export function typoPolicy(spec) {
  if (!spec) return "strict";
  if (spec.typo === "accept") return "accept";
  if (spec.typo === false || spec.typo === "strict") return "strict";
  const values = (spec.values || []).map(String);
  if (values.length === 0) return "strict";
  if (values.some((v) => CODE_PUNCTUATION.test(v))) return "strict";
  return values.every((v) => !/\s/.test(v)) ? "strict" : "accept";
}

/**
 * Should a failed answer be offered to the on-device model for a second
 * opinion? Only where the question is about an idea. Exact answers (numbers,
 * code output, fill-in-the-blank literals, single-token answers) are the
 * rules' final word — a model must never talk us out of `None` vs `none`.
 */
export function aiReviewAllowed(question) {
  if (!question) return false;
  if (Array.isArray(question.blanks) && question.blanks.length > 0) return false;
  const spec = question.check;
  if (!spec) return false;
  if (spec.type === "number" || spec.type === "regex") return false;
  if (spec.type === "keywords") return true;
  return typoPolicy(spec) === "accept";
}

/**
 * How many edits we are willing to *explain*, never to forgive.
 *
 * Plain numbers ("7", "2.67") get none: one digit away is a different answer,
 * not a spelling slip. Structured numbers that carry structure — an IP address,
 * a version — do get one, because "you dropped a digit" is real feedback.
 */
export function typoAllowance(canonical) {
  const c = String(canonical);
  if (c.length < 5 || /^[-+]?\d+(\.\d+)?$/.test(c)) return 0;
  return c.length < 10 ? 1 : 2;
}

function isNumericSpec(spec) {
  return (spec && spec.type) === "number";
}

/**
 * Pull a number out of a free-text answer so units and filler words do not
 * fail an otherwise correct answer: "48 bits", "~200", "about 3 packets".
 */
export function parseNumber(given) {
  const text = String(given ?? "").trim();
  if (text === "") return null;
  const hex = text.match(/^[-+]?0[xX][0-9a-fA-F]+$/);
  if (hex) return Number(hex[0]);
  const bin = text.match(/^[-+]?0[bB][01]+$/);
  if (bin) return Number(bin[0]);
  const m = text.match(/-?\d[\d,_]*(?:\.\d+)?/);
  if (!m) return null;
  let raw = m[0];
  const commas = raw.match(/,/g);
  if (!raw.includes(".") && commas) {
    // "1,000" is thousands; "1,5" is a European decimal comma.
    raw = commas.length === 1 && !/,\d{3}$/.test(raw) ? raw.replace(",", ".") : raw.replace(/,/g, "");
  }
  raw = raw.replace(/_/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function matchesNumber(spec, given) {
  const g = parseNumber(given);
  if (g === null) return false;
  return Math.abs(g - spec.value) <= (spec.tolerance ?? 0);
}

function matchesRegex(spec, given) {
  try {
    return new RegExp(spec.pattern, spec.caseSensitive === true ? "" : "i").test(String(given ?? "").trim());
  } catch {
    return false;
  }
}

function containsWord(haystack, needle) {
  const n = String(needle).toLowerCase();
  if (!n) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const edge = /^[a-z0-9]/i.test(n) && /[a-z0-9]/i.test(n.slice(-1));
  return new RegExp((edge ? "\\b" : "") + escaped + (edge ? "\\b" : ""), "i").test(haystack);
}

function matchesKeywords(spec, given) {
  const text = String(given ?? "");
  const any = Array.isArray(spec.any) ? spec.any : [];
  const all = Array.isArray(spec.all) ? spec.all : [];
  const hitAny = any.length === 0 || any.some((k) => containsWord(text, k));
  const missedAll = all.filter((k) => !containsWord(text, k));
  return { ok: hitAny && missedAll.length === 0, missed: hitAny ? missedAll : any };
}

/**
 * Does `given` match this spec exactly? Used for trap detection (with
 * `strictCase = false`, so "none" still counts as reaching for `None`).
 */
export function matchesOne(spec, given, strictCase = true) {
  if (!spec) return false;
  if (isNumericSpec(spec)) return matchesNumber(spec, given);
  if (spec.type === "regex") return matchesRegex(spec, given);
  if (spec.type === "keywords") return matchesKeywords(spec, given).ok;
  const cs = spec.caseSensitive === undefined ? strictCase : !!spec.caseSensitive;
  const want = (spec.values || []).map((v) => normalizeText(v, cs));
  const got = normalizeText(given, cs);
  return want.includes(got);
}

/**
 * Grade one spec. Returns the verdict plus, on failure, the most useful thing
 * we can honestly tell the student about why it missed.
 */
export function evaluate(spec, given) {
  if (!spec) return { ok: false, hint: "" };
  if (isNumericSpec(spec)) {
    if (matchesNumber(spec, given)) return { ok: true, hint: "" };
    const n = parseNumber(given);
    return {
      ok: false,
      hint: n === null ? "No number found in that answer — write just the number." : "",
    };
  }
  if (spec.type === "regex") {
    return matchesRegex(spec, given) ? { ok: true, hint: "" } : { ok: false, hint: "" };
  }
  if (spec.type === "keywords") {
    const res = matchesKeywords(spec, given);
    if (res.ok) return { ok: true, hint: "" };
    return {
      ok: false,
      hint: res.missed.length > 0 ? "Mention one of: " + res.missed.map((k) => '"' + k + '"').join(", ") + "." : "",
    };
  }

  const cs = spec.caseSensitive === undefined ? true : !!spec.caseSensitive;
  const gotStrict = normalizeText(given, cs);
  const gotLoose = normalizeText(given, false);
  if (cs && (spec.values || []).some((v) => normalizeText(v, cs) === gotStrict)) return { ok: true, hint: "" };
  if (!cs && (spec.values || []).some((v) => normalizeText(v, false) === gotLoose)) return { ok: true, hint: "" };

  // Why did it miss? Prefer explanation over blame.
  const caseTwin = (spec.values || []).find((v) => normalizeText(v, false) === gotLoose);
  if (caseTwin !== undefined) {
    return { ok: false, hint: "Capitalization matters here — it has to be " + JSON.stringify(String(caseTwin)) + "." };
  }
  const near = (spec.values || []).find(
    (v) => editDistance(normalizeText(v, cs), gotStrict) <= typoAllowance(normalizeText(v, cs))
  );
  if (near !== undefined) {
    if (typoPolicy(spec) === "accept") {
      // A conceptual answer: the idea is right, so it counts — but say what the
      // exact answer is, because the spelling may matter elsewhere.
      return {
        ok: true,
        soft: true,
        hint: "Accepted — one letter off is fine here, the exact answer is " + JSON.stringify(String(near)) + ".",
      };
    }
    return {
      ok: false,
      hint:
        "Almost — " + JSON.stringify(String(near)) + " is the exact answer, and this one is marked character for character, so a typo is wrong.",
    };
  }
  return { ok: false, hint: "" };
}

export function checkBlanks(specs, givens) {
  return specs.map((spec, i) => evaluate(spec, givens[i]).ok);
}

/** Is this written question marked by exact matching (typos matter)? */
export function isExactQuestion(question) {
  return !aiReviewAllowed(question);
}

export function findTrap(question, given) {
  if (!Array.isArray(question.traps)) return "";
  const g = Array.isArray(given) ? given.join(" ") : given;
  for (const t of question.traps) {
    if (!t || !t.match) continue;
    // Traps are about the student's reasoning, so match them loosely.
    if (matchesOne(t.match, g, false)) return t.note || "";
  }
  return "";
}

/** The canonical answer to show the student, for any question shape. */
export function acceptedAnswer(question) {
  if (Array.isArray(question.blanks) && question.blanks.length > 0) {
    return question.blanks.map((b) => b.answer || (b.values || [])[0] || "").join(" / ");
  }
  const spec = question.check;
  if (spec && Array.isArray(spec.values) && spec.values.length > 0) return spec.values.join(" / ");
  if (spec && spec.type === "number") return String(spec.value);
  if (spec && spec.type === "keywords") return (spec.any || spec.all || []).join(" / ");
  if (spec && spec.type === "regex") return question.answer || "any valid answer";
  return question.answer || "";
}

export function gradeTextAnswer(question, given) {
  if (Array.isArray(question.blanks) && question.blanks.length > 0) {
    const givens = Array.isArray(given) ? given : [given];
    const results = question.blanks.map((spec, i) => evaluate(spec, givens[i]));
    const marks = results.map((r) => r.ok);
    const hints = results.map((r) => r.hint || "");
    return {
      pass: marks.every(Boolean),
      marks,
      hints,
      hint: hints.find(Boolean) || "",
      trap: "",
    };
  }
  const result = evaluate(question.check, given);
  return {
    pass: result.ok,
    marks: null,
    hints: [result.hint || ""],
    hint: result.hint || "",
    trap: result.ok ? "" : findTrap(question, given),
  };
}

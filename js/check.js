export function normalizeText(value, caseSensitive) {
  const s = String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
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

function typoAllowance(canonical) {
  if (canonical.length < 5 || /^-?[\d.,]+$/.test(canonical)) return 0;
  return canonical.length < 10 ? 1 : 2;
}

function matchesOne(spec, given) {
  if (spec.type === "number") {
    let raw = String(given ?? "").trim().replace(/\s+/g, "");
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) raw = raw.replace(/,/g, "");
    else if (!raw.includes(".") && (raw.match(/,/g) || []).length === 1) raw = raw.replace(",", ".");
    const g = Number(raw);
    if (!Number.isFinite(g)) return false;
    return Math.abs(g - spec.value) <= (spec.tolerance ?? 0);
  }
  if (spec.type === "regex") {
    try {
      return new RegExp(spec.pattern, spec.caseSensitive ? "" : "i").test(String(given ?? "").trim());
    } catch {
      return false;
    }
  }
  const cs = !!spec.caseSensitive;
  const want = (spec.values || []).map((v) => normalizeText(v, cs));
  const got = normalizeText(given, cs);
  if (want.includes(got)) return true;
  if (spec.typo === false) return false;
  return want.some((w) => editDistance(w, got) <= typoAllowance(w));
}

export function checkBlanks(specs, givens) {
  return specs.map((spec, i) => matchesOne(spec, givens[i]));
}

export function findTrap(question, given) {
  if (!Array.isArray(question.traps)) return "";
  const g = Array.isArray(given) ? given.join(" ") : given;
  for (const t of question.traps) {
    if (!t || !t.match) continue;
    if (matchesOne(t.match, g)) return t.note || "";
  }
  return "";
}

export function gradeTextAnswer(question, given) {
  if (Array.isArray(question.blanks) && question.blanks.length > 0) {
    const givens = Array.isArray(given) ? given : [given];
    const marks = checkBlanks(question.blanks, givens);
    const pass = marks.every(Boolean);
    return { pass, marks, trap: "" };
  }
  const pass = matchesOne(question.check, given);
  return { pass, marks: null, trap: pass ? "" : findTrap(question, given) };
}

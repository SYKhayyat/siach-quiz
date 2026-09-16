/**
 * Reference solutions and answer helpers shared by the test suites.
 *
 * The code-question tests check both directions: a known-good solution must
 * pass, and the question's own starter (which returns nothing useful) must fail.
 */

export const JS_SOLUTIONS = {
  "makeCounter": "function makeCounter() {\n  let n = 0;\n  return function () { return ++n; };\n}",
  "once(fn)": "function once(fn) {\n  let done = false, value;\n  return function (...args) {\n    if (!done) { done = true; value = fn(...args); }\n    return value;\n  };\n}",
  "range(n)": "function range(n) {\n  const out = [];\n  for (let i = 0; i < n; i += 1) out.push(i);\n  return out;\n}",
  "pipe(f, g)": "function pipe(f, g) {\n  return (x) => f(g(x));\n}",
  "reverseString(s)": "function reverseString(s) {\n  return s.split('').reverse().join('');\n}",
  "sumArray(arr)": "function sumArray(arr) {\n  return arr.reduce((a, b) => a + b, 0);\n}",
  "fib(n)": "function fib(n) {\n  let a = 0, b = 1;\n  for (let i = 0; i < n; i += 1) { const t = a + b; a = b; b = t; }\n  return a;\n}",
  "binarySearch(arr, x)": "function binarySearch(arr, x) {\n  let lo = 0, hi = arr.length;\n  while (lo < hi) {\n    const mid = (lo + hi) >> 1;\n    if (arr[mid] === x) return mid;\n    if (arr[mid] < x) lo = mid + 1; else hi = mid;\n  }\n  return -1;\n}",
  "peek(stack)": "function peek(stack) {\n  return stack[stack.length - 1];\n}",
  "isBalanced(s)": "function isBalanced(s) {\n  const pairs = { ')': '(', ']': '[', '}': '{' };\n  const stack = [];\n  for (const ch of s) {\n    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);\n    else if (pairs[ch]) { if (stack.pop() !== pairs[ch]) return false; }\n  }\n  return stack.length === 0;\n}",
  "reverseArray(arr)": "function reverseArray(arr) {\n  return arr.slice().reverse();\n}",
  "sumTree(node)": "function sumTree(node) {\n  if (!node) return 0;\n  return node.v + sumTree(node.left) + sumTree(node.right);\n}",
};

export const PYTHON_SOLUTIONS = {
  "Write middle(s)": "def middle(s):\n    return s[1:-1]",
  "Write csv_sum(s)": "def csv_sum(s):\n    return sum(int(part) for part in s.split(','))",
  "Write even_squares(up_to)": "def even_squares(up_to):\n    return [n * n for n in range(up_to) if n % 2 == 0]",
  "Write word_freq(words)": "def word_freq(words):\n    counts = {}\n    for word in words:\n        counts[word] = counts.get(word, 0) + 1\n    return counts",
  "Write add_item(item, items=None)": "def add_item(item, items=None):\n    if items is None:\n        items = []\n    items.append(item)\n    return items",
  "Write class Dog": [
    "class Dog:",
    "    def __init__(self, name, age):",
    "        self.name = name",
    "        self.age = age",
    "    def bark(self):",
    "        return f'{self.name} says woof'",
    "    def __str__(self):",
    "        return f'Dog({self.name}, {self.age})'",
  ].join("\n"),
};

export const JAVA_SOLUTIONS = {
  "static method sum(int[] a)": [
    "class Solution {",
    "    static int sum(int[] a) {",
    "        int total = 0;",
    "        for (int n : a) total += n;",
    "        return total;",
    "    }",
    "}",
  ].join("\n"),
  "static method countEven(int[] a)": [
    "class Solution {",
    "    static int countEven(int[] a) {",
    "        int count = 0;",
    "        for (int n : a) if (n % 2 == 0) count += 1;",
    "        return count;",
    "    }",
    "}",
  ].join("\n"),
  "static method reverse(String s)": [
    "class Solution {",
    "    static String reverse(String s) {",
    "        return new StringBuilder(s).reverse().toString();",
    "    }",
    "}",
  ].join("\n"),
  "static method classify(int x)": [
    "class Solution {",
    "    static String classify(int x) {",
    '        if (x > 0) return "pos";',
    '        if (x < 0) return "neg";',
    '        return "zero";',
    "    }",
    "}",
  ].join("\n"),
  "static method wordFreq(String[] words)": [
    "import java.util.HashMap;",
    "import java.util.Map;",
    "",
    "class Solution {",
    "    static Map<String, Integer> wordFreq(String[] words) {",
    "        Map<String, Integer> out = new HashMap<>();",
    "        for (String word : words) out.merge(word, 1, Integer::sum);",
    "        return out;",
    "    }",
    "}",
  ].join("\n"),
  "class Solution with a constructor": [
    "class Solution {",
    "    private final int value;",
    "    Solution(int value) {",
    "        this.value = value;",
    "    }",
    "    int doubled() {",
    "        return value * 2;",
    "    }",
    "}",
  ].join("\n"),
};

function lookup(map, prompt) {
  for (const [key, value] of Object.entries(map)) {
    if (prompt.includes(key)) return value;
  }
  return null;
}

/** The reference solution for a code question, or null if we have none. */
export function solutionFor(question) {
  const prompt = question.q || "";
  if (question.lang === "java") return lookup(JAVA_SOLUTIONS, prompt);
  if (question.lang === "python") return lookup(PYTHON_SOLUTIONS, prompt);
  return lookup(JS_SOLUTIONS, prompt);
}

/** A string (or array, for blanks) that the grader must accept. */
export function correctAnswer(question) {
  if (Array.isArray(question.blanks) && question.blanks.length > 0) {
    return question.blanks.map((b) => (b.values || [])[0] ?? b.answer);
  }
  const spec = question.check || {};
  if (spec.type === "number") return String(spec.value);
  if (spec.type === "regex") {
    const candidates = [question.answer, String(question.answer || "").replace(/^e\.g\.\s*/i, ""), "192.168.1.1"];
    for (const candidate of candidates) {
      try {
        if (new RegExp(spec.pattern, "i").test(String(candidate))) return String(candidate);
      } catch {
        /* try the next candidate */
      }
    }
  }
  if (spec.type === "keywords") return (spec.any || spec.all || [])[0];
  if (Array.isArray(spec.values) && spec.values.length > 0) return spec.values[0];
  return question.answer;
}

/** A string (or array, for blanks) the grader must reject. */
export function wrongAnswer(question) {
  if (Array.isArray(question.blanks) && question.blanks.length > 0) {
    return question.blanks.map(() => "zzz");
  }
  const trap = Array.isArray(question.traps) && question.traps.length > 0 ? question.traps[0].match || {} : null;
  if (trap) {
    if (Array.isArray(trap.values) && trap.values.length > 0) return trap.values[0];
    if (typeof trap.value === "number") return String(trap.value);
  }
  const spec = question.check || {};
  if (spec.type === "number") return String(Number(spec.value) + 12_345);
  return "zzz";
}

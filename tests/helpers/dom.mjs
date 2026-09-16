import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const GLOBALS = ["HTMLElement", "KeyboardEvent", "MouseEvent", "Event", "Node", "CustomEvent", "getComputedStyle"];

/** Load index.html into a fresh jsdom and point the globals at it. */
export function bootDom() {
  const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://quiz.test/", pretendToBeVisual: true });
  const { window } = dom;

  // jsdom implements neither of these, and the app calls both.
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};

  globalThis.window = window;
  globalThis.document = window.document;
  for (const name of GLOBALS) {
    if (window[name] !== undefined) globalThis[name] = window[name];
  }
  // NOTE: do not rebind the global timer functions to jsdom's — jsdom's own
  // implementation resolves the globals and recurses into itself. The suite
  // stops the quiz timer by navigating home before closing the window instead.
  try {
    Object.defineProperty(globalThis, "localStorage", {
      value: window.localStorage,
      configurable: true,
      writable: true,
    });
  } catch {
    globalThis.localStorage = window.localStorage;
  }
  return dom;
}

export function teardownDom(dom) {
  try {
    dom.window.close();
  } catch {
    /* best effort */
  }
}

/** Dispatch a click that jsdom (and the app) will treat as a real event. */
export function click(node) {
  if (!node) throw new Error("click(): element not found");
  node.dispatchEvent(new globalThis.window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** Type into an input/textarea the way a user does (value + input event). */
export function type(node, value) {
  if (!node) throw new Error("type(): element not found");
  node.value = value;
  node.dispatchEvent(new globalThis.window.Event("input", { bubbles: true }));
  node.dispatchEvent(new globalThis.window.Event("change", { bubbles: true }));
  return node;
}

export function press(key, target = document) {
  const node = target || document;
  node.dispatchEvent(new globalThis.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => [...document.querySelectorAll(selector)];

/** Let queued promises and timers drain (code answers resolve asynchronously). */
export async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

/** Click the grade button and let the async engine promise settle. */
export async function grade() {
  const btn = document.querySelector("#gradeBtn");
  if (!btn) throw new Error("no #gradeBtn on screen");
  click(btn);
  await settle();
}

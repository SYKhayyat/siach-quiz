/**
 * Python worker: loads Pyodide (CPython compiled to WebAssembly) once, then
 * runs each answer's script. Pyodide requires a module worker, so this file is
 * loaded with `{ type: "module" }`.
 */

import { PYODIDE_INDEX, buildPythonScript, parsePythonResult } from "./python-script.js";

let pyodidePromise = null;
let ready = false;

async function getPyodide() {
  if (!pyodidePromise) {
    self.postMessage({ type: "status", state: "loading" });
    pyodidePromise = import(/* @vite-ignore */ PYODIDE_INDEX + "pyodide.mjs")
      .then(({ loadPyodide }) => loadPyodide({ indexURL: PYODIDE_INDEX }))
      .then((pyodide) => {
        ready = true;
        self.postMessage({ type: "status", state: "ready" });
        return pyodide;
      })
      .catch((err) => {
        pyodidePromise = null;
        throw err;
      });
  }
  return pyodidePromise;
}

self.onmessage = async (event) => {
  const { id, code, tests, prelude } = event.data || {};
  if (!id) return;
  try {
    const pyodide = await getPyodide();
    let printed = "";
    pyodide.setStdout({ batched: (line) => { printed += line + "\n"; } });
    pyodide.setStderr({ batched: (line) => { printed += line + "\n"; } });
    const script = buildPythonScript({ code, tests, prelude });
    const raw = await pyodide.runPythonAsync(script);
    const verdict = parsePythonResult(raw, printed);
    self.postMessage({ id, pass: verdict.pass, message: verdict.message });
  } catch (err) {
    self.postMessage({
      id,
      pass: false,
      unavailable: !ready,
      message: (ready ? "Python engine failed: " : "The Python engine did not start: ") +
        String((err && err.message) || err).slice(0, 300),
    });
  }
};

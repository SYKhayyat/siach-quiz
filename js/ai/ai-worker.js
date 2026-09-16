/**
 * The on-device model lives in this worker, so a 500 MB download and every
 * token it generates happen off the main thread (the quiz UI stays responsive
 * and can show real progress).
 *
 * This is the handshake WebLLM expects for `CreateWebWorkerMLCEngine`.
 */
import { WebWorkerMLCEngineHandler } from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm";

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (event) => {
  handler.onmessage(event);
};

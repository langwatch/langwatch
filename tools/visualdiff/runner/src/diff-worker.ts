import { parentPort } from "node:worker_threads";

import { diffScreenshots, type DiffFiles } from "./diff";

/** One pixel diff per message, off the capture's event loop (diff-pool.ts). */
parentPort?.on("message", (files: DiffFiles) => {
  try {
    parentPort?.postMessage({ diff: diffScreenshots(files) });
  } catch (thrown) {
    parentPort?.postMessage({ error: thrown instanceof Error ? thrown.message : String(thrown) });
  }
});

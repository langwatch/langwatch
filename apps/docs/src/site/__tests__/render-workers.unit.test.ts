import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { renderCache } from "../render-cache.ts";
import { runOnWorkers } from "../render-workers.ts";

let root = "";

/* A worker script: answers each job by its kind, so one test can mix outcomes. */
const SCRIPT = `
import { parentPort } from "node:worker_threads";
parentPort.on("message", ({ index, job }) => {
  if (job === "exit") process.exit(0);
  if (job === "crash") throw new Error("thread crashed");
  if (job === "fails") return parentPort.postMessage({ index, error: "page failed" });
  if (job === "invalid") return parentPort.postMessage({ index, result: { page: 1 } });
  parentPort.postMessage({ index, result: { page: job } });
});
`;

function run({ jobs, workers = 2 }: { jobs: string[]; workers?: number }) {
  const file = path.join(root, "worker.mjs");
  writeFileSync(file, SCRIPT);
  return runOnWorkers({
    script: pathToFileURL(file),
    workerData: null,
    jobs,
    workers,
    parseResult: (value) => z.object({ page: z.string() }).parse(value),
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "docs-render-workers-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("renderer threads", () => {
  /** @scenario "Render pages on a bounded number of workers" */
  it("returns outcomes in job order, a failed page as its error", async () => {
    const outcomes = await run({ jobs: ["a", "fails", "c", "d", "e"], workers: 3 });
    expect(outcomes).toEqual([
      { result: { page: "a" } },
      { error: "page failed" },
      { result: { page: "c" } },
      { result: { page: "d" } },
      { result: { page: "e" } },
    ]);
  });

  /** @scenario "Render pages on a bounded number of workers" */
  it("fails when a thread exits cleanly while holding the last page", async () => {
    await expect(run({ jobs: ["a", "exit"], workers: 2 })).rejects.toThrow(
      "before finishing a page",
    );
  });

  /** @scenario "Render pages on a bounded number of workers" */
  it("fails when a thread throws", async () => {
    await expect(run({ jobs: ["a", "b", "crash", "d"], workers: 2 })).rejects.toThrow(
      "thread crashed",
    );
  });

  /** @scenario "Render pages on a bounded number of workers" */
  it("refuses a result that does not match the page shape", async () => {
    await expect(run({ jobs: ["invalid"], workers: 1 })).rejects.toThrow("expected string");
  });
});

describe("shared render cache", () => {
  const page = { page: "<html>", rules: [], search: null };

  /** @scenario "Reuse a page rendered from unchanged inputs" */
  it("keeps another build's fresh entries when pruning", async () => {
    const directory = path.join(root, "render");
    const first = renderCache({ directory });
    const second = renderCache({ directory });
    await first.write({ key: "a".repeat(64), page });
    await second.write({ key: "b".repeat(64), page });
    await first.prune();
    expect(await renderCache({ directory }).read({ key: "b".repeat(64) })).toEqual(page);
  });
});

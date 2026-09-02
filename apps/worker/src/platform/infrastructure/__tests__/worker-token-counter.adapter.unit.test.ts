import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WorkerTiktokenCounterAdapter } from "../worker-token-counter.adapter";

/**
 * Spec: packages/features/trace/specs/span-token-estimation.feature
 *
 * The vendor transport on its own. `node-fetch-cache` is mocked for the whole
 * file so the remote path is deterministic: the real client keeps a one-year
 * disk cache under `node_modules/.cache/tiktoken`, so a test that let it run
 * would pass or fail depending on whether some earlier run had already
 * downloaded the table.
 */
vi.mock("node-fetch-cache", () => ({
  default: {
    create: () => (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  },
  FileSystemCache: class {
    constructor(_options: unknown) {}
  },
}));

describe("WorkerTiktokenCounterAdapter", () => {
  describe("given a local BPE directory holding the encoding file", () => {
    describe("when an encoding is loaded", () => {
      /** @scenario "The tokenizer's local BPE directory is preferred over the network" */
      it("counts with the local table rather than the published one", async () => {
        const directory = await mkdtemp(join(tmpdir(), "langwatch-tiktoken-"));
        // A rank table holding "h" and "i" as separate tokens and no merge for
        // the pair. The published o200k_base table encodes "hi" as ONE token,
        // so a count of two can only have come from this file — which is the
        // whole point: a remote fetch that silently succeeded would answer 1.
        await writeFile(join(directory, "o200k_base.tiktoken"), "aA== 0\naQ== 1\n", "utf8");
        const globalFetch = globalThis.fetch;
        globalThis.fetch = (() => {
          throw new Error("the tokenizer reached the network");
        }) as typeof fetch;

        try {
          const counted = await WorkerTiktokenCounterAdapter.create({
            bpeDirectory: directory,
            fetchTimeoutMs: 10_000,
          }).tryCountTokens("a-model-with-no-registry-entry", "hi");

          expect(counted).toBe(2);
        } finally {
          globalThis.fetch = globalFetch;
        }
      });
    });
  });

  describe("given no text at all", () => {
    describe("when a count is asked for", () => {
      /** @scenario "A tokenizer that cannot count leaves the span untouched" */
      it("answers nothing without loading an encoding", async () => {
        await expect(
          WorkerTiktokenCounterAdapter.create({
            bpeDirectory: undefined,
            fetchTimeoutMs: 10_000,
          }).tryCountTokens("gpt-5-mini", undefined),
        ).resolves.toBeUndefined();
      });
    });
  });
});

describe("WorkerTiktokenCounterAdapter remote fetch", () => {
  describe("given a remote BPE fetch that never settles", () => {
    describe("when the configured timeout elapses", () => {
      /** @scenario "A remote BPE fetch cannot hang the process" */
      it("aborts and leaves the span unestimated", async () => {
        const started = Date.now();

        const counted = await WorkerTiktokenCounterAdapter.create({
          bpeDirectory: undefined,
          fetchTimeoutMs: 50,
        }).tryCountTokens("a-model-with-no-registry-entry", "hi");

        expect(counted).toBeUndefined();
        expect(Date.now() - started).toBeLessThan(5_000);
      });
    });
  });
});

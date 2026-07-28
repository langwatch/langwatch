import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toJsonlChunks } from "../dataset-chunking";
import { createDatasetNormalizeHandler } from "../dataset-normalize.job";
import type { DatasetProgressEvent } from "../dataset-progress";

/**
 * ADR-034: the producer contract for live progress. Unit-tests the normalize
 * handler's emit seam at its boundary (a spy `emitProgress`), with the real
 * streaming parse + chunk writer underneath.
 *
 * The load-bearing guarantees (the ones the red-team caught as ship-breakers):
 *  - I-ORDER: the terminal event is emitted ONLY AFTER the durable status commit
 *    — so a `done`-triggered `getById` refetch can never race back to processing.
 *  - I-BYTES: the denominator is the input-side HEAD size, and the bar reaches
 *    100% (bytesRead === totalBytes) exactly at done.
 *  - a normalize failure commits `failed` THEN emits a terminal error.
 */

const STAGED_SIZE = 1024;

const makeStorage = (stream: Readable) => ({
  writeChunks: vi.fn(
    async ({
      records,
      fromIndex = 0,
    }: {
      records: unknown[];
      fromIndex?: number;
    }) =>
      toJsonlChunks(records).map((c) => ({ ...c, index: c.index + fromIndex })),
  ),
  deleteStaged: vi.fn().mockResolvedValue(undefined),
  deleteChunksFrom: vi.fn().mockResolvedValue(undefined),
  headStagedObjectSize: vi.fn().mockResolvedValue(STAGED_SIZE),
  streamStaged: vi.fn().mockResolvedValue(stream),
  readChunks: vi.fn(),
  createPresignedUpload: vi.fn(),
});

const basePayload = {
  id: "d1",
  tenantId: "p1",
  projectId: "p1",
  datasetId: "d1",
  stagingKey: "staging/p1/u1",
  filename: "data.jsonl",
};

/**
 * Drive the handler recording a single interleaved sequence of repository
 * commits and progress emits, so ordering invariants are directly assertable.
 */
const run = async (stream: Readable) => {
  const sequence: string[] = [];
  const emitted: DatasetProgressEvent[] = [];
  const repo = {
    findOne: vi.fn().mockResolvedValue({ id: "d1", status: "processing" }),
    update: vi.fn(async ({ data }: { data: { status: string } }) => {
      sequence.push(`commit:${data.status}`);
      return {};
    }),
  };
  const emitProgress = vi.fn((_projectId: string, e: DatasetProgressEvent) => {
    sequence.push(`emit:${e.type}`);
    emitted.push(e);
  });
  const handler = createDatasetNormalizeHandler({
    repository: repo as any,
    getStorage: async () => makeStorage(stream) as any,
    emitProgress,
  });
  const result = await handler(basePayload).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  return { sequence, emitted, result };
};

beforeEach(() => vi.clearAllMocks());

describe("dataset-normalize progress", () => {
  describe("when a dataset normalizes successfully", () => {
    it("emits live progress with the input-side total then a terminal done", async () => {
      const { emitted } = await run(Readable.from(['{"a":"1"}\n{"a":"2"}\n']));

      const progress = emitted.find((e) => e.type === "progress");
      expect(progress).toBeDefined();
      expect(progress!.totalBytes).toBe(STAGED_SIZE);

      const done = emitted.find((e) => e.type === "done");
      expect(done).toMatchObject({
        phase: "ready",
        totalBytes: STAGED_SIZE,
        bytesRead: STAGED_SIZE,
        rows: 2,
      });
    });

    it("emits the terminal done strictly after the durable ready commit (I-ORDER)", async () => {
      const { sequence } = await run(Readable.from(['{"a":"1"}\n']));

      const readyIdx = sequence.indexOf("commit:ready");
      const doneIdx = sequence.indexOf("emit:done");
      expect(readyIdx).toBeGreaterThanOrEqual(0);
      expect(doneIdx).toBeGreaterThan(readyIdx);
    });
  });

  describe("when the progress emit throws", () => {
    // Regression: the terminal `done` emit runs AFTER the ready commit, inside
    // the try whose catch deletes every chunk (fromIndex 0). A throwing emit
    // there must NOT flip ready→failed nor wipe the processed dataset.
    it("still commits ready and never deletes the processed chunks", async () => {
      const storage = makeStorage(Readable.from(['{"a":"1"}\n']));
      const repo = {
        findOne: vi.fn().mockResolvedValue({ id: "d1", status: "processing" }),
        update: vi.fn().mockResolvedValue({}),
      };
      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
        emitProgress: () => {
          throw new Error("broadcast down");
        },
      });

      await expect(handler(basePayload)).resolves.toBeUndefined();

      const statuses = repo.update.mock.calls.map(
        (c) => (c[0] as { data: { status: string } }).data.status,
      );
      expect(statuses).toContain("ready");
      expect(statuses).not.toContain("failed");
      // The catch's chunk reap is `fromIndex: 0` (wipe); the success path trims
      // orphans at `fromIndex: chunkCount`. A throwing emit must never trigger
      // the former.
      expect(storage.deleteChunksFrom).not.toHaveBeenCalledWith(
        expect.objectContaining({ fromIndex: 0 }),
      );
    });

    it("still commits ready when the emit rejects asynchronously", async () => {
      const storage = makeStorage(Readable.from(['{"a":"1"}\n']));
      const repo = {
        findOne: vi.fn().mockResolvedValue({ id: "d1", status: "processing" }),
        update: vi.fn().mockResolvedValue({}),
      };
      const handler = createDatasetNormalizeHandler({
        repository: repo as any,
        getStorage: async () => storage as any,
        // An async emitter that rejects must be swallowed, not surface as an
        // unhandled rejection or fail the normalize.
        emitProgress: async () => {
          throw new Error("broadcast down (async)");
        },
      });

      await expect(handler(basePayload)).resolves.toBeUndefined();

      const statuses = repo.update.mock.calls.map(
        (c) => (c[0] as { data: { status: string } }).data.status,
      );
      expect(statuses).toContain("ready");
      expect(statuses).not.toContain("failed");
      expect(storage.deleteChunksFrom).not.toHaveBeenCalledWith(
        expect.objectContaining({ fromIndex: 0 }),
      );
    });
  });

  describe("when the file is malformed", () => {
    it("commits failed then emits a terminal error", async () => {
      const { sequence, emitted, result } = await run(
        Readable.from(["{not valid json\n"]),
      );

      expect(result.ok).toBe(false);
      const failedIdx = sequence.indexOf("commit:failed");
      const errorIdx = sequence.indexOf("emit:error");
      expect(failedIdx).toBeGreaterThanOrEqual(0);
      expect(errorIdx).toBeGreaterThan(failedIdx);
      expect(emitted.at(-1)).toMatchObject({ type: "error", phase: "failed" });
    });
  });
});

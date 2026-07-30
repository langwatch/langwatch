/**
 * Unit tests for the scheduled blob-cleanup sweep — driven directly off
 * `runBlobCleanup`'s clock and its `sweep`/`recordTick` ports, never off an
 * event, since the pipeline carries none.
 *
 * @see specs/event-sourcing/blob-cleanup-sweep.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => mockLogger,
}));

import {
  BLOB_CLEANUP_NAME,
  type BlobCleanupDeps,
  type BlobSweepOutcome,
  createBlobCleanupMount,
  runBlobCleanup,
} from "..";

function outcome(overrides: Partial<BlobSweepOutcome> = {}): BlobSweepOutcome {
  return {
    scanned: 0,
    reclaimed: 0,
    repaired: 0,
    bookkeeping: 0,
    truncated: false,
    failed: 0,
    ...overrides,
  };
}

type MockedDeps = {
  [K in keyof BlobCleanupDeps]: ReturnType<typeof vi.fn>;
} & BlobCleanupDeps;

function makeDeps(overrides: Partial<BlobCleanupDeps> = {}): MockedDeps {
  return {
    sweep: vi.fn().mockResolvedValue(outcome()),
    recordTick: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(10_000_000),
    ...overrides,
  } as MockedDeps;
}

function makeMetrics() {
  const inc = vi.fn();
  return {
    metrics: {
      counter: vi.fn().mockReturnValue({ inc }),
      histogram: vi.fn().mockReturnValue({ observe: vi.fn() }),
    },
    inc,
  };
}

describe("runBlobCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the sweep's fixed interval wakes it, with blobs to reclaim", () => {
    /** @scenario "The scheduled sweep reclaims unreferenced blobs" */
    it("sweeps the keyspace and records the tick once", async () => {
      const deps = makeDeps({
        sweep: vi.fn().mockResolvedValue(outcome({ scanned: 9, reclaimed: 3 })),
      });

      await runBlobCleanup(deps)();

      expect(deps.sweep).toHaveBeenCalledOnce();
      expect(deps.recordTick).toHaveBeenCalledOnce();
    });
  });

  describe("given a queue's blob keyspace exceeds the per-queue scan ceiling", () => {
    /** @scenario "A truncated scan is reported, not folded into a healthy total" */
    it("completes the tick without raising, and logs the truncation on its own line", async () => {
      const deps = makeDeps({
        sweep: vi
          .fn()
          .mockResolvedValue(outcome({ scanned: 50_000, truncated: true })),
      });

      await expect(runBlobCleanup(deps)()).resolves.toBeUndefined();
      // Truncation looks exactly like a healthy sweep in the reclaim/repair
      // totals, so it must be visible on its own line rather than folded
      // silently into a "tick succeeded" report.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ scanned: 50_000 }),
        expect.stringContaining("scan ceiling"),
      );
    });
  });

  describe("given the sweep evaluates a mix of blobs, some of which fail", () => {
    const deps = () =>
      makeDeps({
        sweep: vi
          .fn()
          .mockResolvedValue(outcome({ scanned: 10, reclaimed: 6, failed: 4 })),
      });

    /** @scenario "Candidate failures are counted on the same metric as successes" */
    it("counts both the succeeded and the failed blobs on one metric", async () => {
      const { metrics, inc } = makeMetrics();
      const d = deps();

      await expect(runBlobCleanup({ ...d, metrics })()).rejects.toThrow();

      expect(metrics.counter).toHaveBeenCalledWith(
        expect.objectContaining({ name: "es_blob_cleanup_candidates_total" }),
      );
      expect(inc).toHaveBeenCalledWith({ outcome: "success" }, 6);
      expect(inc).toHaveBeenCalledWith({ outcome: "failure" }, 4);
    });

    /** @scenario "A tick with any candidate failures is retried" */
    it("raises so the whole tick is retried", async () => {
      const d = deps();

      await expect(runBlobCleanup(d)()).rejects.toThrow(
        /failed to evaluate 4 of 10/,
      );

      // Retrying is free — a blob already reclaimed stays reclaimed — so the
      // whole tick, not a partial replay, is what gets retried.
      expect(d.recordTick).toHaveBeenCalledOnce();
    });
  });

  describe("given the sweep's underlying walk fails outright", () => {
    /** @scenario "A sweep that cannot even walk the keyspace is retried" */
    it("raises so the tick is retried, and still records that it ran", async () => {
      const deps = makeDeps({
        sweep: vi.fn().mockRejectedValue(new Error("redis unavailable")),
      });

      await expect(runBlobCleanup(deps)()).rejects.toThrow("redis unavailable");

      expect(deps.recordTick).toHaveBeenCalledOnce();
    });
  });

  describe("given the sweep reclaims blobs successfully, and recording the tick fails", () => {
    /** @scenario "A bookkeeping failure does not fail a successful sweep" */
    it("does not report the sweep itself as failed", async () => {
      const deps = makeDeps({
        sweep: vi.fn().mockResolvedValue(outcome({ scanned: 4, reclaimed: 4 })),
        recordTick: vi
          .fn()
          .mockRejectedValue(new Error("bookkeeping store unavailable")),
      });

      await expect(runBlobCleanup(deps)()).resolves.toBeUndefined();
    });
  });

  describe("given the sweep fails, and recording the tick also fails", () => {
    /** @scenario "Tick bookkeeping still runs after the sweep fails" */
    it("still raises the sweep's own failure, not the bookkeeping one", async () => {
      const deps = makeDeps({
        sweep: vi.fn().mockRejectedValue(new Error("redis unavailable")),
        recordTick: vi
          .fn()
          .mockRejectedValue(new Error("bookkeeping store unavailable")),
      });

      await expect(runBlobCleanup(deps)()).rejects.toThrow("redis unavailable");
      expect(deps.recordTick).toHaveBeenCalledOnce();
    });
  });
});

describe("createBlobCleanupMount", () => {
  /** @scenario "The mount carries the five-minute interval and runs the same sweep logic" */
  it("names itself, carries the interval, and runs the same sweep through run()", async () => {
    const deps = makeDeps({
      sweep: vi.fn().mockResolvedValue(outcome({ scanned: 1, reclaimed: 1 })),
    });
    const mount = createBlobCleanupMount(deps);

    expect(mount.name).toBe(BLOB_CLEANUP_NAME);
    expect(mount.intervalMs).toBe(5 * 60 * 1000);

    await mount.run();

    expect(deps.sweep).toHaveBeenCalledOnce();
  });
});

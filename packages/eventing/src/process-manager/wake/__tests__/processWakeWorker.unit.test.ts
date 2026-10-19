import { createTestLogger, type TestLogLine, type TestLogLines } from "@langwatch/test-harness";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DueWake } from "../../stores/processStore.types.ts";
import { ProcessWakeWorker } from "../processWakeWorker.ts";
import { WAKE_CLAIM_LEASE_MS } from "../wakeClaim.ts";

function linesAt(lines: TestLogLines, level: "warn" | "error"): TestLogLine[] {
  const wanted = level === "warn" ? 40 : 50;
  return lines.filter((line) => line.level === wanted);
}

function dueWake(overrides: Partial<DueWake["ref"]> = {}): DueWake {
  return {
    ref: {
      processName: "topicClustering",
      projectId: "project-1",
      processKey: "project-1",
      ...overrides,
    },
    revision: 3,
    wakeAt: 1_000,
  };
}

/** The release half of the store port, for tests whose wakes are all handled. */
const releaseWakeClaim = () => Promise.resolve({ applied: true });

const committed = {
  outcome: "committed" as const,
  revision: 4,
  insertedMessageKeys: ["run:20260717"],
  duplicateMessageKeys: [],
};

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessWakeWorker", () => {
  describe("when a wake is due for a registered process", () => {
    it("hands it to that process manager and nudges the outbox", async () => {
      const handleWake = vi.fn().mockResolvedValue(committed);
      const leaseDueWakes = vi.fn().mockResolvedValue([dueWake()]);
      const notifyOutbox = vi.fn();
      const worker = new ProcessWakeWorker({
        store: { leaseDueWakes, releaseWakeClaim },
        managers: { topicClustering: { handleWake } },
        logger: createTestLogger().logger,
        notifyOutbox,
        batchSize: 7,
        now: () => 123,
      });

      worker.start();
      await vi.waitFor(() => expect(handleWake).toHaveBeenCalledTimes(1));

      expect(leaseDueWakes).toHaveBeenCalledWith({
        now: 123,
        limit: 7,
        leaseDurationMs: WAKE_CLAIM_LEASE_MS,
        processNames: ["topicClustering"],
      });
      expect(handleWake).toHaveBeenCalledWith({ wake: dueWake(), now: 123 });
      expect(notifyOutbox).toHaveBeenCalledTimes(1);
      expect(notifyOutbox).toHaveBeenCalledWith("topicClustering");
      await worker.stop();
    });

    it("skips the outbox nudge when the commit inserted no intents", async () => {
      const handleWake = vi.fn().mockResolvedValue({ ...committed, insertedMessageKeys: [] });
      const notifyOutbox = vi.fn();
      const worker = new ProcessWakeWorker({
        store: { leaseDueWakes: vi.fn().mockResolvedValue([dueWake()]), releaseWakeClaim },
        managers: { topicClustering: { handleWake } },
        logger: createTestLogger().logger,
        notifyOutbox,
      });

      worker.start();
      await vi.waitFor(() => expect(handleWake).toHaveBeenCalledTimes(1));

      expect(notifyOutbox).not.toHaveBeenCalled();
      await worker.stop();
    });
  });

  describe("when a wake is stale because the process advanced", () => {
    it("stands down without logging an error", async () => {
      const { logger, lines } = createTestLogger();
      const handleWake = vi.fn().mockResolvedValue({ outcome: "staleWake" });
      const worker = new ProcessWakeWorker({
        store: { leaseDueWakes: vi.fn().mockResolvedValue([dueWake()]), releaseWakeClaim },
        managers: { topicClustering: { handleWake } },
        logger,
      });

      worker.start();
      await vi.waitFor(() => expect(handleWake).toHaveBeenCalledTimes(1));

      expect(linesAt(lines, "error")).toHaveLength(0);
      expect(linesAt(lines, "warn")).toHaveLength(0);
      await worker.stop();
    });
  });

  describe("when a due wake has no registered process manager", () => {
    it("logs and skips it without failing the scan", async () => {
      const { logger, lines } = createTestLogger();
      const handleWake = vi.fn().mockResolvedValue(committed);
      const worker = new ProcessWakeWorker({
        store: {
          leaseDueWakes: vi
            .fn()
            .mockResolvedValue([dueWake({ processName: "unknownProcess" }), dueWake()]),
          releaseWakeClaim,
        },
        managers: { topicClustering: { handleWake } },
        logger,
      });

      worker.start();
      await vi.waitFor(() => expect(handleWake).toHaveBeenCalledTimes(1));

      expect(linesAt(lines, "warn")).toHaveLength(1);
      expect(handleWake).toHaveBeenCalledWith({
        wake: dueWake(),
        now: expect.any(Number),
      });
      await worker.stop();
    });
  });

  describe("when handling one wake throws", () => {
    it("logs it, continues the batch, and the next poll retries", async () => {
      vi.useFakeTimers();
      const { logger, lines } = createTestLogger();
      const handleWake = vi
        .fn()
        .mockRejectedValueOnce(new Error("database unavailable"))
        .mockResolvedValue(committed);
      const release = vi.fn().mockResolvedValue({ applied: true });
      const worker = new ProcessWakeWorker({
        store: {
          leaseDueWakes: vi
            .fn()
            .mockResolvedValueOnce([dueWake(), dueWake({ projectId: "p2" })])
            .mockResolvedValueOnce([dueWake()])
            .mockResolvedValue([]),
          releaseWakeClaim: release,
        },
        managers: { topicClustering: { handleWake } },
        logger,
        intervalMs: 100,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(handleWake).toHaveBeenCalledTimes(2);
      // Warning, not error: the wake is retried on the next poll, which the
      // log line says in as many words.
      expect(linesAt(lines, "warn")).toHaveLength(1);
      expect(linesAt(lines, "error")).toHaveLength(0);
      expect(release).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith({
        ref: dueWake().ref,
        wakeAt: dueWake().wakeAt,
        claimedUntil: Date.now() + WAKE_CLAIM_LEASE_MS,
      });

      await vi.advanceTimersByTimeAsync(100);
      expect(handleWake).toHaveBeenCalledTimes(3);
      await worker.stop();
    });
  });

  describe("when polling is faster than wake handling", () => {
    it("never overlaps scans", async () => {
      vi.useFakeTimers();
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const leaseDueWakes = vi.fn().mockImplementation(async () => {
        await blocked;
        return [];
      });
      const worker = new ProcessWakeWorker({
        store: { leaseDueWakes, releaseWakeClaim },
        managers: {},
        logger: createTestLogger().logger,
        intervalMs: 50,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(200);
      expect(leaseDueWakes).toHaveBeenCalledTimes(1);

      release();
      await vi.advanceTimersByTimeAsync(50);
      expect(leaseDueWakes).toHaveBeenCalledTimes(2);
      await worker.stop();
    });
  });
});

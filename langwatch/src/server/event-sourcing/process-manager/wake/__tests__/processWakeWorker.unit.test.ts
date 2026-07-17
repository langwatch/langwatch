import type { Logger } from "@langwatch/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DueWake } from "../../stores/processStore.types";
import { ProcessWakeWorker } from "../processWakeWorker";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
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
      const findDueWakes = vi.fn().mockResolvedValue([dueWake()]);
      const notifyOutbox = vi.fn();
      const worker = new ProcessWakeWorker({
        store: { findDueWakes },
        managers: { topicClustering: { handleWake } },
        logger: makeLogger(),
        notifyOutbox,
        batchSize: 7,
        now: () => 123,
      });

      worker.start();
      await vi.waitFor(() => expect(handleWake).toHaveBeenCalledTimes(1));

      expect(findDueWakes).toHaveBeenCalledWith({ now: 123, limit: 7 });
      expect(handleWake).toHaveBeenCalledWith({ wake: dueWake(), now: 123 });
      expect(notifyOutbox).toHaveBeenCalledTimes(1);
      await worker.stop();
    });

    it("skips the outbox nudge when the commit inserted no intents", async () => {
      const handleWake = vi
        .fn()
        .mockResolvedValue({ ...committed, insertedMessageKeys: [] });
      const notifyOutbox = vi.fn();
      const worker = new ProcessWakeWorker({
        store: { findDueWakes: vi.fn().mockResolvedValue([dueWake()]) },
        managers: { topicClustering: { handleWake } },
        logger: makeLogger(),
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
      const logger = makeLogger();
      const handleWake = vi.fn().mockResolvedValue({ outcome: "staleWake" });
      const worker = new ProcessWakeWorker({
        store: { findDueWakes: vi.fn().mockResolvedValue([dueWake()]) },
        managers: { topicClustering: { handleWake } },
        logger,
      });

      worker.start();
      await vi.waitFor(() => expect(handleWake).toHaveBeenCalledTimes(1));

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      await worker.stop();
    });
  });

  describe("when a due wake has no registered process manager", () => {
    it("logs and skips it without failing the scan", async () => {
      const logger = makeLogger();
      const handleWake = vi.fn().mockResolvedValue(committed);
      const worker = new ProcessWakeWorker({
        store: {
          findDueWakes: vi
            .fn()
            .mockResolvedValue([
              dueWake({ processName: "unknownProcess" }),
              dueWake(),
            ]),
        },
        managers: { topicClustering: { handleWake } },
        logger,
      });

      worker.start();
      await vi.waitFor(() => expect(handleWake).toHaveBeenCalledTimes(1));

      expect(logger.warn).toHaveBeenCalledTimes(1);
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
      const logger = makeLogger();
      const handleWake = vi
        .fn()
        .mockRejectedValueOnce(new Error("database unavailable"))
        .mockResolvedValue(committed);
      const worker = new ProcessWakeWorker({
        store: {
          findDueWakes: vi
            .fn()
            .mockResolvedValueOnce([dueWake(), dueWake({ projectId: "p2" })])
            .mockResolvedValueOnce([dueWake()])
            .mockResolvedValue([]),
        },
        managers: { topicClustering: { handleWake } },
        logger,
        intervalMs: 100,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(handleWake).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledTimes(1);

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
      const findDueWakes = vi.fn().mockImplementation(async () => {
        await blocked;
        return [];
      });
      const worker = new ProcessWakeWorker({
        store: { findDueWakes },
        managers: {},
        logger: makeLogger(),
        intervalMs: 50,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(200);
      expect(findDueWakes).toHaveBeenCalledTimes(1);

      release();
      await vi.advanceTimersByTimeAsync(50);
      expect(findDueWakes).toHaveBeenCalledTimes(2);
      await worker.stop();
    });
  });
});

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Unit coverage for scheduleIngestionPullers — the worker-boot scheduling
 * pass that registers one BullMQ repeatable job per pull-mode
 * IngestionSource. Prisma and the queue are stubbed at the module
 * boundary; the assertions pin the idempotent `puller_tick:<id>` jobId
 * scheme, the cron pattern passthrough, and per-source error isolation.
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { addMock, findManyMock } = vi.hoisted(() => ({
  addMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: { ingestionSource: { findMany: findManyMock } },
}));
vi.mock("~/server/redis", () => ({ connection: {} }));
vi.mock("~/server/queues/queueWithFallback", () => ({
  QueueWithFallback: class {
    add = addMock;
  },
}));
vi.mock("../pullerWorker", () => ({
  PULLER_QUEUE: { NAME: "{ingestion_puller}", JOB: "ingestion_puller" },
}));

import { scheduleIngestionPullers } from "../pullerQueue";

describe("scheduleIngestionPullers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addMock.mockResolvedValue(undefined);
  });

  describe("given sources with a pullSchedule set", () => {
    beforeEach(() => {
      findManyMock.mockResolvedValue([
        { id: "src-1", pullSchedule: "*/5 * * * *", status: "active" },
        {
          id: "src-2",
          pullSchedule: "0 * * * *",
          status: "awaiting_first_event",
        },
      ]);
    });

    it("registers one repeatable job per source keyed by puller_tick:<id>", async () => {
      await scheduleIngestionPullers();

      expect(addMock).toHaveBeenCalledTimes(2);
      expect(addMock).toHaveBeenCalledWith(
        "ingestion_puller",
        expect.objectContaining({ ingestionSourceId: "src-1" }),
        {
          jobId: "puller_tick:src-1",
          repeat: { pattern: "*/5 * * * *" },
        },
      );
      expect(addMock).toHaveBeenCalledWith(
        "ingestion_puller",
        expect.objectContaining({ ingestionSourceId: "src-2" }),
        {
          jobId: "puller_tick:src-2",
          repeat: { pattern: "0 * * * *" },
        },
      );
    });

    describe("when scheduling one source throws", () => {
      it("continues scheduling the remaining sources", async () => {
        addMock.mockRejectedValueOnce(new Error("redis hiccup"));

        await expect(scheduleIngestionPullers()).resolves.toBeUndefined();

        expect(addMock).toHaveBeenCalledTimes(2);
        expect(addMock).toHaveBeenLastCalledWith(
          "ingestion_puller",
          expect.objectContaining({ ingestionSourceId: "src-2" }),
          expect.objectContaining({ jobId: "puller_tick:src-2" }),
        );
      });
    });
  });

  describe("given no eligible sources", () => {
    it("schedules nothing", async () => {
      findManyMock.mockResolvedValue([]);

      await scheduleIngestionPullers();

      expect(addMock).not.toHaveBeenCalled();
    });
  });

  describe("when enumerating sources fails", () => {
    it("returns without scheduling instead of throwing", async () => {
      findManyMock.mockRejectedValue(new Error("db down"));

      await expect(scheduleIngestionPullers()).resolves.toBeUndefined();

      expect(addMock).not.toHaveBeenCalled();
    });
  });
});

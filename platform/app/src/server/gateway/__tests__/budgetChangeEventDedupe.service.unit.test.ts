import type IORedis from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUDGET_CHANGE_EVENT_WINDOW_SECONDS,
  createBudgetChangeEventDedupeService,
  RedisBudgetChangeEventDedupeService,
} from "../budgetChangeEventDedupe.service";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function redisStub(set: ReturnType<typeof vi.fn>) {
  return { set } as unknown as IORedis;
}

describe("budget change-event dedupe", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given a project with no emission in the current window", () => {
    describe("when a debit asks whether to emit", () => {
      it("allows the emission", async () => {
        const set = vi.fn().mockResolvedValue("OK");
        const service = new RedisBudgetChangeEventDedupeService(redisStub(set));

        await expect(
          service.shouldEmit({ projectId: "project-1" }),
        ).resolves.toBe(true);
      });

      it("claims the window with a fixed expiry, not a sliding one", async () => {
        const set = vi.fn().mockResolvedValue("OK");
        const service = new RedisBudgetChangeEventDedupeService(redisStub(set));

        await service.shouldEmit({ projectId: "project-1" });

        // NX means a busy project cannot push its own refresh back by
        // re-claiming the key on every request.
        expect(set).toHaveBeenCalledWith(
          "gateway_budget_change:project-1",
          "1",
          "EX",
          BUDGET_CHANGE_EVENT_WINDOW_SECONDS,
          "NX",
        );
      });
    });
  });

  describe("given a project that already emitted inside the window", () => {
    describe("when a later debit asks whether to emit", () => {
      it("declines the redundant emission", async () => {
        const set = vi.fn().mockResolvedValue(null);
        const service = new RedisBudgetChangeEventDedupeService(redisStub(set));

        await expect(
          service.shouldEmit({ projectId: "project-1" }),
        ).resolves.toBe(false);
      });
    });

    describe("when a different project asks in the same window", () => {
      it("keys them apart", async () => {
        const set = vi.fn().mockResolvedValue("OK");
        const service = new RedisBudgetChangeEventDedupeService(redisStub(set));

        await service.shouldEmit({ projectId: "project-1" });
        await service.shouldEmit({ projectId: "project-2" });

        expect(set.mock.calls[0]?.[0]).toBe("gateway_budget_change:project-1");
        expect(set.mock.calls[1]?.[0]).toBe("gateway_budget_change:project-2");
      });
    });
  });

  describe("given Redis is unavailable", () => {
    describe("when a debit asks whether to emit", () => {
      it("fails toward emitting rather than withholding an invalidation", async () => {
        const set = vi.fn().mockRejectedValue(new Error("connection refused"));
        const service = new RedisBudgetChangeEventDedupeService(redisStub(set));

        await expect(
          service.shouldEmit({ projectId: "project-1" }),
        ).resolves.toBe(true);
      });
    });
  });

  describe("given no Redis connection at all", () => {
    describe("when a debit asks whether to emit", () => {
      it("emits every time, matching the pre-dedupe behavior", async () => {
        const service = createBudgetChangeEventDedupeService(null);

        await expect(
          service.shouldEmit({ projectId: "project-1" }),
        ).resolves.toBe(true);
        await expect(
          service.shouldEmit({ projectId: "project-1" }),
        ).resolves.toBe(true);
      });
    });
  });

  describe("window sizing", () => {
    it("is at least the change-feed poll granularity", () => {
      // The /changes loop re-reads every 2s, so a window below that would
      // suppress nothing the consumer had not already coalesced.
      expect(BUDGET_CHANGE_EVENT_WINDOW_SECONDS).toBeGreaterThanOrEqual(2);
    });

    it("does not exceed the long-poll hold it is matched to", () => {
      // Matched to the default `timeout_s` hold: one eviction per poll cycle.
      expect(BUDGET_CHANGE_EVENT_WINDOW_SECONDS).toBeLessThanOrEqual(10);
    });
  });
});

/** Spec: modules/trace/specs/trace-ops-reads.feature */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

import { MemoryTracePlanLimitRefusalsRepository } from "../../../../repositories/memory/memory.trace-plan-limit-refusals.repository.ts";
import { TraceIngestAllowanceService } from "../trace-ingest-allowance.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const dayStart = Date.UTC(2026, 10, 25);
const now = dayStart + 13 * 60 * 60 * 1000;

class PlanLimitError extends HandledError {
  constructor() {
    super("ERR_PLAN_LIMIT", "over the plan limit", { httpStatus: 429 });
  }
}

const overLimit = { assertWithinUsageLimit: () => Promise.reject(new PlanLimitError()) };

describe("plan-limit refusal counting", () => {
  describe("given a project whose organization is over its plan limit", () => {
    /** @scenario A plan-limit refusal is counted for the project and the day */
    it("refuses the request and counts one refusal on that UTC day", async () => {
      const refusals = MemoryTracePlanLimitRefusalsRepository.create();
      const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
      const service = TraceIngestAllowanceService.create({
        entitlement: overLimit,
        refusals,
        logger,
        now: () => now,
      });

      await expect(
        service.assertWithinAllowance({ projectId: "p1", organizationId: "o1" }),
      ).rejects.toMatchObject({ code: "ERR_PLAN_LIMIT" });

      const counts = await refusals.countRefusals({
        projectIds: ["p1"],
        fromDayMs: dayStart,
        toDayMs: dayStart,
      });
      expect(counts.get("p1")).toBe(1);
      const nextDay = await refusals.countRefusals({
        projectIds: ["p1"],
        fromDayMs: dayStart + DAY_MS,
        toDayMs: dayStart + DAY_MS,
      });
      expect(nextDay.get("p1") ?? 0).toBe(0);
    });

    /** @scenario A plan-limit refusal is counted for the project and the day */
    it("counts nothing when the request is within the allowance", async () => {
      const refusals = MemoryTracePlanLimitRefusalsRepository.create();
      const service = TraceIngestAllowanceService.create({
        entitlement: { assertWithinUsageLimit: () => Promise.resolve() },
        refusals,
        logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
        now: () => now,
      });

      await service.assertWithinAllowance({ projectId: "p1", organizationId: "o1" });

      const counts = await refusals.countRefusals({
        projectIds: ["p1"],
        fromDayMs: dayStart,
        toDayMs: dayStart,
      });
      expect(counts.get("p1") ?? 0).toBe(0);
    });
  });

  describe("given the refusal counter fails to write", () => {
    /** @scenario A refusal that cannot be counted is still refused */
    it("still refuses with the plan limit and warns about the failed count", async () => {
      const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
      const service = TraceIngestAllowanceService.create({
        entitlement: overLimit,
        refusals: { recordRefusal: () => Promise.reject(new Error("connection reset")) },
        logger,
        now: () => now,
      });

      await expect(
        service.assertWithinAllowance({ projectId: "p1", organizationId: "o1" }),
      ).rejects.toBeInstanceOf(PlanLimitError);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "p1" }),
        "Failed to count a plan-limit refusal",
      );
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});

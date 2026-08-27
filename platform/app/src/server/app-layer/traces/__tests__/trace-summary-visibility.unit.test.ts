import { describe, expect, it, vi } from "vitest";

import { TraceSummaryService } from "../trace-summary.service";
import { TEASER_ELLIPSIS, TEASER_MAX_CHARS } from "../visibility-window.service";

const DAY_MS = 24 * 60 * 60 * 1000;

const makeSummary = (occurredDaysAgo: number) => ({
  traceId: "trace-1",
  occurredAt: Date.now() - occurredDaysAgo * DAY_MS,
  computedInput: "i".repeat(5000),
  computedOutput: "o".repeat(5000),
  errorMessage: "boom " + "e".repeat(2000),
  spanCount: 3,
  totalDurationMs: 120,
  attributes: { "service.name": "svc" },
});

const makeService = (summary: unknown) =>
  new TraceSummaryService({
    findByTraceId: vi.fn().mockResolvedValue(summary),
    upsert: vi.fn(),
  } as never);

describe("given a trace summary read with a visibility gate", () => {
  describe("when the summary is older than the cutoff", () => {
    it("teases computed input, output, and error message", async () => {
      const service = makeService(makeSummary(20));
      const summary = await service.getByTraceId("project-1", "trace-1", {
        visibilityCutoffMs: Date.now() - 14 * DAY_MS,
      });
      expect(summary.computedInput).toHaveLength(TEASER_MAX_CHARS + TEASER_ELLIPSIS.length);
      expect(summary.computedOutput).toHaveLength(TEASER_MAX_CHARS + TEASER_ELLIPSIS.length);
      expect(summary.errorMessage!.length).toBeLessThanOrEqual(
        TEASER_MAX_CHARS + TEASER_ELLIPSIS.length,
      );
    });

    it("marks the summary as redacted and keeps metadata intact", async () => {
      const service = makeService(makeSummary(20));
      const summary = await service.getByTraceId("project-1", "trace-1", {
        visibilityCutoffMs: Date.now() - 14 * DAY_MS,
      });
      expect(summary.redactedByVisibilityWindow).toBe(true);
      expect(summary.spanCount).toBe(3);
      expect(summary.totalDurationMs).toBe(120);
      expect(summary.attributes).toEqual({ "service.name": "svc" });
    });
  });

  describe("when the summary is within the window", () => {
    it("returns full content and no flag", async () => {
      const service = makeService(makeSummary(5));
      const summary = await service.getByTraceId("project-1", "trace-1", {
        visibilityCutoffMs: Date.now() - 14 * DAY_MS,
      });
      expect(summary.computedInput).toHaveLength(5000);
      expect(summary.redactedByVisibilityWindow).toBeUndefined();
    });
  });

  describe("when no cutoff is passed (internal callers)", () => {
    it("returns the summary untouched", async () => {
      const service = makeService(makeSummary(40));
      const summary = await service.getByTraceId("project-1", "trace-1");
      expect(summary.computedInput).toHaveLength(5000);
      expect(summary.redactedByVisibilityWindow).toBeUndefined();
    });
  });
});

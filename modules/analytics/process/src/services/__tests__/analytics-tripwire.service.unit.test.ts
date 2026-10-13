import type * as observabilityModule from "@langwatch/observability";
/**
 * The tripwire only logs: a routed read that drifts from the legacy read is named in a
 * warning, a read that agrees within the tolerance is silent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => logged,
}));

// This package may run with `isolate: false`: reset so the import below binds the mock.
vi.resetModules();

const { LoggingAnalyticsTripwireService } = await import("../analytics-tripwire.service.ts");

const resultOf = (cost: number) => ({
  previousPeriod: [],
  currentPeriod: [{ date: "2026-01-01", "0/performance.total_cost/sum": cost }],
});

const tripwire = LoggingAnalyticsTripwireService.create({ isEnabled: () => Promise.resolve(true) });

describe("LoggingAnalyticsTripwireService.compare", () => {
  beforeEach(() => logged.warn.mockClear());

  describe("when the routed and legacy results disagree beyond the tolerance", () => {
    /** @scenario "A routed result that diverges from the legacy result is logged" */
    it("warns with the project, the table and the diverging metric", () => {
      tripwire.compare({
        projectId: "project-1",
        table: "trace_analytics_rollup",
        routed: resultOf(50),
        legacy: resultOf(100),
      });

      expect(logged.warn).toHaveBeenCalledTimes(1);
      const [fields] = logged.warn.mock.calls[0] ?? [];
      expect(fields).toMatchObject({
        projectId: "project-1",
        table: "trace_analytics_rollup",
        divergenceCount: 1,
        divergences: [
          {
            period: "current",
            date: "2026-01-01",
            metric: "0/performance.total_cost/sum",
            routed: 50,
            legacy: 100,
          },
        ],
      });
    });
  });

  describe("when the two results agree within the tolerance", () => {
    /** @scenario "A routed result that diverges from the legacy result is logged" */
    it("logs nothing", () => {
      tripwire.compare({
        projectId: "project-1",
        table: "trace_analytics_rollup",
        routed: resultOf(100),
        legacy: resultOf(100.0001),
      });

      expect(logged.warn).not.toHaveBeenCalled();
    });
  });
});

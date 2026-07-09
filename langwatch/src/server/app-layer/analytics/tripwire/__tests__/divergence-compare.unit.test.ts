/**
 * Unit tests for the ADR-034 tripwire comparator.
 *
 * The tripwire is the only automated signal that a routed read diverged from
 * legacy `trace_summaries` once `release_event_sourced_analytics_read` is on,
 * so its blind spots are the ones that reach customers. These tests pin the
 * two it used to have: grouped buckets (nested objects, never compared) and
 * buckets present on one side only (silently skipped).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeseriesResult } from "~/server/analytics/types";
import { compareForTripwire } from "../divergence-compare";

const warn = vi.fn();
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    warn: (...args: unknown[]) => warn(...args),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function result(
  current: TimeseriesResult["currentPeriod"],
): TimeseriesResult {
  return { currentPeriod: current, previousPeriod: [] };
}

/** The structured payload passed to `logger.warn`. */
function lastWarnPayload(): {
  divergenceCount: number;
  divergences: Array<{ kind: string; metric: string }>;
} {
  expect(warn).toHaveBeenCalled();
  return warn.mock.calls.at(-1)?.[0] as never;
}

describe("compareForTripwire", () => {
  beforeEach(() => warn.mockClear());

  describe("given identical ungrouped results", () => {
    it("logs nothing", () => {
      const same = () => result([{ date: "2026-07-01", "0/cost/sum": 10 }]);
      compareForTripwire({
        projectId: "p1",
        table: "trace_analytics_rollup",
        routed: same(),
        legacy: same(),
      });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("given an ungrouped value beyond tolerance", () => {
    it("logs a value divergence", () => {
      compareForTripwire({
        projectId: "p1",
        table: "trace_analytics_rollup",
        routed: result([{ date: "2026-07-01", "0/cost/sum": 10 }]),
        legacy: result([{ date: "2026-07-01", "0/cost/sum": 20 }]),
      });
      const payload = lastWarnPayload();
      expect(payload.divergenceCount).toBe(1);
      expect(payload.divergences[0]?.kind).toBe("value");
    });
  });

  describe("given GROUPED results whose per-group values diverge", () => {
    // Regression: the comparator used to `continue` on any non-number, so a
    // nested `{ "metadata.model": { "gpt-4": { … } } }` bucket compared nothing
    // and the tripwire could never fire for the riskiest routed shape.
    it("recurses into group keys and flags the diverging group", () => {
      compareForTripwire({
        projectId: "p1",
        table: "trace_analytics",
        routed: result([
          {
            date: "2026-07-01",
            "metadata.model": {
              "gpt-4": { "0/cost/sum": 10 },
              "text-embedding-3": { "0/cost/sum": 1 },
            },
          },
        ]),
        legacy: result([
          {
            date: "2026-07-01",
            "metadata.model": {
              "gpt-4": { "0/cost/sum": 30 },
              "text-embedding-3": { "0/cost/sum": 1 },
            },
          },
        ]),
      });
      const payload = lastWarnPayload();
      expect(payload.divergenceCount).toBe(1);
      expect(payload.divergences[0]).toMatchObject({
        kind: "value",
        metric: "metadata.model.gpt-4.0/cost/sum",
      });
    });

    it("logs nothing when every group matches", () => {
      const same = () =>
        result([
          {
            date: "2026-07-01",
            "metadata.model": { "gpt-4": { "0/cost/sum": 10 } },
          },
        ]);
      compareForTripwire({
        projectId: "p1",
        table: "trace_analytics",
        routed: same(),
        legacy: same(),
      });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("given a group key present on one side only", () => {
    it("flags it as a missing metric rather than ignoring it", () => {
      compareForTripwire({
        projectId: "p1",
        table: "trace_analytics",
        routed: result([
          {
            date: "2026-07-01",
            "metadata.model": { unknown: { "0/cost/sum": 10 } },
          },
        ]),
        legacy: result([
          {
            date: "2026-07-01",
            "metadata.model": { "gpt-4": { "0/cost/sum": 10 } },
          },
        ]),
      });
      const payload = lastWarnPayload();
      expect(payload.divergenceCount).toBe(2);
      expect(payload.divergences.map((d) => d.kind)).toEqual([
        "missing-metric",
        "missing-metric",
      ]);
    });
  });

  describe("given a date bucket the routed result dropped", () => {
    it("flags a missing bucket instead of silently skipping it", () => {
      compareForTripwire({
        projectId: "p1",
        table: "trace_analytics_rollup",
        routed: result([{ date: "2026-07-01", "0/cost/sum": 10 }]),
        legacy: result([
          { date: "2026-07-01", "0/cost/sum": 10 },
          { date: "2026-07-02", "0/cost/sum": 5 },
        ]),
      });
      const payload = lastWarnPayload();
      expect(payload.divergenceCount).toBe(1);
      expect(payload.divergences[0]).toMatchObject({
        kind: "missing-bucket",
        date: "2026-07-02",
      });
    });
  });

  describe("given a comparator failure", () => {
    it("never throws into the read path", () => {
      expect(() =>
        compareForTripwire({
          projectId: "p1",
          table: "trace_analytics",
          routed: null as never,
          legacy: result([]),
        }),
      ).not.toThrow();
    });
  });
});

import { describe, expect, it } from "vitest";
import { buildMassTimeline } from "../mass-timeline";
import { DAY_MS } from "../seed-primitives";

const NOW = Date.UTC(2026, 6, 23, 12, 0, 0);

describe("buildMassTimeline", () => {
  describe("given a three-month window", () => {
    const timeline = buildMassTimeline({ months: 3, now: NOW });

    // @scenario "The mass preset fills months of data across every product"
    it("spans ninety completed days of scenario and experiment history", () => {
      expect(timeline.days).toBe(90);
      expect(timeline.lastDayStart).toBeLessThan(NOW);
      expect(timeline.firstDayStart).toBe(
        timeline.lastDayStart - 89 * DAY_MS,
      );
      // Every day runs at least the three core scenarios.
      expect(timeline.scenarioRuns.length).toBeGreaterThanOrEqual(90 * 3);
      // One baseline+improved experiment pair per week.
      expect(timeline.experimentRuns.length).toBe(Math.ceil(90 / 7) * 2);
      const oldest = Math.min(...timeline.scenarioRuns.map((r) => r.startedAt));
      expect(NOW - oldest).toBeGreaterThan(85 * DAY_MS);
    });

    // @scenario "Traces cover the whole window without weakening the collector's guard"
    it("attaches a trace to every run and every day, on both sides of the collector's window", () => {
      const cutoff = NOW - 30 * DAY_MS;
      for (const run of timeline.scenarioRuns) {
        expect(run.trace.finishedAtMs).toBe(run.startedAt + run.latencyMs);
      }
      const startedAt = (trace: { finishedAtMs?: number; latencyMs: number }) =>
        trace.finishedAtMs! - trace.latencyMs;
      const all = [
        ...timeline.scenarioRuns.map((run) => run.trace),
        ...timeline.organicTraces,
      ];
      // Both routing branches exist: recent traces for the real collector,
      // older ones for the pipeline command seam.
      expect(all.some((trace) => startedAt(trace) >= cutoff)).toBe(true);
      expect(all.some((trace) => startedAt(trace) < cutoff)).toBe(true);
      const organicDays = new Set(
        timeline.organicTraces.map((trace) =>
          Math.floor(startedAt(trace) / DAY_MS),
        ),
      );
      expect(organicDays.size).toBe(timeline.days);
    });

    it("is deterministic for the same window", () => {
      const again = buildMassTimeline({ months: 3, now: NOW });
      expect(again).toEqual(timeline);
    });

    it("keeps every generated id in the mass- cohort", () => {
      for (const run of timeline.scenarioRuns) {
        expect(run.runId).toMatch(/^mass-scenario-/);
        expect(run.trace.traceId).toMatch(/^mass-trace-/);
      }
      for (const exp of timeline.experimentRuns) {
        expect(exp.runId).toMatch(/^mass-exp-/);
      }
    });

    it("trends quality upward across the window", () => {
      const firstMonth = timeline.scenarioRuns.filter(
        (run) => run.startedAt < timeline.firstDayStart + 30 * DAY_MS,
      );
      const lastMonth = timeline.scenarioRuns.filter(
        (run) => run.startedAt >= timeline.lastDayStart - 30 * DAY_MS,
      );
      const passRate = (runs: typeof timeline.scenarioRuns) =>
        runs.filter((run) => run.passed).length / runs.length;
      expect(passRate(lastMonth)).toBeGreaterThan(passRate(firstMonth));
    });
  });

  describe("given a single month", () => {
    it("clamps to at least one month and stays within it", () => {
      const timeline = buildMassTimeline({ months: 0, now: NOW });
      expect(timeline.days).toBe(30);
    });
  });
});

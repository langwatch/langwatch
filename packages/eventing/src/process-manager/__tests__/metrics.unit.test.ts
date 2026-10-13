/** Tests fleet gauges through the OpenTelemetry metrics pipeline. */
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { bindProcessFleetMetricsSource } from "../metrics.ts";

const metrics = createRecordingMeterProvider();

/** What one collection cycle observed, ignoring everything before it. */
async function collectOnce() {
  const before = metrics.recorded.length;
  await metrics.collect();
  return metrics.recorded.slice(before);
}

describe("process-manager fleet gauges", () => {
  beforeAll(() => {
    metrics.install();
  });

  afterAll(() => {
    metrics.uninstall();
  });

  describe("given dead messages and overdue wakes exist", () => {
    /** @scenario "The fleet's trouble counts reach Prometheus" */
    it("reports them per process name on collection", async () => {
      bindProcessFleetMetricsSource(async () => [
        {
          processName: "automations",
          instances: 310,
          overdueWakes: 2,
          pendingMessages: 41,
          overduePending: 4,
          lapsedLeases: 1,
          deadMessages: 7,
        },
      ]);

      const observed = await collectOnce();
      const valueOf = (instrument: string) =>
        observed.find(
          (r) => r.instrument === instrument && r.attributes.process_name === "automations",
        )?.value;

      expect(valueOf("pm_outbox_dead")).toBe(7);
      expect(valueOf("pm_instances_overdue_wakes")).toBe(2);
      expect(valueOf("pm_outbox_lapsed_leases")).toBe(1);
      expect(valueOf("pm_instances")).toBe(310);
    });

    /**
     * Every one of these is a GLOBAL count observed by each pod, so an alert
     * that sums across pods reads the fleet many times over — the warning
     * rides the metric's own description, where an alert author will look.
     */
    it("carries the max()-not-sum() warning on the metric itself", () => {
      expect(metrics.descriptionOf("pm_outbox_dead")).toMatch(
        /aggregate with max\(\), not sum\(\)/,
      );
    });
  });

  describe("given a process name that disappears from the source", () => {
    it("observes nothing for it", async () => {
      bindProcessFleetMetricsSource(async () => []);

      const perProcess = (await collectOnce()).filter((r) => "process_name" in r.attributes);

      expect(perProcess).toEqual([]);
    });
  });
});

describe("process fleet collection freshness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given the last successful collection found dead work", () => {
    describe("when collection fails and then recovers", () => {
      /** @scenario "A failed fleet collection cannot clear unresolved work" */
      it("retains unresolved dead work without refreshing its timestamp after a failed read", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-07T10:00:00Z"));
        const dead = {
          processName: "triggerSettlement",
          instances: 1,
          overdueWakes: 0,
          pendingMessages: 0,
          overduePending: 0,
          lapsedLeases: 0,
          deadMessages: 1,
        };
        const read = vi
          .fn()
          .mockResolvedValueOnce([dead])
          .mockRejectedValueOnce(new Error("database unavailable"))
          .mockResolvedValueOnce([]);
        bindProcessFleetMetricsSource(read);
        const valueOf = (observed: Awaited<ReturnType<typeof collectOnce>>, instrument: string) =>
          observed.find((r) => r.instrument === instrument)?.value;

        const healthy = await collectOnce();
        expect(read).toHaveBeenCalledTimes(1);
        expect(valueOf(healthy, "pm_fleet_collection_success")).toBe(1);
        expect(valueOf(healthy, "pm_fleet_last_success_timestamp_seconds")).toBe(1788775200);

        vi.advanceTimersByTime(11_000);
        const failed = await collectOnce();
        expect(read).toHaveBeenCalledTimes(2);
        expect(valueOf(failed, "pm_outbox_dead")).toBe(1);
        expect(valueOf(failed, "pm_fleet_collection_success")).toBe(0);
        expect(valueOf(failed, "pm_fleet_last_success_timestamp_seconds")).toBe(1788775200);

        await collectOnce();
        expect(read).toHaveBeenCalledTimes(2);

        vi.advanceTimersByTime(11_000);
        const recovered = await collectOnce();
        expect(read).toHaveBeenCalledTimes(3);
        expect(valueOf(recovered, "pm_fleet_collection_success")).toBe(1);
        expect(valueOf(recovered, "pm_fleet_last_success_timestamp_seconds")).toBe(1788775222);
        expect(valueOf(recovered, "pm_outbox_dead")).toBeUndefined();
      });
    });
  });
});

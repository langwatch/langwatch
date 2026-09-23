/** Tests fleet gauges through the OpenTelemetry metrics pipeline. */
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

      expect(await collectOnce()).toEqual([]);
    });
  });
});

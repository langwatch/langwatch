/**
 * The fleet gauges, read through the pipeline that actually carries them.
 *
 * These used to be scraped off `prom-client`'s default registry. 4610a8dc7f
 * ("Push metrics over OTLP instead of serving a Prometheus registry") moved
 * every instrument onto the OpenTelemetry facade and this file did not move
 * with it, so it went on asserting against a registry nothing writes to any
 * more: `register.metrics()` answered `"\n"` and every assertion failed on a
 * pipeline that no longer existed.
 *
 * `createRecordingMeterProvider` is the facade's own harness — the SDK's
 * aggregation and export are OpenTelemetry's to get right, and what fails
 * silently in production is a gauge that observes nothing, or observes without
 * the `process_name` an alert groups by.
 *
 * Installed ONCE for the file, not per test. `../metrics` declares its gauges
 * at module scope, so they queue in the facade's `pendingObservations` and are
 * spliced out on the first `activateMetrics()`; a `uninstall()` between tests
 * would empty that queue and leave every later test collecting nothing —
 * passing, and measuring an empty pipeline. Each test therefore reads only
 * what its own `collect()` appended.
 */
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bindProcessFleetMetricsSource } from "../metrics";

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
     * that sums across pods reads the fleet as many times over. The warning
     * rides the metric's own description, where whoever writes the alert will
     * be looking.
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

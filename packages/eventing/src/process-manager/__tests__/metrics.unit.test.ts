import { register } from "prom-client";
import { describe, expect, it } from "vitest";
import { bindProcessFleetMetricsSource } from "../metrics";

describe("process-manager fleet gauges", () => {
  describe("given dead messages and overdue wakes exist", () => {
    /** @scenario "The fleet's trouble counts reach Prometheus" */
    it("reports them per process name on scrape, with the max() aggregation warning", async () => {
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

      const scraped = await register.metrics();
      expect(scraped).toContain('pm_outbox_dead{process_name="automations"} 7');
      expect(scraped).toContain(
        'pm_instances_overdue_wakes{process_name="automations"} 2',
      );
      expect(scraped).toContain('pm_outbox_lapsed_leases{process_name="automations"} 1');
      // The per-pod-global trap is stated on the metric itself, where the
      // person building the alert will actually read it.
      expect(scraped).toMatch(/pm_outbox_dead.*aggregate with max\(\)/);
    });
  });

  it("drops a process name that disappears from the source", async () => {
    bindProcessFleetMetricsSource(async () => []);
    const scraped = await register.metrics();
    expect(scraped).not.toContain('process_name="automations"');
  });
});

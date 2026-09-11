import { register } from "prom-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindProcessFleetMetricsSource } from "../metrics";

describe("process-manager fleet gauges", () => {
  describe("given no fleet metrics source is bound", () => {
    describe("when metrics are scraped", () => {
      it("does not report an unbound process as a failed collector", async () => {
        const scraped = await register.metrics();
        expect(scraped).not.toMatch(/^pm_fleet_collection_success [0-9]/m);
        expect(scraped).not.toMatch(
          /^pm_fleet_last_success_timestamp_seconds [0-9]/m,
        );
      });
    });
  });

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
      expect(scraped).toContain(
        'pm_outbox_lapsed_leases{process_name="automations"} 1',
      );
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
        const read = vi
          .fn()
          .mockResolvedValueOnce([
            {
              processName: "triggerSettlement",
              instances: 1,
              overdueWakes: 0,
              pendingMessages: 0,
              overduePending: 0,
              lapsedLeases: 0,
              deadMessages: 1,
            },
          ])
          .mockRejectedValueOnce(new Error("database unavailable"))
          .mockResolvedValueOnce([]);
        bindProcessFleetMetricsSource(read);

        const healthy = await register.metrics();
        expect(read).toHaveBeenCalledTimes(1);
        expect(healthy).toContain("pm_fleet_collection_success 1");
        expect(healthy).toContain(
          "pm_fleet_last_success_timestamp_seconds 1788775200",
        );

        vi.advanceTimersByTime(11_000);
        const failed = await register.metrics();
        expect(read).toHaveBeenCalledTimes(2);
        expect(failed).toContain(
          'pm_outbox_dead{process_name="triggerSettlement"} 1',
        );
        expect(failed).toContain("pm_fleet_collection_success 0");
        expect(failed).toContain(
          "pm_fleet_last_success_timestamp_seconds 1788775200",
        );

        await register.metrics();
        expect(read).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(11_000);
        const recovered = await register.metrics();
        expect(read).toHaveBeenCalledTimes(3);
        expect(recovered).toContain("pm_fleet_collection_success 1");
        expect(recovered).toContain(
          "pm_fleet_last_success_timestamp_seconds 1788775222",
        );
        expect(recovered).not.toContain('process_name="triggerSettlement"');
      });
    });
  });

  describe("given a newly bound fleet metrics source", () => {
    describe("when its first collection fails", () => {
      it("reports unknown counts and zero freshness when its first read fails", async () => {
        bindProcessFleetMetricsSource(async () => {
          throw new Error("offline");
        });
        const failed = await register.metrics();
        expect(failed).toContain("pm_fleet_collection_success 0");
        expect(failed).toContain("pm_fleet_last_success_timestamp_seconds 0");
        expect(failed).not.toMatch(/pm_outbox_dead\{/);
      });
    });
  });
});

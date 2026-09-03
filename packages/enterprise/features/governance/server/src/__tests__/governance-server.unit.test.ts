import { describe, expect, it } from "vitest";
import { PulledUsagePricingService, PulledUsageRatePort } from "../index";
import { IngestionPullRunStatusProjection } from "../projections/ingestion-pull-run-status.projection";

class FixedRate extends PulledUsageRatePort {
  rate() {
    return { costNanoUsd: 17, rateVersion: "rates-v1" };
  }
}

describe("governance server", () => {
  /** @scenario "Pulled usage keeps money lossless" */
  it("converts provider decimal money without floating-point drift", () => {
    const service = PulledUsagePricingService.create(new FixedRate());
    expect(
      service.price({
        basis: "provider_reported",
        costUsd: "0.000044999999999999996",
        costStatus: "exact",
      }).costNanoUsd,
    ).toBe(45_000);
  });

  /** @scenario "Pulled usage keeps money lossless" */
  it("refuses a cost outside the exactly-representable nano-USD range", () => {
    // 1e7 USD is 1e16 nano-USD, past Number.MAX_SAFE_INTEGER. Rounding a money
    // figure is the one outcome this service may not have.
    const service = PulledUsagePricingService.create(new FixedRate());
    expect(() =>
      service.price({
        basis: "provider_reported",
        costUsd: "10000000",
        costStatus: "exact",
      }),
    ).toThrow(/exceeds the exactly-representable nano-USD range/);
  });

  /** @scenario "Pull outcomes cannot regress the projected cursor" */
  it("does not regress a projected cursor for a stale completion", () => {
    const projection = new IngestionPullRunStatusProjection();
    const current = {
      ...projection.initial(),
      sourceId: "source",
      cursor: "new",
      lastRunScheduledFor: 20,
    };
    const stale = {
      id: "event",
      aggregateId: "source",
      aggregateType: "ingestion_pull" as const,
      tenantId: "project",
      createdAt: 30,
      occurredAt: 30,
      type: "lw.obs.ingestion_pull.run_completed" as const,
      version: "2026-07-17" as const,
      data: {
        sourceId: "source",
        runId: "old-run",
        scheduledFor: 10,
        nextCursor: "old",
        eventCount: 1,
      },
    };
    expect(projection.fold(current, stale).cursor).toBe("new");
  });
});

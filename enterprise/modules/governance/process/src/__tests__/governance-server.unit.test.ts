import {
  INGESTION_PULL_AGGREGATE_TYPE,
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSIONS,
  ingestionPullRunCompletedEventSchema,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { IngestionPullRunStatusEventingProjection } from "../eventing/ingestion-pull-run-status-eventing.projection.ts";
import type { PulledUsageRateReader } from "../features/ingestion-pull/services/pulled-usage-pricing.service.ts";
import { PulledUsagePricingService } from "../features/ingestion-pull/services/pulled-usage-pricing.service.ts";
import { MemoryIngestionPullRunRepository } from "../repositories/memory/memory.ingestion-pull-run.repository.ts";

class FixedRate implements PulledUsageRateReader {
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
      }).costNanoMinor,
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
    const projection = IngestionPullRunStatusEventingProjection.create(
      MemoryIngestionPullRunRepository.create(),
    );
    const current = {
      ...projection.init(),
      SourceId: "source",
      Cursor: "new",
      LastRunScheduledFor: 20,
    };
    const stale = ingestionPullRunCompletedEventSchema.parse({
      id: "event",
      aggregateId: "source",
      aggregateType: INGESTION_PULL_AGGREGATE_TYPE,
      tenantId: "project",
      createdAt: 30,
      occurredAt: 30,
      type: INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED,
      version: INGESTION_PULL_EVENT_VERSIONS.RUN_COMPLETED,
      data: {
        sourceId: "source",
        runId: "old-run",
        scheduledFor: 10,
        nextCursor: "old",
        eventCount: 1,
      },
    });
    expect(projection.apply(current, stale).Cursor).toBe("new");
  });
});

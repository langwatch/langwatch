import {
  ClickHouseQueryClient,
  type InsertRequest,
  type QueryDriver,
  type QueryRequest,
  type QueryResult,
} from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import { BillableEventsMeterClickHouseRepository } from "../clickhouse.billable-events-meter.repository.ts";

function record() {
  return {
    organizationId: "",
    tenantId: "proj-1",
    eventId: "evt-1",
    eventType: "lw.obs.trace.span_received",
    deduplicationKey: "trace-abc:span-123",
    eventTimestamp: 1739613600000,
  };
}

class RecordingDriver implements QueryDriver {
  readonly inserts: InsertRequest[] = [];

  async execute<Row>(_: QueryRequest): Promise<QueryResult<Row>> {
    return { rows: [] };
  }

  async insert(request: InsertRequest): Promise<void> {
    this.inserts.push(request);
  }

  async command(_: QueryRequest): Promise<void> {
    throw new Error("This meter test did not expect a ClickHouse command");
  }
}

describe("BillableEventsMeterClickHouseRepository", () => {
  describe("when a billable event is inserted", () => {
    it("routes by organization while retaining the event tenant on the guarded row", async () => {
      const driver = new RecordingDriver();
      const repository = BillableEventsMeterClickHouseRepository.create(
        new ClickHouseQueryClient({ driver }),
      );

      await repository.insert({ record: record(), organizationId: "org-1" });

      expect(driver.inserts).toEqual([
        expect.objectContaining({
          tenantId: "proj-1",
          organizationId: "org-1",
          table: "billable_events",
          rows: [
            expect.objectContaining({
              OrganizationId: "org-1",
              TenantId: "proj-1",
              EventId: "evt-1",
              EventType: "lw.obs.trace.span_received",
              DeduplicationKey: "trace-abc:span-123",
            }),
          ],
          settings: { async_insert: 1, wait_for_async_insert: 1 },
        }),
      ]);
    });
  });
});

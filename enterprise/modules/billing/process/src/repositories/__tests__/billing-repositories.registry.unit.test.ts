import {
  ClickHouseQueryClient,
  type InsertRequest,
  type QueryDriver,
  type QueryRequest,
  type QueryResult,
} from "@langwatch/clickhouse-client";
import { instantiateRepositories } from "@langwatch/kernel";
import { describe, expect, it } from "vitest";

import { billingClickhouseRepositories } from "../billing-repositories.registry.ts";

function billableEvent() {
  return {
    organizationId: "ignored-by-meter",
    tenantId: "project-1",
    eventId: "event-1",
    eventType: "lw.obs.trace.span_received",
    deduplicationKey: "trace-1:span-1",
    eventTimestamp: Date.parse("2026-02-10T12:00:00.000Z"),
  };
}

class RecordingDriver implements QueryDriver {
  readonly queries: QueryRequest[] = [];
  readonly inserts: InsertRequest[] = [];

  async execute<Row>(request: QueryRequest): Promise<QueryResult<Row>> {
    this.queries.push(request);
    return { rows: [] };
  }

  async insert(request: InsertRequest): Promise<void> {
    this.inserts.push(request);
  }

  async command(_: QueryRequest): Promise<void> {
    throw new Error("This billing registry test did not expect a ClickHouse command");
  }
}

describe("billingClickhouseRepositories", () => {
  describe("when the memory tier is selected", () => {
    /** @scenario "The billing ClickHouse registry shares the meter with the monthly reader" */
    it("shares one event table between the meter and roll-up reader", async () => {
      const repositories = instantiateRepositories(billingClickhouseRepositories, {
        tier: "memory",
        members: {},
      });

      await repositories.billableEventsMeter.insert({
        record: billableEvent(),
        organizationId: "org-1",
      });

      await expect(
        repositories.billableEvents.findTotal({
          organizationId: "org-1",
          startDate: "2026-02-01 00:00:00.000",
          endDate: "2026-03-01 00:00:00.000",
        }),
      ).resolves.toBe(1);
    });
  });

  describe("when the live tier is selected", () => {
    /** @scenario "The billing ClickHouse registry routes organization and project facts" */
    it("routes organization aggregates separately from project-tenant meter rows", async () => {
      const driver = new RecordingDriver();
      const clickhouse = new ClickHouseQueryClient({ driver });
      const repositories = instantiateRepositories(billingClickhouseRepositories, {
        tier: "live",
        members: { clickhouse },
      });

      await expect(
        repositories.billableEvents.findTotal({
          organizationId: "org-1",
          startDate: "2026-02-01 00:00:00.000",
          endDate: "2026-03-01 00:00:00.000",
        }),
      ).resolves.toBe(0);
      await repositories.billableEventsMeter.insert({
        record: billableEvent(),
        organizationId: "org-1",
      });

      expect(driver.queries[0]).toMatchObject(
        expect.objectContaining({
          tenantId: "",
          organizationId: "org-1",
          unscoped: expect.objectContaining({ reason: expect.any(String) }),
        }),
      );
      expect(driver.inserts[0]).toMatchObject(
        expect.objectContaining({
          tenantId: "project-1",
          organizationId: "org-1",
          table: "billable_events",
          settings: { async_insert: 1, wait_for_async_insert: 1 },
        }),
      );
    });
  });
});

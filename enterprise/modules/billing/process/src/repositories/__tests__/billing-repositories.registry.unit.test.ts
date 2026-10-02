import {
  ClickHouseQueryClient,
  type InsertRequest,
  type QueryDriver,
  type QueryRequest,
  type QueryResult,
} from "@langwatch/clickhouse-client";
import { instantiateRepositories } from "@langwatch/process";
import { describe, expect, it } from "vitest";

import { billingClickhouseRepositories } from "../billing-repositories.registry.ts";

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

  async command(): Promise<void> {
    throw new Error("This billing registry test did not expect a ClickHouse command");
  }
}

describe("billingClickhouseRepositories", () => {
  describe("when the live tier is selected", () => {
    /** @scenario "The billing ClickHouse registry routes organization and project facts" */
    it("routes organization aggregates by organization metadata", async () => {
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

      expect(driver.queries[0]).toMatchObject(
        expect.objectContaining({
          tenantId: "",
          organizationId: "org-1",
          unscoped: expect.objectContaining({ reason: expect.any(String) }),
        }),
      );
    });
  });
});

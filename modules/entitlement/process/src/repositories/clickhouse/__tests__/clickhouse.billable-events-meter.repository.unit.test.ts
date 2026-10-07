import {
  ClickHouseQueryClient,
  routingDriver,
  type ClickHouseConnection,
  type RoutableStatementClient,
} from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { BillableEventsMeterClickHouseRepository } from "../clickhouse.billable-events-meter.repository.ts";

/** A routed ClickHouse that answers one organization, recording every lookup and statement. */
function meterOver(rows: unknown[]) {
  const organizationsResolved: string[] = [];
  const statements: { query: string; query_params: Record<string, unknown> }[] = [];
  const vendor = createApiFixture<RoutableStatementClient>({
    query: async (params) => {
      statements.push(params as (typeof statements)[number]);
      return { json: async () => rows, stream: async function* () {} };
    },
  });
  const connection = createApiFixture<ClickHouseConnection<RoutableStatementClient>>({
    resolveOrganization: (organizationId) => {
      organizationsResolved.push(organizationId);
      return vendor;
    },
  });
  const meter = BillableEventsMeterClickHouseRepository.create(
    new ClickHouseQueryClient({ driver: routingDriver(connection) }),
  );

  return { meter, organizationsResolved, statements };
}

const READ = {
  organizationId: "org_1",
  projectIds: ["project_1", "project_2"],
  window: { startDate: "2026-09-01 00:00:00.000", endDate: "2026-10-01 00:00:00.000" },
};

describe("BillableEventsMeterClickHouseRepository.countByProjects", () => {
  describe("given an organization whose plan meters it in events", () => {
    /** @scenario "The per-project meter read is billing's approximate query" */
    /** @scenario "The month's events are read off the organization-keyed rollup" */
    it("reads uniq keys per project off billable_events scoped by the organization", async () => {
      const { meter, statements } = meterOver([{ projectId: "project_1", total: "7" }]);

      await expect(meter.countByProjects(READ)).resolves.toEqual([
        { projectId: "project_1", count: 7 },
      ]);
      expect(statements).toHaveLength(1);
      const sql = statements[0]?.query.replace(/\s+/g, " ");
      expect(sql).toContain("SELECT TenantId as projectId, uniq(DeduplicationKeyHash) as total");
      expect(sql).toContain("FROM billable_events WHERE OrganizationId = {organizationId:String}");
      expect(sql).toContain("AND TenantId IN {projectIds:Array(String)}");
      expect(sql).toContain("GROUP BY TenantId");
      expect(statements[0]?.query_params).toEqual({
        organizationId: "org_1",
        projectIds: ["project_1", "project_2"],
        startDate: "2026-09-01 00:00:00.000",
        endDate: "2026-10-01 00:00:00.000",
      });
    });

    /** @scenario "The organization id never reaches the tenant resolver" */
    it("asks only the organization-keyed accessor, never the tenant, set or shared ones", async () => {
      const { meter, organizationsResolved } = meterOver([{ projectId: "project_1", total: 3 }]);

      await meter.countByProjects(READ);

      expect(organizationsResolved).toEqual(["org_1"]);
    });
  });
});

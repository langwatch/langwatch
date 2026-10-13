/** Spec: modules/entitlement/specs/usage.feature (trace usage). */
import {
  ClickHouseQueryClient,
  routingDriver,
  type ClickHouseConnection,
  type RoutableStatementClient,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { TraceCountClickHouseRepository } from "../clickhouse.trace-count.repository.ts";

/** A routed ClickHouse that answers one organization, recording every lookup and statement. */
function countOver(rows: unknown[]) {
  const organizationsResolved: string[] = [];
  const statements: { query: string; query_params: Record<string, unknown> }[] = [];
  const inserts: { table: string; values: unknown }[] = [];
  const vendor = createApiFixture<RoutableStatementClient>({
    query: async (params) => {
      statements.push(params as (typeof statements)[number]);
      return { json: async () => rows, stream: async function* () {} };
    },
    insert: async (params) => {
      inserts.push(params as (typeof inserts)[number]);
      return { executed: true, query_id: "q" } as never;
    },
  });
  const connection = createApiFixture<ClickHouseConnection<RoutableStatementClient>>({
    resolveOrganization: (organizationId) => {
      organizationsResolved.push(organizationId);
      return vendor;
    },
  });
  const counts = TraceCountClickHouseRepository.create(
    new ClickHouseQueryClient({
      tenantGuard: new TenantGuard(),
      driver: routingDriver(connection),
    }),
  );
  return { counts, organizationsResolved, statements, inserts };
}

const ORGANIZATION = "organization_1";

describe("TraceCountClickHouseRepository", () => {
  describe("when trace usage rows are written", () => {
    /** @scenario "The upgrade's trace ids write one row per trace" */
    it("inserts one row per trace on the organization's cluster, ids and month only", async () => {
      const { counts, inserts, organizationsResolved } = countOver([]);

      await counts.insert({
        organizationId: ORGANIZATION,
        rows: [
          { projectId: "project_1", traceId: "trace_1", month: "2026-10" },
          { projectId: "project_1", traceId: "trace_2", month: "2026-10" },
        ],
      });

      expect(organizationsResolved).toContain(ORGANIZATION);
      expect(inserts[0]?.table).toBe("usage_trace_meter");
      expect(inserts[0]?.values).toEqual([
        {
          OrganizationId: ORGANIZATION,
          TenantId: "project_1",
          Month: "2026-10-01",
          TraceId: "trace_1",
        },
        {
          OrganizationId: ORGANIZATION,
          TenantId: "project_1",
          Month: "2026-10-01",
          TraceId: "trace_2",
        },
      ]);
    });

    it("writes nothing for an empty list", async () => {
      const { counts, inserts } = countOver([]);

      await counts.insert({ organizationId: ORGANIZATION, rows: [] });

      expect(inserts).toEqual([]);
    });
  });

  describe("when the month is counted", () => {
    /** @scenario "The month's trace count is read off the organization-keyed rows" */
    it("counts distinct traces first seen in the month on the organization's cluster", async () => {
      const { counts, statements, organizationsResolved } = countOver([{ total: "42" }]);

      await expect(
        counts.findTotal({ organizationId: ORGANIZATION, month: "2026-10" }),
      ).resolves.toBe(42);

      const sql = statements[0]?.query.replace(/\s+/g, " ") ?? "";
      expect(organizationsResolved).toContain(ORGANIZATION);
      expect(sql).toContain("SELECT TenantId, TraceId, min(Month) AS FirstMonth");
      expect(sql).toContain("GROUP BY TenantId, TraceId");
      expect(sql).not.toContain("FINAL");
      expect(statements[0]?.query_params).toMatchObject({
        organizationId: ORGANIZATION,
        month: "2026-10-01",
        previousMonth: "2026-09-01",
      });
    });

    /** @scenario "The month's trace count is read off the organization-keyed rows" */
    it("counts per named project, and asks nothing for none", async () => {
      const { counts, statements } = countOver([{ projectId: "project_1", total: "7" }]);

      await expect(
        counts.countByProjects({ organizationId: ORGANIZATION, projectIds: [], month: "2026-10" }),
      ).resolves.toEqual([]);
      expect(statements).toEqual([]);
      await expect(
        counts.countByProjects({
          organizationId: ORGANIZATION,
          projectIds: ["project_1"],
          month: "2026-10",
        }),
      ).resolves.toEqual([{ projectId: "project_1", count: 7 }]);
      expect(statements[0]?.query).toContain("TenantId IN {projectIds:Array(String)}");
    });
  });
});

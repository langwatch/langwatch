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

type Sent = {
  query: string;
  query_params: Record<string, unknown>;
  clickhouse_settings?: Record<string, unknown>;
};

/** A routed ClickHouse: inserts by organization, reads by tenant set, recording each lookup. */
function countOver(rows: unknown[]) {
  const organizationsResolved: string[] = [];
  const tenantSetsResolved: { tenantIds: string[]; organizationId: string | undefined }[] = [];
  const statements: Sent[] = [];
  const inserts: { table: string; values: unknown }[] = [];
  const vendor = createApiFixture<RoutableStatementClient>({
    query: async (params) => {
      statements.push(params as Sent);
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
    resolveTenantSet: async ({ tenantIds, organizationId }) => {
      tenantSetsResolved.push({ tenantIds: [...tenantIds], organizationId });
      return vendor;
    },
  });
  const counts = TraceCountClickHouseRepository.create(
    new ClickHouseQueryClient({
      tenantGuard: new TenantGuard(),
      driver: routingDriver(connection),
    }),
  );
  return { counts, organizationsResolved, tenantSetsResolved, statements, inserts };
}

const ORGANIZATION = "organization_1";
const PROJECTS = ["project_1", "project_2"];
const sqlOf = (sent: Sent | undefined) => sent?.query.replace(/\s+/g, " ") ?? "";

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
    /** @scenario "The meters read on the reader, bounded by the organization's projects" */
    it("counts distinct traces first seen in the month over the organization's projects", async () => {
      const { counts, statements, tenantSetsResolved } = countOver([{ total: "42" }]);

      await expect(
        counts.findTotal({ organizationId: ORGANIZATION, projectIds: PROJECTS, month: "2026-10" }),
      ).resolves.toBe(42);

      const sql = sqlOf(statements[0]);
      expect(tenantSetsResolved).toEqual([{ tenantIds: PROJECTS, organizationId: undefined }]);
      expect(statements[0]?.clickhouse_settings).toMatchObject({
        SQL_langwatch_tenant_ids: "project_1,project_2",
      });
      expect(sql).toContain(
        "sipHash64(tuple(TenantId, TraceId)) AS TraceKey, min(Month) AS FirstMonth",
      );
      expect(sql).toContain("FROM usage_trace_meter WHERE TenantId IN ({tenantIds:Array(String)})");
      expect(sql).toContain("GROUP BY sipHash64(tuple(TenantId, TraceId))");
      expect(sql).not.toContain("FINAL");
      expect(Object.values(statements[0]?.query_params ?? {})).toEqual(
        expect.arrayContaining([ORGANIZATION, PROJECTS, "2026-10-01", "2026-09-01"]),
      );
    });

    it("counts zero for an organization with no projects, asking nothing", async () => {
      const { counts, statements } = countOver([]);

      await expect(
        counts.findTotal({ organizationId: ORGANIZATION, projectIds: [], month: "2026-10" }),
      ).resolves.toBe(0);
      expect(statements).toEqual([]);
    });

    /** @scenario "The month's trace count is read off the organization-keyed rows" */
    /** @scenario "The meters read on the reader, bounded by the organization's projects" */
    it("counts per named project, and asks nothing for none", async () => {
      const { counts, statements } = countOver([{ ProjectIndex: "2", total: "7" }]);

      await expect(
        counts.countByProjects({ organizationId: ORGANIZATION, projectIds: [], month: "2026-10" }),
      ).resolves.toEqual([]);
      expect(statements).toEqual([]);
      await expect(
        counts.countByProjects({
          organizationId: ORGANIZATION,
          projectIds: PROJECTS,
          month: "2026-10",
        }),
      ).resolves.toEqual([{ projectId: "project_2", count: 7 }]);
      const sql = sqlOf(statements[0]);
      expect(statements[0]?.clickhouse_settings).toMatchObject({
        SQL_langwatch_tenant_ids: "project_1,project_2",
      });
      expect(sql).toContain("indexOf({");
      expect(sql).toContain("sipHash64(TraceId) AS TraceKey");
      expect(sql).toContain("FROM usage_trace_meter WHERE TenantId IN ({tenantIds:Array(String)})");
      expect(sql).toContain("GROUP BY ProjectIndex HAVING countIf(FirstMonth = {");
    });
  });

  describe("when an organization's month is too large to group in memory", () => {
    /** @scenario "A large organization's trace count spills rather than failing the ingest check" */
    it("lets both counts spill their grouping to disk", async () => {
      const { counts, statements } = countOver([{ projectId: "project_1", total: "7" }]);

      await counts.findTotal({
        organizationId: ORGANIZATION,
        projectIds: PROJECTS,
        month: "2026-10",
      });
      await counts.countByProjects({
        organizationId: ORGANIZATION,
        projectIds: ["project_1"],
        month: "2026-10",
      });

      expect(statements.map((statement) => sqlOf(statement))).toEqual([
        expect.stringContaining(
          `SETTINGS max_bytes_before_external_group_by = ${256 * 1024 * 1024}`,
        ),
        expect.stringContaining(
          `SETTINGS max_bytes_before_external_group_by = ${256 * 1024 * 1024}`,
        ),
      ]);
    });
  });
});

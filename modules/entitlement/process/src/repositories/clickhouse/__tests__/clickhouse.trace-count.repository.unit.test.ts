/** Spec: modules/entitlement/specs/usage.feature (the trace count). */
import {
  ClickHouseQueryClient,
  routingDriver,
  type ClickHouseConnection,
  type RoutableStatementClient,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { TraceCountState } from "../../trace-count.repository.ts";
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

const STATE: TraceCountState = {
  projectId: "project_1",
  month: "2026-10",
  counted: 40,
  live: 2,
  LastEventOccurredAt: 5,
};

describe("TraceCountClickHouseRepository", () => {
  describe("when the fold reads a project's month back", () => {
    /** @scenario "The month's trace count is read off the organization-keyed count" */
    it("reads the newest row of the project's month on the organization's cluster", async () => {
      const { counts, statements, organizationsResolved } = countOver([
        { foldState: JSON.stringify(STATE), appliedEventIds: ["evt_1"] },
      ]);

      await expect(
        counts.find({ organizationId: "org_1", projectId: "project_1", month: "2026-10" }),
      ).resolves.toEqual([{ state: STATE, appliedEventIds: ["evt_1"] }]);
      expect(organizationsResolved).toEqual(["org_1"]);
      const sql = statements[0]?.query.replace(/\s+/g, " ");
      expect(sql).toContain("argMax(FoldState, UpdatedAt) AS foldState");
      expect(sql).toContain("AND Month = {month:Date} AND TenantId = {tenantId:String}");
      expect(statements[0]?.query_params).toMatchObject({ month: "2026-10-01" });
    });
  });

  describe("when the month is counted", () => {
    /** @scenario "The month's trace count is read off the organization-keyed count" */
    it("sums each project's newest total for the organization's month", async () => {
      const { counts, statements } = countOver([{ total: "42" }]);

      await expect(counts.findTotal({ organizationId: "org_1", month: "2026-10" })).resolves.toBe(
        42,
      );
      const sql = statements[0]?.query.replace(/\s+/g, " ");
      expect(sql).toContain("SELECT TenantId, argMax(Traces, UpdatedAt) AS Traces");
      expect(sql).toContain(
        "FROM usage_trace_count WHERE OrganizationId = {organizationId:String}",
      );
    });

    it("answers each named project's newest total", async () => {
      const { counts, statements } = countOver([{ projectId: "project_1", total: "7" }]);

      await expect(
        counts.countByProjects({
          organizationId: "org_1",
          projectIds: ["project_1", "project_2"],
          month: "2026-10",
        }),
      ).resolves.toEqual([{ projectId: "project_1", count: 7 }]);
      expect(statements[0]?.query).toContain("AND TenantId IN {projectIds:Array(String)}");
    });
  });

  describe("when the fold writes a project's month", () => {
    it("writes the state, its total and the applied ids under the organization", async () => {
      const { counts, inserts } = countOver([]);

      await counts.save({
        organizationId: "org_1",
        state: STATE,
        traces: 42,
        appliedEventIds: ["e"],
      });

      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.table).toContain("usage_trace_count");
      expect(inserts[0]?.values).toEqual([
        expect.objectContaining({
          OrganizationId: "org_1",
          TenantId: "project_1",
          Month: "2026-10-01",
          Traces: 42,
          FoldState: JSON.stringify(STATE),
          AppliedEventIds: ["e"],
        }),
      ]);
    });
  });
});

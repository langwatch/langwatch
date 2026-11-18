/** Spec: modules/entitlement/specs/entitlement-meter-counts.feature, usage.feature */
import {
  ClickHouseQueryClient,
  coalesceKeyOf,
  type InsertRequest,
  routingDriver,
  type ClickHouseConnection,
  type RoutableStatementClient,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { BillableEventsMeterClickHouseRepository } from "../clickhouse.billable-events-meter.repository.ts";

type Sent = {
  query: string;
  query_params: Record<string, unknown>;
  clickhouse_settings?: Record<string, unknown>;
};

/** A routed ClickHouse answering only the tenant-set accessor, recording lookups and statements. */
function meterOver(rows: unknown[]) {
  const tenantSetsResolved: { tenantIds: string[]; organizationId: string | undefined }[] = [];
  const statements: Sent[] = [];
  const vendor = createApiFixture<RoutableStatementClient>({
    query: async (params) => {
      statements.push(params as Sent);
      return { json: async () => rows, stream: async function* () {} };
    },
  });
  const connection = createApiFixture<ClickHouseConnection<RoutableStatementClient>>({
    resolveTenantSet: async ({ tenantIds, organizationId }) => {
      tenantSetsResolved.push({ tenantIds: [...tenantIds], organizationId });
      return vendor;
    },
  });
  const meter = BillableEventsMeterClickHouseRepository.create(
    new ClickHouseQueryClient({
      tenantGuard: new TenantGuard(),
      driver: routingDriver(connection),
    }),
  );

  return { meter, tenantSetsResolved, statements };
}

const READ = {
  organizationId: "org_1",
  projectIds: ["project_1", "project_2"],
  window: { startDate: "2026-09-01 00:00:00.000", endDate: "2026-10-01 00:00:00.000" },
};

const sqlOf = (sent: Sent | undefined) => sent?.query.replace(/\s+/g, " ") ?? "";

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
      const sql = sqlOf(statements[0]);
      expect(sql).toContain("uniq(DeduplicationKeyHash) AS total");
      expect(sql).toContain("FROM billable_events");
      expect(sql).toContain(
        "WHERE TenantId IN ({tenantIds:Array(String)}) AND (OrganizationId = {",
      );
      expect(sql).toContain("GROUP BY TenantId");
      expect(Object.values(statements[0]?.query_params ?? {})).toEqual(
        expect.arrayContaining([
          "org_1",
          ["project_1", "project_2"],
          Date.UTC(2026, 8, 1),
          Date.UTC(2026, 9, 1),
        ]),
      );
    });

    /** @scenario "The organization id never reaches the tenant resolver" */
    it("asks the tenant-set accessor for the projects, never the organization id as a tenant", async () => {
      const { meter, tenantSetsResolved } = meterOver([{ projectId: "project_1", total: 3 }]);

      await meter.countByProjects(READ);

      expect(tenantSetsResolved).toEqual([
        { tenantIds: ["project_1", "project_2"], organizationId: undefined },
      ]);
    });

    it("asks nothing for an organization with no projects", async () => {
      const { meter, statements } = meterOver([]);

      await expect(meter.countByProjects({ ...READ, projectIds: [] })).resolves.toEqual([]);
      expect(statements).toHaveLength(0);
    });
  });
});

describe("BillableEventsMeterClickHouseRepository.findTotal", () => {
  describe("given an organization metered in events", () => {
    /** @scenario "The meters read on the reader, bounded by the organization's projects" */
    it("counts distinct keys once across the projects, on the reader's tenant set", async () => {
      const { meter, statements } = meterOver([{ total: "11" }]);

      await expect(
        meter.findTotal({
          organizationId: READ.organizationId,
          projectIds: READ.projectIds,
          ...READ.window,
        }),
      ).resolves.toBe(11);
      const sql = sqlOf(statements[0]);
      expect(sql).toContain("countDistinct(DeduplicationKeyHash) AS total");
      expect(sql).not.toContain("GROUP BY");
      expect(statements[0]?.clickhouse_settings).toMatchObject({
        SQL_langwatch_tenant_ids: "project_1,project_2",
      });
    });

    it("counts zero for an organization with no projects, asking nothing", async () => {
      const { meter, statements } = meterOver([]);

      await expect(
        meter.findTotal({ organizationId: READ.organizationId, projectIds: [], ...READ.window }),
      ).resolves.toBe(0);
      expect(statements).toHaveLength(0);
    });
  });
});

describe("BillableEventsMeterClickHouseRepository.countByDay", () => {
  describe("given an organization metered in events", () => {
    /** @scenario "The meters read on the reader, bounded by the organization's projects" */
    it("reads uniq keys per UTC day across the named projects", async () => {
      const { meter, statements } = meterOver([{ day: "2026-09-02", total: "4" }]);

      await expect(meter.countByDay(READ)).resolves.toEqual([{ day: "2026-09-02", count: 4 }]);
      const sql = sqlOf(statements[0]);
      expect(sql).toContain("toString(toDate(toStartOfDay(EventTimestamp, {");
      expect(sql).toContain("uniq(DeduplicationKeyHash) AS total");
      expect(sql).toContain("ORDER BY day");
      expect(statements[0]?.clickhouse_settings).toMatchObject({
        SQL_langwatch_tenant_ids: "project_1,project_2",
      });
    });

    it("asks nothing for an organization with no projects", async () => {
      const { meter, statements } = meterOver([]);

      await expect(meter.countByDay({ ...READ, projectIds: [] })).resolves.toEqual([]);
      expect(statements).toHaveLength(0);
    });
  });
});

describe("BillableEventsMeterClickHouseRepository.insert", () => {
  describe("given one billable event", () => {
    it("sends an insert the member may coalesce, with async deduplication off", async () => {
      const inserts: InsertRequest[] = [];
      const meter = BillableEventsMeterClickHouseRepository.create(
        createApiFixture<ClickHouseQueryClient>({
          insert: async (request) => {
            inserts.push(request);
          },
        }),
      );

      await meter.insert({
        organizationId: "org_1",
        record: {
          organizationId: "org_1",
          tenantId: "project_1",
          eventId: "event_1",
          eventType: "span",
          deduplicationKey: "trace_1",
          eventTimestamp: 1_700_000_000_000,
        },
      });

      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.settings).toEqual({
        async_insert: 1,
        wait_for_async_insert: 1,
        async_insert_deduplicate: 0,
      });
      expect(inserts.map(coalesceKeyOf)).not.toContain(null);
    });
  });
});

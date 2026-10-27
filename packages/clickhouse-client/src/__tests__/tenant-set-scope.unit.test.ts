import { describe, expect, it } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import { ClickHouseConfigService } from "../config.ts";
import { ClickHouseConnection } from "../connection.ts";
import { routingDriver } from "../routingDriver.ts";
import { createTenantRouter, parseRoutingTable } from "../tenancy.ts";
import { TenantGuard } from "../tenantGuard.ts";

const ORGANIZATION_OF: Readonly<Record<string, string>> = {
  "project-a": "org-private",
  "project-b": "org-private",
  "project-elsewhere": "org-other",
};

const SET_READ =
  "SELECT BudgetId FROM gateway_budget_ledger_events WHERE TenantId IN ({tenant0:String},{tenant1:String}) AND BudgetId = {budgetId:String}";

/** One server's statements, recorded rather than mocked. */
function recordingServer(answer: unknown[]) {
  const queries: unknown[] = [];
  return {
    queries,
    query: async (params: unknown) => {
      queries.push(params);
      return { json: async () => answer, stream: async function* () {} };
    },
    insert: async () => undefined,
    command: async () => undefined,
    close: async () => undefined,
  };
}

function fixture() {
  const shared = recordingServer([{ BudgetId: "shared" }]);
  const isolated = recordingServer([{ BudgetId: "private" }]);
  const connection = ClickHouseConnection.create({
    configuration: ClickHouseConfigService.create().resolve({
      shared: { url: "http://shared.invalid:8123", cluster: "test" },
      privateRoutes: [
        { organizationId: "org-private", url: "http://private.invalid:8123", cluster: "test" },
      ],
    }),
    router: createTenantRouter({
      table: parseRoutingTable({}),
      directory: { organizationForTenant: async (tenantId) => ORGANIZATION_OF[tenantId] ?? null },
    }),
    clientFactory: { create: ({ instance }) => (instance === "org-private" ? isolated : shared) },
  });
  const client = new ClickHouseQueryClient({
    driver: routingDriver(connection),
    tenantGuard: new TenantGuard(),
  });

  return { client, shared, isolated, connection };
}

describe("a declared tenant set", () => {
  describe("when one organisation's projects are bound in one IN list", () => {
    /** @scenario "A read across one organisation's projects runs as one query on that organisation's server" */
    it("runs one statement on that organisation's server", async () => {
      const { client, shared, isolated, connection } = fixture();

      try {
        const result = await client.query({
          tenantId: "project-a",
          tenantIds: ["project-a", "project-b"],
          sql: SET_READ,
          params: { tenant0: "project-a", tenant1: "project-b", budgetId: "budget-1" },
        });

        expect(result.rows).toEqual([{ BudgetId: "private" }]);
        expect(isolated.queries).toHaveLength(1);
        expect(shared.queries).toHaveLength(0);
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when the statement reads through a table alias", () => {
    it("accepts `t.TenantId IN (...)` bound to the declared set", async () => {
      const { client, isolated, connection } = fixture();

      try {
        await client.query({
          tenantId: "project-a",
          tenantIds: ["project-a", "project-b"],
          sql: "SELECT 1 FROM simulation_runs AS t WHERE t.TenantId IN ({tenant0:String}, {tenant1:String})",
          params: { tenant0: "project-a", tenant1: "project-b" },
        });

        expect(isolated.queries).toHaveLength(1);
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when the statement binds something other than the declared set", () => {
    /** @scenario "A declared tenant set must be exactly what the statement binds" */
    it("refuses an outside tenant, a left-out tenant and a disjunction before any statement runs", async () => {
      const { client, shared, isolated, connection } = fixture();
      const declared = { tenantId: "project-a", tenantIds: ["project-a", "project-b"] };

      try {
        await expect(
          client.query({
            ...declared,
            sql: SET_READ,
            params: { tenant0: "project-a", tenant1: "project-elsewhere", budgetId: "budget-1" },
          }),
        ).rejects.toMatchObject({ violation: { kind: "tenant-set-mismatch" } });
        await expect(
          client.query({
            ...declared,
            sql: "SELECT 1 FROM gateway_budget_ledger_events WHERE TenantId IN ({tenant0:String})",
            params: { tenant0: "project-a" },
          }),
        ).rejects.toMatchObject({ violation: { kind: "tenant-set-mismatch" } });
        await expect(
          client.query({
            ...declared,
            sql: `${SET_READ} OR 1 = 1`,
            params: { tenant0: "project-a", tenant1: "project-b", budgetId: "budget-1" },
          }),
        ).rejects.toMatchObject({ violation: { kind: "weakening-disjunction" } });
        await expect(
          client.query({
            tenantId: "project-elsewhere",
            tenantIds: ["project-a", "project-b"],
            sql: SET_READ,
            params: { tenant0: "project-a", tenant1: "project-b", budgetId: "budget-1" },
          }),
        ).rejects.toMatchObject({ violation: { kind: "tenant-set-mismatch" } });
        expect(isolated.queries).toHaveLength(0);
        expect(shared.queries).toHaveLength(0);
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when the set spans organisations", () => {
    /** @scenario "A tenant set spanning organisations is refused" */
    it("refuses the read and sends no statement anywhere", async () => {
      const { client, shared, isolated, connection } = fixture();

      try {
        await expect(
          client.query({
            tenantId: "project-a",
            tenantIds: ["project-a", "project-elsewhere"],
            sql: SET_READ,
            params: { tenant0: "project-a", tenant1: "project-elsewhere", budgetId: "budget-1" },
          }),
        ).rejects.toMatchObject({
          violation: {
            kind: "tenant-set-spans-organizations",
            organizations: ["org-private", "org-other"],
          },
        });
        expect(isolated.queries).toHaveLength(0);
        expect(shared.queries).toHaveLength(0);
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when the same IN list is sent without a declared set", () => {
    it("stays refused as naming no tenant", async () => {
      const { client, isolated, connection } = fixture();

      try {
        await expect(
          client.query({
            tenantId: "project-a",
            sql: SET_READ,
            params: { tenant0: "project-a", tenant1: "project-b", budgetId: "budget-1" },
          }),
        ).rejects.toMatchObject({ violation: { kind: "missing-predicate" } });
        expect(isolated.queries).toHaveLength(0);
      } finally {
        await connection.closeOnce();
      }
    });
  });
});

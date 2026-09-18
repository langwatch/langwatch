import { describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import { ClickHouseConfigService } from "../config.ts";
import { ClickHouseConnection } from "../connection.ts";
import { routingDriver } from "../routingDriver.ts";
import { createTenantRouter, parseRoutingTable } from "../tenancy.ts";
import { TenantGuard } from "../tenantGuard.ts";

function fixture() {
  const shared = {
    query: vi.fn(async (_params: unknown) => ({ json: async () => [{ total: 2 }] })),
    insert: vi.fn(async (_params: unknown) => void 0),
    command: vi.fn(async (_params: unknown) => void 0),
    close: vi.fn(async () => void 0),
  };
  const isolated = {
    query: vi.fn(async (_params: unknown) => ({ json: async () => [{ total: 7 }] })),
    insert: vi.fn(async (_params: unknown) => void 0),
    command: vi.fn(async (_params: unknown) => void 0),
    close: vi.fn(async () => void 0),
  };
  const connection = ClickHouseConnection.create({
    configuration: ClickHouseConfigService.create().resolve({
      shared: { url: "http://shared.invalid:8123", cluster: "test" },
      privateRoutes: [
        { organizationId: "org-private", url: "http://private.invalid:8123", cluster: "test" },
      ],
    }),
    router: createTenantRouter({
      table: parseRoutingTable({}),
      directory: { organizationForTenant: async () => "org-shared" },
    }),
    clientFactory: { create: ({ instance }) => (instance === "org-private" ? isolated : shared) },
  });
  const client = new ClickHouseQueryClient({
    driver: routingDriver(connection),
    tenantGuard: new TenantGuard(),
  });

  return { client, shared, isolated, connection };
}

describe("organization routing", () => {
  /** @scenario "Organisation billing reads reach the configured private instance" */
  it("routes an organisation aggregate independently of a project identifier", async () => {
    const { client, shared, isolated, connection } = fixture();
    const sql =
      "SELECT count() AS total FROM billable_events WHERE OrganizationId = {organizationId:String}";

    try {
      const result = await client.query({
        tenantId: "",
        organizationId: "org-private",
        sql,
        params: { organizationId: "org-private" },
        unscoped: { reason: "Billing aggregates all projects in this organisation" },
      });

      expect(result.rows).toEqual([{ total: 7 }]);
      expect(shared.query).not.toHaveBeenCalled();
      expect(isolated.query).toHaveBeenCalledWith({
        query: sql,
        query_params: { organizationId: "org-private" },
        format: "JSONEachRow",
      });
    } finally {
      await connection.closeOnce();
    }
  });

  /** @scenario "Organisation routing preserves the project tenant on metered rows" */
  it("writes project rows to the organisation instance without changing their tenant", async () => {
    const { client, shared, isolated, connection } = fixture();
    const rows = [{ TenantId: "project-a", OrganizationId: "org-private", EventId: "event-a" }];

    try {
      await client.insert({
        tenantId: "project-a",
        organizationId: "org-private",
        table: "billable_events",
        rows,
      });
      expect(shared.insert).not.toHaveBeenCalled();
      expect(isolated.insert).toHaveBeenCalledWith({
        table: "billable_events",
        values: rows,
        format: "JSONEachRow",
      });
    } finally {
      await connection.closeOnce();
    }
  });

  /** @scenario "Organisation routing cannot bypass tenant scope validation" */
  it("refuses a mixed-tenant batch and an undeclared cross-tenant read before dispatch", async () => {
    const { client, shared, isolated, connection } = fixture();

    try {
      await expect(
        client.insert({
          tenantId: "project-a",
          organizationId: "org-private",
          table: "billable_events",
          rows: [{ TenantId: "project-b" }],
        }),
      ).rejects.toMatchObject({ violation: { kind: "row-tenant-mismatch" } });
      await expect(
        client.query({
          tenantId: "project-a",
          organizationId: "org-private",
          sql: "SELECT * FROM billable_events",
        }),
      ).rejects.toMatchObject({ violation: { kind: "missing-predicate" } });
      expect(shared.insert).not.toHaveBeenCalled();
      expect(isolated.insert).not.toHaveBeenCalled();
      expect(isolated.query).not.toHaveBeenCalled();
    } finally {
      await connection.closeOnce();
    }
  });
});

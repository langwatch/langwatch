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

/** One server's inserts, recorded rather than mocked. */
function recordingServer() {
  const inserts: unknown[] = [];
  return {
    inserts,
    query: async () => ({ json: async () => [], stream: async function* () {} }),
    insert: async (params: unknown) => {
      inserts.push(params);
      return undefined;
    },
    command: async () => undefined,
    close: async () => undefined,
  };
}

function fixture() {
  const shared = recordingServer();
  const isolated = recordingServer();
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

const row = (tenantId: string) => ({ TenantId: tenantId, EventId: `event-of-${tenantId}` });

describe("an insert declaring a tenant set", () => {
  describe("when its rows are exactly one organisation's declared tenants", () => {
    /** @scenario "A batch across one organisation's tenants is written as one insert on that organisation's server" */
    it("writes one insert on that organisation's server", async () => {
      const { client, shared, isolated, connection } = fixture();

      try {
        await client.insert({
          tenantId: "project-a",
          tenantIds: ["project-a", "project-b"],
          table: "event_log",
          rows: [row("project-a"), row("project-b"), row("project-a")],
        });

        expect(isolated.inserts).toHaveLength(1);
        expect(isolated.inserts[0]).toMatchObject({
          values: [row("project-a"), row("project-b"), row("project-a")],
        });
        expect(shared.inserts).toHaveLength(0);
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when its rows are not exactly the declared set", () => {
    /** @scenario "A batch's rows must be exactly its declared tenant set" */
    it("refuses an outside tenant, a declared tenant with no row and an undeclared request tenant", async () => {
      const { client, shared, isolated, connection } = fixture();
      const declared = { tenantId: "project-a", tenantIds: ["project-a", "project-b"] };

      try {
        await expect(
          client.insert({
            ...declared,
            table: "event_log",
            rows: [row("project-a"), row("project-b"), row("project-elsewhere")],
          }),
        ).rejects.toMatchObject({ violation: { kind: "tenant-set-mismatch" } });
        await expect(
          client.insert({ ...declared, table: "event_log", rows: [row("project-a")] }),
        ).rejects.toMatchObject({ violation: { kind: "tenant-set-mismatch" } });
        await expect(
          client.insert({
            tenantId: "project-elsewhere",
            tenantIds: ["project-a", "project-b"],
            table: "event_log",
            rows: [row("project-a"), row("project-b")],
          }),
        ).rejects.toMatchObject({ violation: { kind: "tenant-set-mismatch" } });
        await expect(
          client.insert({ ...declared, table: "event_log", rows: [row("project-a"), {}] }),
        ).rejects.toMatchObject({ violation: { kind: "missing-row-tenant" } });
        expect(isolated.inserts).toHaveLength(0);
        expect(shared.inserts).toHaveLength(0);
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when the declared tenants belong to different organisations", () => {
    /** @scenario "A batch whose tenant set spans organisations is refused" */
    it("refuses it as spanning organisations and writes nothing", async () => {
      const { client, shared, isolated, connection } = fixture();

      try {
        await expect(
          client.insert({
            tenantId: "project-a",
            tenantIds: ["project-a", "project-elsewhere"],
            table: "event_log",
            rows: [row("project-a"), row("project-elsewhere")],
          }),
        ).rejects.toMatchObject({ violation: { kind: "tenant-set-spans-organizations" } });
        expect(isolated.inserts).toHaveLength(0);
        expect(shared.inserts).toHaveLength(0);
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when it declares no set", () => {
    it("still refuses a row of another tenant", async () => {
      const { client, connection } = fixture();

      try {
        await expect(
          client.insert({
            tenantId: "project-a",
            table: "event_log",
            rows: [row("project-a"), row("project-b")],
          }),
        ).rejects.toMatchObject({ violation: { kind: "row-tenant-mismatch" } });
      } finally {
        await connection.closeOnce();
      }
    });
  });
});

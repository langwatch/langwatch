/** Spec: specs/clickhouse/single-client-access.feature */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import { ClickHouseConfigService } from "../config.ts";
import { ClickHouseConnection } from "../connection.ts";
import type { QueryDriver } from "../query.ts";
import { routingDriver } from "../routingDriver.ts";
import { createTenantRouter, parseRoutingTable } from "../tenancy.ts";
import { TenantGuard } from "../tenantGuard.ts";

/** A vendor endpoint whose result streams the given batches, each row decoded on `json()`. */
function endpoint(batches: Record<string, unknown>[][]) {
  return {
    query: vi.fn(async (_params: unknown) => ({
      json: async () => batches.flat(),
      stream: async function* () {
        for (const batch of batches) yield batch.map((row) => ({ json: () => row }));
      },
    })),
    insert: vi.fn(async (_params: unknown) => undefined),
    command: vi.fn(async (_params: unknown) => undefined),
    close: vi.fn(async () => undefined),
  };
}

function routed() {
  const shared = endpoint([[{ EventId: "shared-1" }]]);
  const isolated = endpoint([
    [{ EventId: "private-1" }, { EventId: "private-2" }],
    [{ EventId: "private-3" }],
  ]);
  const connection = ClickHouseConnection.create({
    configuration: ClickHouseConfigService.create().resolve({
      shared: { url: "http://shared.invalid:8123", cluster: "test" },
      privateRoutes: [
        { organizationId: "org-private", url: "http://private.invalid:8123", cluster: "test" },
      ],
    }),
    router: createTenantRouter({
      table: parseRoutingTable({ "CLICKHOUSE_URL__org-private": "http://private.invalid:8123" }),
      directory: { organizationForTenant: async () => "org-private" },
    }),
    clientFactory: { create: ({ instance }) => (instance === "org-private" ? isolated : shared) },
  });
  const client = new ClickHouseQueryClient({
    driver: routingDriver(connection),
    tenantGuard: new TenantGuard(),
  });
  return { client, shared, isolated, connection };
}

async function collect<Row>(batches: AsyncIterable<Row[]>): Promise<Row[][]> {
  const collected: Row[][] = [];
  for await (const batch of batches) collected.push(batch);
  return collected;
}

const TENANT_READ = "SELECT EventId FROM event_log WHERE TenantId = {tenantId:String}";

describe("ClickHouseQueryClient.stream()", () => {
  describe("given a tenant whose organization has a private endpoint", () => {
    /** @scenario "A streamed read yields the tenant's rows batch by batch from its own server" */
    it("yields each batch the server sends, decoded, from the private server only", async () => {
      const { client, shared, isolated, connection } = routed();

      try {
        const batches = await collect(
          client.stream<{ EventId: string }>({
            tenantId: "project-a",
            sql: TENANT_READ,
            params: { tenantId: "project-a" },
          }),
        );

        expect(batches).toEqual([
          [{ EventId: "private-1" }, { EventId: "private-2" }],
          [{ EventId: "private-3" }],
        ]);
        expect(isolated.query).toHaveBeenCalledOnce();
        expect(shared.query).not.toHaveBeenCalled();
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("given a statement that spans every tenant", () => {
    /** @scenario "A streamed read spanning every tenant reads the shared server" */
    it("streams from the shared server when the statement names no tenant", async () => {
      const { client, shared, isolated, connection } = routed();

      try {
        const batches = await collect(
          client.stream({
            tenantId: "",
            sql: "SELECT EventId FROM event_log",
            unscoped: { reason: "a replay discovery across every tenant" },
          }),
        );

        expect(batches).toEqual([[{ EventId: "shared-1" }]]);
        expect(isolated.query).not.toHaveBeenCalled();
      } finally {
        await connection.closeOnce();
      }
      expect(shared.query).toHaveBeenCalledOnce();
    });
  });

  describe("given a statement with no tenant predicate and no declared reason", () => {
    /** @scenario "A streamed read that names no tenant is refused before it reaches a server" */
    it("refuses it before any server is asked", async () => {
      const { client, shared, isolated, connection } = routed();

      try {
        await expect(
          collect(client.stream({ tenantId: "project-a", sql: "SELECT EventId FROM event_log" })),
        ).rejects.toMatchObject({ name: "TenantScopeError" });
        expect(shared.query).not.toHaveBeenCalled();
        expect(isolated.query).not.toHaveBeenCalled();
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("given a driver that cannot stream", () => {
    /** @scenario "A driver that cannot stream answers the whole read as one batch" */
    it("answers the whole result as one batch", async () => {
      const driver: QueryDriver = {
        execute: async <Row>() => ({ rows: [] satisfies Row[] }),
        insert: async () => undefined,
        command: async () => undefined,
      };
      const execute = vi.spyOn(driver, "execute");

      const batches = await collect(
        new ClickHouseQueryClient({ driver }).stream({
          tenantId: "project-a",
          sql: TENANT_READ,
          params: { tenantId: "project-a" },
        }),
      );

      expect(batches).toEqual([[]]);
      expect(execute).toHaveBeenCalledOnce();
    });
  });
});

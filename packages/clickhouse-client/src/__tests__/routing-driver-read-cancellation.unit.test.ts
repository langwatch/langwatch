/** Spec: specs/clickhouse/single-client-access.feature; ADR-196. */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import { ClickHouseConfigService } from "../config.ts";
import { ClickHouseConnection } from "../connection.ts";
import { RetryPolicy } from "../retry.ts";
import { routingDriver } from "../routingDriver.ts";
import { createTenantRouter, parseRoutingTable } from "../tenancy.ts";
import { TenantGuard } from "../tenantGuard.ts";

const TENANT_READ = "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String}";

const CANCELLED_ON_CLOSE = {
  readonly: "2",
  cancel_http_readonly_queries_on_client_close: "1",
};

/** What a readonly=1 user, or SQL carrying its own `SETTINGS readonly=0`, answers. */
const READONLY_REFUSAL = Object.assign(
  new Error("Cannot modify 'readonly' setting in readonly mode. (READONLY)"),
  { code: "164", type: "READONLY" },
);

/** A server whose `query` answers rows unless `refuse` names a failure for the call. */
function routed({
  refuse,
  retries,
}: { refuse?: (params: unknown) => Error | undefined; retries?: RetryPolicy } = {}) {
  const server = {
    query: vi.fn(async (params: unknown) => {
      const failure = refuse?.(params);
      if (failure !== undefined) throw failure;
      return {
        json: async () => [{ TraceId: "t1" }],
        stream: async function* () {
          yield [{ json: () => ({ TraceId: "t1" }) }];
        },
      };
    }),
    insert: vi.fn(async (_params: unknown) => undefined),
    command: vi.fn(async (_params: unknown) => undefined),
    close: vi.fn(async () => undefined),
  };
  const connection = ClickHouseConnection.create({
    configuration: ClickHouseConfigService.create().resolve({
      shared: { url: "http://shared.invalid:8123", cluster: "test" },
    }),
    router: createTenantRouter({
      table: parseRoutingTable({}),
      directory: { organizationForTenant: async () => "org-shared" },
    }),
    clientFactory: { create: () => server },
  });
  const client = new ClickHouseQueryClient({
    driver: routingDriver(connection),
    tenantGuard: new TenantGuard(),
    retries,
  });
  return { client, connection, server };
}

const settingsOf = (params: unknown): unknown =>
  (params as { clickhouse_settings?: unknown }).clickhouse_settings;

const tenantRead = {
  tenantId: "project-a",
  sql: TENANT_READ,
  params: { tenantId: "project-a" },
  settings: { max_execution_time: 20, max_memory_usage: "4000000000" },
};

describe("routingDriver read cancellation", () => {
  describe("when a repository reads through the routed client", () => {
    /** @scenario "A routed read is sent read-only, so the server cancels it when the app leaves" */
    it("sends the read with readonly=2 and cancel-on-close beside the caller's settings and params", async () => {
      const { client, connection, server } = routed();

      try {
        await client.query(tenantRead);

        const sent = server.query.mock.calls[0]?.[0];
        expect(sent).toMatchObject({
          query: TENANT_READ,
          query_params: { tenantId: "project-a" },
          format: "JSONEachRow",
        });
        expect(settingsOf(sent)).toEqual({ ...tenantRead.settings, ...CANCELLED_ON_CLOSE });
      } finally {
        await connection.closeOnce();
      }
    });

    /** @scenario "A routed read is sent read-only, so the server cancels it when the app leaves" */
    it("sends a read with no settings of its own read-only too", async () => {
      const { client, connection, server } = routed();

      try {
        await client.query({ ...tenantRead, settings: undefined });

        expect(settingsOf(server.query.mock.calls[0]?.[0])).toEqual(CANCELLED_ON_CLOSE);
      } finally {
        await connection.closeOnce();
      }
    });

    /** @scenario "A routed read is sent read-only, so the server cancels it when the app leaves" */
    it("sends a streamed read read-only", async () => {
      const { client, connection, server } = routed();

      try {
        for await (const _batch of client.stream(tenantRead)) {
          // Drained only so the request is sent.
        }

        expect(settingsOf(server.query.mock.calls[0]?.[0])).toEqual({
          ...tenantRead.settings,
          ...CANCELLED_ON_CLOSE,
        });
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when a read names readonly itself", () => {
    /** @scenario "A read cannot change its read-only mode" */
    it("never lets a read loosen readonly to 0", async () => {
      const { client, connection, server } = routed();

      try {
        await client.query({ ...tenantRead, settings: { readonly: "0" } });

        expect(settingsOf(server.query.mock.calls[0]?.[0])).toEqual(CANCELLED_ON_CLOSE);
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when the client runs a command or writes rows", () => {
    /** @scenario "Commands and inserts are not sent read-only" */
    it("sends a command with the caller's settings only", async () => {
      const { client, connection, server } = routed();

      try {
        await client.command({
          tenantId: "",
          sql: "OPTIMIZE TABLE {table:Identifier}",
          params: { table: "trace_summaries" },
          settings: { alter_sync: 0 },
          // OPTIMIZE names a table, not a tenant, as replay's post-rebuild statement does.
          SKIP_TENANT_CHECK: true,
        });

        expect(settingsOf(server.command.mock.calls[0]?.[0])).toEqual({ alter_sync: 0 });
      } finally {
        await connection.closeOnce();
      }
    });

    /** @scenario "Commands and inserts are not sent read-only" */
    it("sends an insert without readonly or cancel-on-close", async () => {
      const { client, connection, server } = routed();

      try {
        await client.insert({
          tenantId: "project-a",
          table: "trace_summaries",
          rows: [{ TenantId: "project-a", TraceId: "t1" }],
          settings: { async_insert: 1 },
        });

        const settings = settingsOf(server.insert.mock.calls[0]?.[0]);
        expect(settings).toEqual({ async_insert: 1 });
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when the server refuses a read for readonly", () => {
    /** @scenario "A read the server refuses for readonly fails and is not resent" */
    it("fails a read refused for its own readonly change, without resending it", async () => {
      const { client, connection, server } = routed({
        refuse: () => READONLY_REFUSAL,
        retries: new RetryPolicy({ maxAttempts: 3, sleep: async () => undefined }),
      });

      try {
        await expect(client.query(tenantRead)).rejects.toBe(READONLY_REFUSAL);
        expect(server.query).toHaveBeenCalledTimes(1);
      } finally {
        await connection.closeOnce();
      }
    });

    /** @scenario "A read the server refuses for readonly fails and is not resent" */
    it("still sends the next read with readonly=2 and cancel-on-close", async () => {
      let refused = false;
      const { client, connection, server } = routed({
        refuse: () => {
          if (refused) return undefined;
          refused = true;
          return READONLY_REFUSAL;
        },
      });

      try {
        await expect(client.query(tenantRead)).rejects.toBe(READONLY_REFUSAL);
        await client.query(tenantRead);

        expect(settingsOf(server.query.mock.calls[1]?.[0])).toEqual({
          ...tenantRead.settings,
          ...CANCELLED_ON_CLOSE,
        });
      } finally {
        await connection.closeOnce();
      }
    });
  });
});

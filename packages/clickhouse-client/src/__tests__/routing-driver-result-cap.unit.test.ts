/** Spec: specs/clickhouse/bounded-reads.feature */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import { ClickHouseConfigService } from "../config.ts";
import { ClickHouseConnection } from "../connection.ts";
import { BUFFERED_READ_MAX_RESULT_BYTES, routingDriver } from "../routingDriver.ts";
import { createTenantRouter, parseRoutingTable } from "../tenancy.ts";
import { TenantGuard } from "../tenantGuard.ts";

const TENANT_READ = "SELECT TraceId FROM stored_spans WHERE TenantId = {tenantId:String}";

function routed() {
  const server = {
    query: vi.fn(async (_params: unknown) => ({
      json: async () => [],
      stream: async function* () {
        yield [];
      },
    })),
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
  const driver = routingDriver(connection);
  const client = new ClickHouseQueryClient({ driver, tenantGuard: new TenantGuard() });
  const sentSettings = () => {
    const sent = server.query.mock.calls[0]?.[0] as
      | { clickhouse_settings?: Record<string, unknown> }
      | undefined;
    return sent?.clickhouse_settings;
  };
  return { client, driver, connection, sentSettings };
}

const tenantRead = { tenantId: "project-a", sql: TENANT_READ, params: { tenantId: "project-a" } };

describe("routingDriver result size", () => {
  describe("when a buffered read names no result limit", () => {
    /** @scenario "A read that buffers its whole result is refused by ClickHouse past a result size" */
    it("tells ClickHouse to refuse a result past the default size and fail the read", async () => {
      const { client, connection, sentSettings } = routed();
      try {
        await client.query(tenantRead);

        expect(sentSettings()).toMatchObject({
          max_result_bytes: String(BUFFERED_READ_MAX_RESULT_BYTES),
          result_overflow_mode: "throw",
        });
      } finally {
        await connection.closeOnce();
      }
    });

    it("keeps the read's other settings", async () => {
      const { client, connection, sentSettings } = routed();
      try {
        await client.query({ ...tenantRead, settings: { max_memory_usage: "1024" } });

        expect(sentSettings()).toMatchObject({ max_memory_usage: "1024" });
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when a buffered read names its own row limit", () => {
    /** @scenario "A read that names its own result limit keeps it" */
    it("keeps the row limit and still applies the size ceiling", async () => {
      const { client, connection, sentSettings } = routed();
      try {
        await client.query({
          ...tenantRead,
          settings: { max_result_rows: "101", result_overflow_mode: "throw" },
        });

        expect(sentSettings()).toEqual({
          max_result_rows: "101",
          max_result_bytes: String(BUFFERED_READ_MAX_RESULT_BYTES),
          result_overflow_mode: "throw",
        });
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when a buffered read names its own size limit", () => {
    /** @scenario "A read that names its own result limit keeps it" */
    it("sends the read's own size limit, not the default", async () => {
      const { client, connection, sentSettings } = routed();
      try {
        await client.query({ ...tenantRead, settings: { max_result_bytes: "1024" } });

        expect(sentSettings()).toEqual({ max_result_bytes: "1024" });
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when a buffered read asks for a partial result on overflow", () => {
    /** @scenario "A read that asks for a partial result on overflow keeps only its own limits" */
    it("leaves its settings as they are, so no limit of ours silently truncates it", async () => {
      const { client, connection, sentSettings } = routed();
      try {
        await client.query({
          ...tenantRead,
          settings: { max_result_rows: "10", result_overflow_mode: "break" },
        });

        expect(sentSettings()).toEqual({ max_result_rows: "10", result_overflow_mode: "break" });
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("when a read streams its result", () => {
    /** @scenario "A read that streams its result batch by batch is not capped by size" */
    it("adds no result size limit", async () => {
      const { driver, connection, sentSettings } = routed();
      try {
        const batches = driver.stream?.<unknown>(tenantRead);
        if (!batches) throw new Error("the routing driver streams");
        for await (const _batch of batches) {
          // drain
        }

        expect(sentSettings()?.max_result_bytes).toBeUndefined();
      } finally {
        await connection.closeOnce();
      }
    });
  });
});

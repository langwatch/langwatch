import { describe, expect, it, vi } from "vitest";

import {
  ClickHouseManagedClientLogger,
  ClickHouseManagedClientService,
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  ClickHouseVendorClientFactory,
  withClickHouseTenantScope,
  type ClickHouseVendorClient,
  type ClickHouseVendorClientOptions,
  type LimiterStats,
} from "../index";
import { VendorClientResiliencePolicy } from "../vendorClient";

/**
 * The seam under test is the wrapped vendor client, because that is the one
 * every repository actually calls: they issue `query({ query, query_params })`
 * against the driver, not a `QueryRequest` against the port.
 */
function recordingClient(): ClickHouseVendorClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    query: async (params: unknown) => {
      calls.push(params);
      return { ok: true };
    },
    insert: async () => ({}),
    close: async () => {},
  };
}

class CollectingLogger extends ClickHouseManagedClientLogger {
  readonly errors: Array<{ fields: Record<string, unknown>; message: string }> = [];

  info(): void {}
  warn(): void {}
  error(fields: Record<string, unknown>, message: string): void {
    this.errors.push({ fields, message });
  }
}

describe("the ClickHouse tenant-scope guard", () => {
  describe("when the statement binds its tenant", () => {
    /** @scenario "A statement that names its tenant runs" */
    it("passes the statement to the driver unchanged", async () => {
      const driver = recordingClient();
      const guarded = withClickHouseTenantScope({ client: driver, instance: "shared" });

      await guarded.query({
        query: "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: "project-1" },
      });

      expect(driver.calls).toEqual([
        {
          query: "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String}",
          query_params: { tenantId: "project-1" },
        },
      ]);
    });

    it.each([
      ["a list of projects", "SELECT 1 FROM trace_summaries WHERE TenantId IN {ids:Array(String)}"],
      [
        "a bracketed list of placeholders",
        "SELECT 1 FROM gateway_spend WHERE TenantId IN ({tenant0:String},{tenant1:String})",
      ],
      [
        "the stored-object column name",
        "SELECT project_id FROM stored_objects WHERE project_id = {projectId:String}",
      ],
      [
        "a table alias",
        "SELECT 1 FROM simulation_runs AS t WHERE t.TenantId = {tenantId:String}",
      ],
    ])("accepts %s", async (_name, query) => {
      const driver = recordingClient();
      const guarded = withClickHouseTenantScope({ client: driver, instance: "shared" });

      await expect(guarded.query({ query })).resolves.toEqual({ ok: true });
    });
  });

  describe("when the statement names no tenant", () => {
    /** @scenario "A statement that names no tenant is refused, and the refusal names the table" */
    it("refuses before the driver is reached, naming the table and the head of the statement", async () => {
      const driver = recordingClient();
      const logger = new CollectingLogger();
      const guarded = withClickHouseTenantScope({ client: driver, instance: "shared", logger });

      await expect(
        guarded.query({ query: "SELECT groupArray(TenantId) FROM trace_summaries" }),
      ).rejects.toThrow(/trace_summaries/);

      expect(driver.calls).toEqual([]);
      expect(logger.errors).toHaveLength(1);
      expect(logger.errors[0]?.fields).toMatchObject({
        table: "trace_summaries",
        violation: "missing-predicate",
        instance: "shared",
      });
    });

    it("refuses a statement that inlines the tenant instead of binding it", async () => {
      const guarded = withClickHouseTenantScope({ client: recordingClient(), instance: "shared" });

      await expect(
        guarded.query({ query: "SELECT 1 FROM trace_summaries WHERE TenantId = 'project-1'" }),
      ).rejects.toThrow(/bind/i);
    });

    it("refuses a statement whose predicate is only inside a comment", async () => {
      const guarded = withClickHouseTenantScope({ client: recordingClient(), instance: "shared" });

      await expect(
        guarded.query({
          query: "SELECT 1 FROM trace_summaries -- WHERE TenantId = {tenantId:String}",
        }),
      ).rejects.toThrow(/not tenant-scoped/);
    });

    it("throws a plain Error, so it degrades to unknown rather than posing as a customer fault", async () => {
      const guarded = withClickHouseTenantScope({ client: recordingClient(), instance: "shared" });

      const error = await guarded.query({ query: "SELECT 1 FROM trace_summaries" }).catch((e) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toHaveProperty("code");
    });

    it("truncates the quoted statement to eighty characters", async () => {
      const guarded = withClickHouseTenantScope({ client: recordingClient(), instance: "shared" });
      const query = `SELECT ${"a".repeat(400)} FROM trace_summaries`;

      const error = (await guarded.query({ query }).catch((e) => e)) as Error;

      expect(error.message).toContain(query.slice(0, 80));
      expect(error.message).not.toContain(query.slice(0, 81));
    });

    it("leaves inserts alone, since every row carries its own tenant column", async () => {
      const driver = recordingClient();
      const guarded = withClickHouseTenantScope({ client: driver, instance: "shared" });

      await expect(
        guarded.insert({ table: "trace_summaries", values: [{ TenantId: "project-1" }] }),
      ).resolves.toEqual({});
    });
  });

  describe("when the statement declares why it spans tenants", () => {
    /** @scenario "A statement that declares why it spans tenants runs" */
    it("lets it through and does not forward the declaration to the driver", async () => {
      const driver = recordingClient();
      const guarded = withClickHouseTenantScope({ client: driver, instance: "shared" });

      await guarded.query({
        query: "SELECT name FROM system.parts",
        unscoped: { reason: "system.parts carries no tenant column." },
      });

      expect(driver.calls).toEqual([{ query: "SELECT name FROM system.parts" }]);
    });
  });

  describe("when the managed client builds a client for each configured instance", () => {
    /** @scenario "every client is built the same way" */
    it("gives the shared and the private instance the same tenant guard", async () => {
      const created: Array<ClickHouseVendorClient & { calls: unknown[] }> = [];
      class Factory extends ClickHouseVendorClientFactory<ClickHouseVendorClient> {
        create(_options: ClickHouseVendorClientOptions): ClickHouseVendorClient {
          const client = recordingClient();
          created.push(client);
          return client;
        }
      }
      class Telemetry extends ClickHouseManagedClientTelemetry {
        registerLimiter(_input: { instance: string; stats: () => LimiterStats }): void {}
        unregisterLimiter(): void {}
        observeStatementWait(): void {}
        incrementStatementsShed(): void {}
      }
      class Overload extends ClickHouseOverloadErrorFactory {
        create(input: { cause: unknown }): unknown {
          return input.cause;
        }
      }
      const factory = ClickHouseManagedClientService.create({
        vendorClientFactory: new Factory(),
        defaultQuerySettings: {},
        resilience: VendorClientResiliencePolicy.create(),
        telemetry: new Telemetry(),
        overloadErrorFactory: new Overload(),
      });

      const instances = ["shared", "private-acme"].map((instance) =>
        factory.create({ url: "http://localhost:8123", instance, cluster: "", maxOpenConnections: 4 }),
      );

      for (const client of instances) {
        await expect(client.query({ query: "SELECT 1 FROM trace_summaries" })).rejects.toThrow(
          /not tenant-scoped/,
        );
      }
      expect(created.every((client) => client.calls.length === 0)).toBe(true);
    });
  });

  describe("when the reporting hook itself is unavailable", () => {
    it("still refuses, rather than letting an absent logger decide policy", async () => {
      const guarded = withClickHouseTenantScope({
        client: recordingClient(),
        instance: "shared",
        logger: undefined,
      });

      await expect(guarded.query({ query: "SELECT 1 FROM trace_summaries" })).rejects.toThrow();
    });
  });
});

describe("the vendor query proxy", () => {
  it("does not intercept anything but query", async () => {
    const close = vi.fn(async () => {});
    const guarded = withClickHouseTenantScope({
      client: { ...recordingClient(), close },
      instance: "shared",
    });

    await guarded.close();

    expect(close).toHaveBeenCalledOnce();
  });
});

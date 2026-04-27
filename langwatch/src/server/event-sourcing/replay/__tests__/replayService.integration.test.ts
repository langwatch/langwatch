import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  startTestContainers,
  stopTestContainers,
  getTestClickHouseClient,
  getTestRedisConnection,
} from "../../__tests__/integration/testContainers";
import { generateTestTenantId } from "../../__tests__/integration/testHelpers";
import { ReplayService } from "../replayService";

describe("ReplayService tenant-specific ClickHouse", () => {
  let tenantA: string;
  let tenantB: string;
  let client: ClickHouseClient;
  const resolverCalls: string[] = [];

  beforeAll(async () => {
    await startTestContainers();
    client = getTestClickHouseClient()!;
    tenantA = generateTestTenantId();
    tenantB = generateTestTenantId();

    // Insert events for tenant A
    await client.insert({
      table: "event_log",
      values: [
        {
          TenantId: tenantA,
          AggregateType: "trace",
          AggregateId: "trace-a1",
          EventId: "evt-a-001",
          EventType: "trace.upserted",
          EventTimestamp: 1700000000000,
          EventOccurredAt: 1700000000000,
          EventVersion: "2025-01-01",
          EventPayload: JSON.stringify({ value: 1 }),
        },
        {
          TenantId: tenantA,
          AggregateType: "trace",
          AggregateId: "trace-a2",
          EventId: "evt-a-002",
          EventType: "trace.upserted",
          EventTimestamp: 1700000001000,
          EventOccurredAt: 1700000001000,
          EventVersion: "2025-01-01",
          EventPayload: JSON.stringify({ value: 2 }),
        },
      ],
      format: "JSONEachRow",
    });

    // Insert events for tenant B (different tenant, different aggregates)
    await client.insert({
      table: "event_log",
      values: [
        {
          TenantId: tenantB,
          AggregateType: "trace",
          AggregateId: "trace-b1",
          EventId: "evt-b-001",
          EventType: "trace.upserted",
          EventTimestamp: 1700000002000,
          EventOccurredAt: 1700000002000,
          EventVersion: "2025-01-01",
          EventPayload: JSON.stringify({ value: 100 }),
        },
      ],
      format: "JSONEachRow",
    });
  });

  afterAll(async () => {
    if (client) {
      await client.exec({
        query: `ALTER TABLE event_log DELETE WHERE TenantId IN ({tenantA:String}, {tenantB:String})`,
        query_params: { tenantA, tenantB },
      });
    }
    await stopTestContainers();
  });

  function createServiceWithResolver() {
    resolverCalls.length = 0;
    const redis = getTestRedisConnection()!;

    const service = new ReplayService({
      clickhouseClientResolver: async (tenantId: string) => {
        resolverCalls.push(tenantId);
        // In production, different tenants may resolve to different CH instances.
        // Here we return the same client but track which tenant IDs were requested.
        return client;
      },
      redis,
    });

    return service;
  }

  describe("discover", () => {
    it("resolves CH client per tenant during discovery", async () => {
      const service = createServiceWithResolver();

      const resultA = await service.discover({
        projection: {
          projectionName: "test",
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "test/projection/test",
          definition: { name: "test", version: "v1", lastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
        },
        since: "2023-11-01",
        tenantId: tenantA,
      });

      expect(resultA.aggregates).toHaveLength(2);
      expect(resultA.aggregates.every((a) => a.tenantId === tenantA)).toBe(true);
      expect(resolverCalls).toContain(tenantA);
    });

    it("isolates discovery results between tenants", async () => {
      const service = createServiceWithResolver();

      const resultA = await service.discover({
        projection: {
          projectionName: "test",
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "test/projection/test",
          definition: { name: "test", version: "v1", lastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
        },
        since: "2023-11-01",
        tenantId: tenantA,
      });

      const resultB = await service.discover({
        projection: {
          projectionName: "test",
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "test/projection/test",
          definition: { name: "test", version: "v1", lastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
        },
        since: "2023-11-01",
        tenantId: tenantB,
      });

      // Tenant A has 2 aggregates, tenant B has 1
      expect(resultA.aggregates).toHaveLength(2);
      expect(resultB.aggregates).toHaveLength(1);

      // No cross-tenant leakage
      expect(resultA.aggregates.every((a) => a.tenantId === tenantA)).toBe(true);
      expect(resultB.aggregates.every((a) => a.tenantId === tenantB)).toBe(true);

      // Resolver was called with both tenant IDs
      expect(resolverCalls).toContain(tenantA);
      expect(resolverCalls).toContain(tenantB);
    });
  });

  describe("when discovering without tenant filter", () => {
    it("discovers aggregates across all tenants", async () => {
      const service = createServiceWithResolver();

      const result = await service.discover({
        projection: {
          projectionName: "test",
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "test/projection/test",
          definition: { name: "test", version: "v1", lastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
        },
        since: "2023-11-01",
        // no tenantId — discovers across all
      });

      expect(result.aggregates.length).toBeGreaterThanOrEqual(3);
      expect(result.byTenant.has(tenantA)).toBe(true);
      expect(result.byTenant.has(tenantB)).toBe(true);
    });
  });

  describe("when tenants share the same aggregateId", () => {
    it("keeps them as separate aggregates", async () => {
      // Insert an event for tenant B with the same aggregate ID as tenant A
      await client.insert({
        table: "event_log",
        values: [
          {
            TenantId: tenantB,
            AggregateType: "trace",
            AggregateId: "trace-a1", // same as tenant A's aggregate!
            EventId: "evt-b-clash-001",
            EventType: "trace.upserted",
            EventTimestamp: 1700000003000,
            EventOccurredAt: 1700000003000,
            EventVersion: "2025-01-01",
            EventPayload: JSON.stringify({ value: 999 }),
          },
        ],
        format: "JSONEachRow",
      });

      const service = createServiceWithResolver();

      const resultA = await service.discover({
        projection: {
          projectionName: "test",
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "test/projection/test",
          definition: { name: "test", version: "v1", lastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
        },
        since: "2023-11-01",
        tenantId: tenantA,
      });

      const resultB = await service.discover({
        projection: {
          projectionName: "test",
          pipelineName: "test_pipeline",
          aggregateType: "trace",
          source: "pipeline",
          pauseKey: "test/projection/test",
          definition: { name: "test", version: "v1", lastEventOccurredAtKey: "LastEventOccurredAt", eventTypes: ["trace.upserted"], init: () => ({}), apply: (s) => s, store: { store: vi.fn(), get: vi.fn() } },
        },
        since: "2023-11-01",
        tenantId: tenantB,
      });

      // Tenant A still sees only its own aggregates
      expect(resultA.aggregates).toHaveLength(2);
      // Tenant B now has trace-b1 + trace-a1 (shared ID, different tenant)
      expect(resultB.aggregates).toHaveLength(2);
      expect(resultB.aggregates.map((a) => a.aggregateId).sort()).toEqual(["trace-a1", "trace-b1"]);
    });
  });
});

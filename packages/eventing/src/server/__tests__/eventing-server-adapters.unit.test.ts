import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
  PrismaProcessStore,
  type EventingClickHouseClient,
  type EventingClickHouseQueryResult,
} from "@langwatch/eventing/server";
import { createTenantId, type Event } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

class ClickHouseClientFake implements EventingClickHouseClient {
  readonly inserts: Parameters<EventingClickHouseClient["insert"]>[0][] = [];

  async query(
    _request: Parameters<EventingClickHouseClient["query"]>[0],
  ): Promise<EventingClickHouseQueryResult> {
    return {
      json<Row>(): Promise<Row[]> {
        return Promise.resolve([]);
      },
    };
  }

  async insert(request: Parameters<EventingClickHouseClient["insert"]>[0]): Promise<void> {
    this.inserts.push(request);
  }
}

const tenantId = createTenantId("project-1");

function event(): Event<Record<string, never>> {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId,
    createdAt: 1_000,
    occurredAt: 900,
    type: "lw.obs.trace.recorded",
    version: "2026-08-28",
    data: {},
  };
}

describe("Eventing production ClickHouse adapters", () => {
  it("stamps the injected default retention when a repository writes directly", async () => {
    const client = new ClickHouseClientFake();
    const repository = EventingClickHouseEventRepository.create({
      resolveClient: async () => client,
      retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
    });

    await repository.insertEventRecords([
      {
        TenantId: tenantId,
        AggregateType: "trace",
        AggregateId: "trace-1",
        EventId: "event-1",
        EventTimestamp: 1_000,
        EventOccurredAt: 900,
        EventType: "lw.obs.trace.recorded",
        EventVersion: "2026-08-28",
        EventPayload: {},
        ProcessingTraceparent: "",
        IdempotencyKey: "",
      },
    ]);

    expect(client.inserts[0]?.values[0]?._retention_days).toBe(49);
  });

  it("uses the tenant retention policy before the injected fallback", async () => {
    const client = new ClickHouseClientFake();
    const retention = createEventingRetentionConfiguration({ defaultRetentionDays: 49 });
    const repository = EventingClickHouseEventRepository.create({
      resolveClient: async () => client,
      retention,
    });
    const store = EventingClickHouseEventStore.create({
      repository,
      retention,
      retentionPolicyResolver: {
        resolve: async () => ({ traces: 35 }),
      },
    });

    await store.storeEvents([event()], { tenantId }, "trace");

    expect(client.inserts[0]?.values[0]?._retention_days).toBe(35);
  });

  it("rejects an invalid semantic retention configuration at composition time", () => {
    expect(() => createEventingRetentionConfiguration({ defaultRetentionDays: 0 })).toThrow();
  });

  it("keeps generated Prisma behind the strict process-store construction boundary", () => {
    expect(() => PrismaProcessStore.create({ database: {} })).toThrow(
      "PrismaProcessStore requires a generated Prisma client instance.",
    );
  });
});

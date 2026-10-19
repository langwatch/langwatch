/**
 * @vitest-environment node
 *
 * Spec: packages/eventing/specs/own-event-store.feature
 */
import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
} from "@langwatch/eventing/server";
import { describe, expect, it, vi } from "vitest";

const retention = createEventingRetentionConfiguration({ defaultRetentionDays: 49 });

function rowOf({ tenantId, aggregateId }: { tenantId: string; aggregateId: string }) {
  return {
    TenantId: tenantId,
    AggregateId: aggregateId,
    EventId: `evt-${tenantId}-${aggregateId}`,
    EventTimestamp: 1_700_000_000_000,
    EventOccurredAt: 1_700_000_000_000,
    EventType: "test.integration.event",
    EventPayload: { note: "kept" },
    EventVersion: "2025-12-14",
    ProcessingTraceparent: "",
    IdempotencyKey: "",
  };
}

function repositoryAnswering(rows: ReturnType<typeof rowOf>[]) {
  const query = vi.fn(async (_request: Record<string, unknown>) => ({
    json: async <Row>(): Promise<Row[]> =>
      rows.flatMap((row): Row[] => [JSON.parse(JSON.stringify(row))]),
  }));
  const resolveClient = vi.fn(async (_tenantId: string) => ({ query, insert: vi.fn() }));
  const repository = EventingClickHouseEventRepository.create({ resolveClient, retention });
  return { repository, query, resolveClient };
}

describe("EventingClickHouseEventRepository.findEventRecordsOfAggregates", () => {
  describe("when many aggregates are read in one read", () => {
    /** @scenario "A read of many aggregates asks the event log by tenant set first" */
    it("sends one query filtering the tenant set first and declares that set", async () => {
      const { repository, query, resolveClient } = repositoryAnswering([]);

      await repository.findEventRecordsOfAggregates({
        aggregates: [
          { tenantId: "user-1", aggregateId: "user-1" },
          { tenantId: "user-2", aggregateId: "user-2" },
        ],
        aggregateType: "user",
      });

      expect(query).toHaveBeenCalledTimes(1);
      expect(resolveClient).toHaveBeenCalledWith("user-1");
      const request = query.mock.calls[0]?.[0];
      const where = String(request?.query).replace(/\s+/g, " ");
      expect(where).toContain(
        "WHERE TenantId IN ({tenantIds:Array(String)}) AND AggregateType = {aggregateType:String} AND AggregateId IN ({aggregateIds:Array(String)})",
      );
      expect(request).toMatchObject({
        query_params: {
          tenantIds: ["user-1", "user-2"],
          aggregateType: "user",
          aggregateIds: ["user-1", "user-2"],
        },
        tenantIds: ["user-1", "user-2"],
      });
    });

    it("answers each asked pair's records and drops a pair it was not asked for", async () => {
      const { repository } = repositoryAnswering([
        rowOf({ tenantId: "user-1", aggregateId: "user-1" }),
        rowOf({ tenantId: "user-1", aggregateId: "user-2" }),
        rowOf({ tenantId: "user-2", aggregateId: "user-2" }),
      ]);

      const records = await repository.findEventRecordsOfAggregates({
        aggregates: [
          { tenantId: "user-1", aggregateId: "user-1" },
          { tenantId: "user-2", aggregateId: "user-2" },
        ],
        aggregateType: "user",
      });

      expect(records.map(({ TenantId, AggregateId }) => `${TenantId}/${AggregateId}`)).toEqual([
        "user-1/user-1",
        "user-2/user-2",
      ]);
      expect(records[0]).toMatchObject({ AggregateType: "user", EventPayload: { note: "kept" } });
    });

    it("asks nothing when no aggregate is asked", async () => {
      const { repository, query } = repositoryAnswering([]);

      expect(
        await repository.findEventRecordsOfAggregates({ aggregates: [], aggregateType: "user" }),
      ).toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });
  });
});

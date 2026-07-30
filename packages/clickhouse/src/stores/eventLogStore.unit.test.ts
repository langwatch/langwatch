import type { CommittedEvent } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import type {
  ClickHouseClient,
  QueryOptions,
} from "../client/clickhouseClient";
import { eventLogTable } from "../tables/eventLog";
import { clickhouseEventLog } from "./eventLogStore";

interface FakeClient extends ClickHouseClient {
  readonly insertCalls: Array<{
    tenantId: string;
    table: string;
    rows: unknown[][];
    columns: readonly string[];
    target: unknown;
  }>;
  readonly streamCalls: QueryOptions[];
}

function createFakeClient(streamBatches: unknown[][][] = []): FakeClient {
  const insertCalls: FakeClient["insertCalls"] = [];
  const streamCalls: FakeClient["streamCalls"] = [];
  return {
    insertCalls,
    streamCalls,
    async query(): Promise<{ rows: unknown[][] }> {
      throw new Error("not used by eventLogStore");
    },
    stream(options: QueryOptions) {
      streamCalls.push(options);
      return (async function* () {
        for (const batch of streamBatches) yield batch;
      })();
    },
    async insert(options) {
      insertCalls.push(options as FakeClient["insertCalls"][number]);
    },
    async close() {},
  };
}

function committedEvent(
  overrides: Partial<CommittedEvent> = {},
): CommittedEvent {
  return {
    tenantId: "tenant-a",
    aggregateType: "trace",
    aggregateId: "trace-1",
    eventId: "event-1",
    eventType: "spanReceived",
    eventVersion: "v1",
    idempotencyKey: "idem-1",
    occurredAt: Date.UTC(2026, 0, 15, 10, 30, 0, 0),
    payload: '{"traceId":"trace-1"}',
    ...overrides,
  };
}

function columnIndex(name: string): number {
  return eventLogTable.columnNames.indexOf(name);
}

/**
 * `bindIdentifiers` routes every table/column reference through an opaque
 * `{idN:Identifier}` placeholder, so a column's name never appears literally
 * in the SQL. This finds the placeholder a given column was bound to, from
 * the params `bindIdentifiers` populated.
 */
function identifierPlaceholderFor(
  params: Record<string, unknown> | undefined,
  columnName: string,
): string {
  const entry = Object.entries(params ?? {}).find(
    ([, value]) => value === columnName,
  );
  if (!entry) throw new Error(`no identifier bound for column "${columnName}"`);
  return `{${entry[0]}:Identifier}`;
}

describe("given clickhouseEventLog()", () => {
  describe("when appending a batch of events", () => {
    /** @scenario appending a batch of events issues exactly one insert */
    it("issues exactly one insert carrying every row", async () => {
      const client = createFakeClient();
      const store = clickhouseEventLog({ client });

      await store.append([
        committedEvent({ eventId: "event-1" }),
        committedEvent({ eventId: "event-2" }),
        committedEvent({ eventId: "event-3" }),
      ]);

      expect(client.insertCalls).toHaveLength(1);
      expect(client.insertCalls[0]?.table).toBe("event_log");
      expect(client.insertCalls[0]?.rows).toHaveLength(3);
    });

    /** @scenario a retried append is safe because the sort key carries the idempotency key */
    it("marks the write as a replacing insert, which collapses duplicates at merge", async () => {
      const client = createFakeClient();
      const store = clickhouseEventLog({ client });

      await store.append([committedEvent()]);
      await store.append([committedEvent()]);

      expect(client.insertCalls).toHaveLength(2);
      for (const call of client.insertCalls) {
        expect(call.target).toEqual({ kind: "replacing" });
      }
    });

    /** @scenario appending an empty batch touches the store not at all */
    it("skips the insert entirely for an empty batch", async () => {
      const client = createFakeClient();
      const store = clickhouseEventLog({ client });

      await store.append([]);

      expect(client.insertCalls).toHaveLength(0);
    });

    it("carries the payload string into EventPayload byte-identical to the original", async () => {
      const client = createFakeClient();
      const store = clickhouseEventLog({ client });
      const payload = '{\n  "traceId": "trace-1",\n  "value": 42\n}';

      await store.append([committedEvent({ payload })]);

      const row = client.insertCalls[0]!.rows[0]!;
      expect(row[columnIndex("EventPayload")]).toBe(payload);
    });

    it("defaults ProcessingTraceparent to an empty string when absent, and carries it through when present", async () => {
      const client = createFakeClient();
      const store = clickhouseEventLog({ client });

      await store.append([
        committedEvent({ eventId: "event-1", traceparent: undefined }),
        committedEvent({ eventId: "event-2", traceparent: "00-abc-def-01" }),
      ]);

      const rows = client.insertCalls[0]!.rows;
      const idx = columnIndex("ProcessingTraceparent");
      expect(rows[0]?.[idx]).toBe("");
      expect(rows[1]?.[idx]).toBe("00-abc-def-01");
    });
  });

  describe("when scanning for replay", () => {
    /** @scenario a scan always leads with the tenant predicate */
    it("binds the tenant id as the first bound predicate", async () => {
      const client = createFakeClient([]);
      const store = clickhouseEventLog({ client });

      const iterator = store.scan({
        tenantId: "tenant-a",
        aggregateType: "trace",
      });
      await iterator[Symbol.asyncIterator]().next();

      const call = client.streamCalls[0]!;
      const whereClause = call.sql.split("WHERE ")[1]!;
      const firstCondition = whereClause.split(" AND ")[0]!;
      expect(firstCondition).toBe(
        `${identifierPlaceholderFor(call.params, "TenantId")} = {tenantId:String}`,
      );
      expect(call.params?.tenantId).toBe("tenant-a");
    });

    /** @scenario a scan bounds the partition column when a time range is given */
    it("restricts EventOccurredAt to the given range", async () => {
      const client = createFakeClient([]);
      const store = clickhouseEventLog({ client });

      const iterator = store.scan({
        tenantId: "tenant-a",
        aggregateType: "trace",
        occurredFrom: 1_000,
        occurredTo: 2_000,
      });
      await iterator[Symbol.asyncIterator]().next();

      const call = client.streamCalls[0]!;
      expect(call.sql).toContain("{occurredFrom:UInt64}");
      expect(call.sql).toContain("{occurredTo:UInt64}");
      expect(call.params?.occurredFrom).toBe(1_000);
      expect(call.params?.occurredTo).toBe(2_000);
    });

    /** @scenario a scan with no time range given is not partition-bounded */
    it("carries no EventOccurredAt bound when neither instant is given", async () => {
      const client = createFakeClient([]);
      const store = clickhouseEventLog({ client });

      const iterator = store.scan({
        tenantId: "tenant-a",
        aggregateType: "trace",
      });
      await iterator[Symbol.asyncIterator]().next();

      const call = client.streamCalls[0]!;
      expect(call.sql).not.toContain("{occurredFrom:UInt64}");
      expect(call.sql).not.toContain("{occurredTo:UInt64}");
      expect(call.params?.occurredFrom).toBeUndefined();
      expect(call.params?.occurredTo).toBeUndefined();
    });

    it("scopes to one aggregate only when an aggregate id is given", async () => {
      const client = createFakeClient([]);
      const store = clickhouseEventLog({ client });

      const iterator = store.scan({
        tenantId: "tenant-a",
        aggregateType: "trace",
        aggregateId: "trace-1",
      });
      await iterator[Symbol.asyncIterator]().next();

      const call = client.streamCalls[0]!;
      expect(call.sql).toContain(
        `${identifierPlaceholderFor(call.params, "AggregateId")} = {aggregateId:String}`,
      );
      expect(call.params?.aggregateId).toBe("trace-1");
    });

    /** @scenario a scanned row decodes back to the event that was appended */
    it("decodes a streamed row back into the event that was appended", async () => {
      const payload = '{"traceId":"trace-1"}';
      const event = committedEvent({ payload });

      const encodeClient = createFakeClient();
      const encodeStore = clickhouseEventLog({ client: encodeClient });
      await encodeStore.append([event]);
      const wireRow = encodeClient.insertCalls[0]!.rows[0]!;

      const scanClient = createFakeClient([[wireRow]]);
      const scanStore = clickhouseEventLog({ client: scanClient });

      const events: CommittedEvent[] = [];
      for await (const decoded of scanStore.scan({
        tenantId: event.tenantId,
        aggregateType: event.aggregateType,
      })) {
        events.push(decoded);
      }

      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toBe(payload);
      expect(events[0]?.aggregateId).toBe(event.aggregateId);
      expect(events[0]?.eventId).toBe(event.eventId);
    });

    it("streams across several batches rather than requiring one materialised result", async () => {
      const client = createFakeClient([[], []]);
      const store = clickhouseEventLog({ client });

      const seen: CommittedEvent[] = [];
      for await (const event of store.scan({
        tenantId: "tenant-a",
        aggregateType: "trace",
      })) {
        seen.push(event);
      }

      expect(seen).toHaveLength(0);
      expect(client.streamCalls).toHaveLength(1);
    });
  });
});

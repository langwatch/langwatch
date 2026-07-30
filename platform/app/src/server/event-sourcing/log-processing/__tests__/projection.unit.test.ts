import type { ClickHouseClient, QueryOptions } from "@langwatch/clickhouse";
import type { AggregateEvent } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { logRecord } from "../aggregate";
import { canonicalizeLogRequest } from "../canonicalize";
import { createCanonicalLogStorageProjection } from "../projection";

interface FakeClient extends ClickHouseClient {
  readonly insertCalls: Array<{ table: string; rows: unknown[][] }>;
}

function createFakeClient(): FakeClient {
  const insertCalls: FakeClient["insertCalls"] = [];
  return {
    insertCalls,
    async query(): Promise<{ rows: unknown[][] }> {
      throw new Error("not used");
    },
    stream(_options: QueryOptions) {
      throw new Error("not used");
    },
    async insert(options) {
      insertCalls.push({ table: options.table, rows: options.rows });
    },
    async close() {},
  };
}

async function fixtureEvent(): Promise<AggregateEvent> {
  const result = await canonicalizeLogRequest({
    tenantId: "tenant-a",
    organizationId: "org-a",
    piiRedactionLevel: "DISABLED",
    redactionService: { redactLog: async () => undefined },
    acceptedAt: 1_700_000_000_000,
    request: {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: { name: "s" },
              logRecords: [{ body: { stringValue: "x" } }],
            },
          ],
        },
      ],
    } as any,
  });
  return logRecord.events.recordReceived(result.accepted[0]!.record);
}

describe("createCanonicalLogStorageProjection", () => {
  it("does not throw at construction — the mount is legal (mount.unit.test.ts covers the rule itself)", () => {
    expect(() =>
      createCanonicalLogStorageProjection({ client: createFakeClient() }),
    ).not.toThrow();
  });

  describe("given a delivery of recordReceived events", () => {
    it("writes them through to the store as a single batch", async () => {
      const client = createFakeClient();
      const executor = createCanonicalLogStorageProjection({ client });
      const event = await fixtureEvent();

      const result = await executor.apply({
        tenantId: "tenant-a",
        events: [event],
      });

      expect(result).toEqual({ written: 1 });
      expect(client.insertCalls.some((c) => c.table === "log_records")).toBe(
        true,
      );
    });
  });

  describe("given an event of a type this aggregate never declared", () => {
    it("maps it to nothing and writes nothing", async () => {
      const client = createFakeClient();
      const executor = createCanonicalLogStorageProjection({ client });

      const result = await executor.apply({
        tenantId: "tenant-a",
        events: [{ type: "log/somethingElse", data: {} }],
      });

      expect(result).toEqual({ written: 0 });
      expect(client.insertCalls).toHaveLength(0);
    });
  });
});

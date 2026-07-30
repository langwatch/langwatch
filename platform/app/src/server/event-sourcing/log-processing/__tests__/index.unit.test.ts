import type { ClickHouseClient, QueryOptions } from "@langwatch/clickhouse";
import {
  type AppendStore,
  LEGAL_MOUNT_SHAPES,
  validateMount,
  type WireEvent,
} from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import { canonicalizeLogRequest } from "../canonicalize";
import {
  canonicalLogStorageMount,
  createLogProcessingPipeline,
} from "../index";
import type { CanonicalLogRecord } from "../schema";
import { logRecordsTable, logUsageEstimatesTable } from "../table";

interface FakeClient extends ClickHouseClient {
  readonly insertCalls: Array<{
    table: string;
    rows: unknown[][];
    columns: readonly string[];
    target: unknown;
  }>;
}

function createFakeClient(): FakeClient {
  const insertCalls: FakeClient["insertCalls"] = [];
  return {
    insertCalls,
    async query(): Promise<{ rows: unknown[][] }> {
      throw new Error("not used by an append store");
    },
    stream(_options: QueryOptions) {
      throw new Error("not used by an append store");
    },
    async insert(options) {
      insertCalls.push({
        table: options.table,
        rows: options.rows,
        columns: options.columns,
        target: options.target,
      });
    },
    async close() {},
  };
}

async function fixtureRecords(count: 1 | 2): Promise<CanonicalLogRecord[]> {
  const bodies = ["one", "two"].slice(0, count);
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
              scope: { name: "test.scope" },
              logRecords: bodies.map((body) => ({
                body: { stringValue: body },
              })),
            },
          ],
        },
      ],
    } as any,
  });
  return result.accepted.map((prepared) => prepared.record);
}

function recordReceivedEvent(record: CanonicalLogRecord): WireEvent {
  return { type: "lw.obs.log.record_received", data: record };
}

async function fixtureEvents(count: 1 | 2): Promise<WireEvent[]> {
  const records = await fixtureRecords(count);
  return records.map(recordReceivedEvent);
}

const recordingStore: AppendStore<CanonicalLogRecord> = {
  kind: "append",
  async writeBatch() {},
};

describe("the built log-processing pipeline", () => {
  it("names itself 'log', matching the persisted AggregateType already in event_log", () => {
    // migrations/00050_create_canonical_logs.sql keys `_size_bytes`'s
    // MATERIALIZED expression on `AggregateType IN ('metric', 'log')`.
    const built = createLogProcessingPipeline({ client: createFakeClient() });
    expect(built.name).toBe("log");
  });

  it("derives the dotted event type string already persisted in event_log", () => {
    const built = createLogProcessingPipeline({ client: createFakeClient() });
    expect([...built.eventTypes]).toEqual(["lw.obs.log.record_received"]);
  });

  it("stamps a command's emitted event with the pipeline's derived persisted type", async () => {
    const built = createLogProcessingPipeline({ client: createFakeClient() });
    const [record] = await fixtureRecords(1);
    const emitted = await built.commands.recordCanonicalLog!.handle(record!, {
      now: Date.now(),
      tenantId: "tenant-a",
    });
    expect(emitted).toEqual([recordReceivedEvent(record!)]);
  });
});

describe("the canonicalLogStorage mount", () => {
  /** @scenario a lane scoped to a declared partition is the unit of batching */
  it("is one of ADR-106's enumerated legal shapes", () => {
    expect(LEGAL_MOUNT_SHAPES).toContainEqual(
      canonicalLogStorageMount(recordingStore),
    );
  });

  /** @scenario The projection's mount is a map over an append store, not a fold */
  it("takes its store kind from the store the executor runs on, and is accepted as legal", () => {
    const mount = canonicalLogStorageMount(recordingStore);
    expect(mount.projection).toBe("map");
    expect(mount.store).toBe(recordingStore.kind);
    expect(validateMount(mount)).toEqual([]);
    expect(LEGAL_MOUNT_SHAPES).toContainEqual(mount);
  });

  it("is asserted at composition rather than on the first delivery", () => {
    expect(() =>
      createLogProcessingPipeline({ client: createFakeClient() }),
    ).not.toThrow();
  });

  describe("given the mount were mistakenly declared as a fold", () => {
    it("is refused for scoping wider than one aggregate", () => {
      const mount = canonicalLogStorageMount(recordingStore);
      const violations = validateMount({
        projection: "fold",
        store: "replace",
        scope: mount.scope,
        collapse: mount.collapse,
      });
      expect(violations.map((v) => v.rule)).toContain(
        "fold-scope-must-be-aggregate",
      );
    });
  });

  describe("given the mount were mistakenly declared on a merge store", () => {
    it("is refused because merge is closed to new adopters", () => {
      const mount = canonicalLogStorageMount(recordingStore);
      const violations = validateMount({
        projection: mount.projection,
        store: "merge",
        idempotency: "whole-bucket-replace",
        scope: mount.scope,
        collapse: mount.collapse,
      });
      expect(violations.map((v) => v.rule)).toContain(
        "merge-closed-to-new-adopters",
      );
    });
  });
});

describe("the canonicalLogStorage map", () => {
  describe("given a delivery of recordReceived events", () => {
    it("writes both log_records and log_usage_estimates in one call each", async () => {
      const client = createFakeClient();
      const built = createLogProcessingPipeline({ client });

      const result = await built.maps.canonicalLogStorage!.apply({
        tenantId: "tenant-a",
        events: await fixtureEvents(2),
      });

      expect(result).toEqual({ written: 2 });
      expect(client.insertCalls.map((call) => call.table).sort()).toEqual([
        "log_records",
        "log_usage_estimates",
      ]);
      for (const call of client.insertCalls) {
        expect(call.rows).toHaveLength(2);
      }
    });

    it("carries the record id through to both tables, so a redelivery collapses in each", async () => {
      const client = createFakeClient();
      const built = createLogProcessingPipeline({ client });
      const records = await fixtureRecords(2);

      await built.maps.canonicalLogStorage!.apply({
        tenantId: "tenant-a",
        events: records.map(recordReceivedEvent),
      });

      for (const call of client.insertCalls) {
        const recordIdIndex = call.columns.indexOf("RecordId");
        expect(call.rows.map((row) => row[recordIdIndex])).toEqual(
          records.map((record) => record.recordId),
        );
      }
    });

    it("marks both writes as targeting a replacing table, which ADR-104 lets the client retry", async () => {
      const client = createFakeClient();
      const built = createLogProcessingPipeline({ client });

      await built.maps.canonicalLogStorage!.apply({
        tenantId: "tenant-a",
        events: await fixtureEvents(1),
      });

      for (const call of client.insertCalls) {
        expect(call.target).toEqual({ kind: "replacing" });
      }
    });

    it("forwards the resolved retentionDays into the log_records row", async () => {
      const client = createFakeClient();
      const built = createLogProcessingPipeline({ client });

      await built.maps.canonicalLogStorage!.apply({
        tenantId: "tenant-a",
        events: await fixtureEvents(1),
        retentionDays: 45,
      });

      const call = client.insertCalls.find((c) => c.table === "log_records")!;
      const retentionIndex = call.columns.indexOf("_retention_days");
      expect(call.rows.every((row) => row[retentionIndex] === 45)).toBe(true);
    });

    it("maps the record's own fields onto the table's columns, case-shifted", async () => {
      const client = createFakeClient();
      const built = createLogProcessingPipeline({ client });
      const [record] = await fixtureRecords(1);

      await built.maps.canonicalLogStorage!.apply({
        tenantId: "tenant-a",
        events: [recordReceivedEvent(record!)],
      });

      const call = client.insertCalls.find((c) => c.table === "log_records")!;
      // Rows reach the client already encoded, so each cell is read back
      // through its own column's decoder rather than compared to a wire form
      // spelled out a second time here.
      const cell = <Name extends keyof typeof logRecordsTable.columns>(
        column: Name,
      ) =>
        logRecordsTable.columns[column].decode(
          call.rows[0]![call.columns.indexOf(column)],
        );
      expect(cell("BodyText")).toBe(record!.bodyText);
      expect(cell("SeverityNumber")).toBe(record!.severityNumber);
      expect(cell("ScopeName")).toBe(record!.scopeName);
      // The columns whose value is not a straight case-shift of a field.
      expect(cell("TimeUnixNano")).toBe(BigInt(record!.timeUnixNano));
      expect(cell("AcceptedAt")).toEqual(new Date(record!.acceptedAt));
      expect(cell("_size_bytes")).toBe(record!.canonicalSizeBytes);
    });

    it("estimates usage against the whole UTC hour the record was accepted in", async () => {
      const client = createFakeClient();
      const built = createLogProcessingPipeline({ client });
      const [record] = await fixtureRecords(1);

      await built.maps.canonicalLogStorage!.apply({
        tenantId: "tenant-a",
        events: [recordReceivedEvent(record!)],
      });

      const call = client.insertCalls.find(
        (c) => c.table === "log_usage_estimates",
      )!;
      const cell = <Name extends keyof typeof logUsageEstimatesTable.columns>(
        column: Name,
      ) =>
        logUsageEstimatesTable.columns[column].decode(
          call.rows[0]![call.columns.indexOf(column)],
        );
      const expectedHour = new Date(record!.acceptedAt);
      expectedHour.setUTCMinutes(0, 0, 0);
      expect(cell("AcceptedHour")).toEqual(expectedHour);
      expect(cell("CanonicalSourceBytes")).toBe(record!.canonicalSizeBytes);
      expect(cell("OrganizationId")).toBe(record!.organizationId);
    });
  });

  describe("given a batch that has already been written once", () => {
    /** @scenario A redelivered batch collapses to one row per table, not two */
    it("issues the same plain insert again, relying on RecordId to collapse the duplicate", async () => {
      const client = createFakeClient();
      const built = createLogProcessingPipeline({ client });
      const delivery = {
        tenantId: "tenant-a",
        events: await fixtureEvents(2),
      };

      await built.maps.canonicalLogStorage!.apply(delivery);
      await built.maps.canonicalLogStorage!.apply(delivery);

      // Nothing here deduplicates a redelivered batch: both deliveries issue
      // the same insert per table, and it is each row's own RecordId — part of
      // both tables' sort key (table.unit.test.ts) — that the ReplacingMergeTree
      // collapses on at merge time.
      const insertsByTable = new Map<string, number>();
      for (const call of client.insertCalls) {
        insertsByTable.set(
          call.table,
          (insertsByTable.get(call.table) ?? 0) + 1,
        );
      }
      expect(insertsByTable.get("log_records")).toBe(2);
      expect(insertsByTable.get("log_usage_estimates")).toBe(2);

      const logRecordsCalls = client.insertCalls.filter(
        (call) => call.table === "log_records",
      );
      const recordIdIndex = logRecordsCalls[0]!.columns.indexOf("RecordId");
      expect(logRecordsCalls[0]!.rows.map((r) => r[recordIdIndex])).toEqual(
        logRecordsCalls[1]!.rows.map((r) => r[recordIdIndex]),
      );
    });
  });

  describe("given an event of a type this pipeline never declared", () => {
    it("maps it to nothing and writes nothing", async () => {
      const client = createFakeClient();
      const built = createLogProcessingPipeline({ client });

      const result = await built.maps.canonicalLogStorage!.apply({
        tenantId: "tenant-a",
        events: [{ type: "lw.obs.log.something_else", data: {} }],
      });

      expect(result).toEqual({ written: 0 });
      expect(client.insertCalls).toHaveLength(0);
    });
  });

  describe("given one of the two underlying inserts fails", () => {
    it("propagates the failure rather than reporting a partial write as a success", async () => {
      const client = createFakeClient();
      const failingInsert = vi
        .spyOn(client, "insert")
        .mockImplementationOnce(async () => {
          throw new Error("log_records insert failed");
        });
      const built = createLogProcessingPipeline({ client });

      await expect(
        built.maps.canonicalLogStorage!.apply({
          tenantId: "tenant-a",
          events: await fixtureEvents(1),
        }),
      ).rejects.toThrow("log_records insert failed");
      failingInsert.mockRestore();
    });
  });
});

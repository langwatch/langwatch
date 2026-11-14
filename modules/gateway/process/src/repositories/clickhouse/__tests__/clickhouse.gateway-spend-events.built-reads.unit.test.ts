/**
 * Every spend-ledger read is a built statement on the reader identity. A project's reads carry
 * `TenantId = {tenantId}` and that tenant as the setting; caller values are bound, never spliced.
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import * as spendCursors from "../../../rules/gateway-spend-cursor.rules.ts";
import type { GatewayClickHouseClient } from "../clickhouse.gateway-session.store.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";

type Sent = Parameters<GatewayClickHouseClient["read"]>[0];

function repositoryOver(rows: Record<string, unknown>[] = []) {
  const sent: Sent[] = [];
  const client: GatewayClickHouseClient = {
    read: async (input) => {
      sent.push(input);
      return { rows: rows as never[] };
    },
    query: () => Promise.reject(new Error("spend reads are built statements")),
    insert: async () => undefined,
  };
  const repository = ClickHouseGatewaySpendEventsRepository.create(async () => client);
  const statements = () => sent.map((each) => each.statement as ReaderReadStatement);
  return { repository, sent, statements };
}

function expectProjectRead(statement: ReaderReadStatement | undefined, tenantId: string) {
  expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId });
  expect(statement?.tenantIds).toBeUndefined();
  expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: tenantId });
  expect(statement?.sql).toContain("WHERE TenantId = {tenantId:String}");
  expect(statement?.params).toMatchObject({ tenantId });
}

describe("ClickHouseGatewaySpendEventsRepository built reads", () => {
  describe("when the fold reads one request back", () => {
    it("reads the project's latest row by the request id index, with no window it lacks", async () => {
      const { repository, sent, statements } = repositoryOver();

      await expect(
        repository.findForFold({ tenantId: "project-1", gatewayRequestId: "req-1" }),
      ).resolves.toBeNull();

      expectProjectRead(statements()[0], "project-1");
      expect(statements()[0]?.sql).toContain("FROM gateway_spend FINAL");
      expect(statements()[0]?.sql).toContain(
        "GatewayRequestId = {v0:String} {{idBound:gateway_spend.GatewayRequestId:v0}}",
      );
      expect(statements()[0]?.sql).toContain("LIMIT 1");
      expect(sent[0]?.idBound).toEqual({ fallback: "unbounded" });
    });
  });

  describe("when the ledger UI pages one project with every filter and a cursor", () => {
    it("binds each filter value and walks newest first past the cursor", async () => {
      const { repository, statements } = repositoryOver();

      await repository.readSpendEventsPage({
        tenantId: "project-1",
        fromMs: 1,
        toMs: 2,
        filters: {
          virtualKeyIds: ["vk-1"],
          labels: ["team:a"],
          metadata: [{ key: "tier'--", values: ["gold"] }],
          status: "success",
        },
        cursor: { occurredAtMs: 5, gatewayRequestId: "req-9" },
      });

      const statement = statements()[0];
      expectProjectRead(statement, "project-1");
      expect(statement?.sql).toContain("VirtualKeyId IN ({v2:Array(String)})");
      expect(statement?.sql).toContain("hasAny(Labels, {v3:Array(String)})");
      expect(statement?.sql).toContain("MetadataMap[{v4:String}] IN ({v5:Array(String)})");
      expect(statement?.sql).toContain(
        "tuple(OccurredAt, GatewayRequestId) < tuple(fromUnixTimestamp64Milli({v7:Int64}), {v8:String})",
      );
      expect(statement?.sql).toContain("ORDER BY OccurredAt DESC, GatewayRequestId DESC LIMIT 50");
      expect(statement?.sql).not.toContain("tier");
      expect(statement?.params).toMatchObject({
        v2: ["vk-1"],
        v3: ["team:a"],
        v4: "tier'--",
        v5: ["gold"],
        v6: "confirmed",
        v7: 5,
        v8: "req-9",
      });
    });

    it("emits a present-but-empty filter rather than widening to the whole project", async () => {
      const { repository, statements } = repositoryOver();

      await repository.readSpendEventsPage({
        tenantId: "project-1",
        fromMs: 1,
        toMs: 2,
        filters: { models: [] },
      });

      expect(statements()[0]?.sql).toContain("Model IN ({v2:Array(String)})");
      expect(statements()[0]?.params).toMatchObject({ v2: [] });
    });
  });

  describe("when a range is read for internal consumers", () => {
    it("reads the project's window oldest first", async () => {
      const { repository, statements } = repositoryOver();

      await repository.readSpendEvents({ tenantId: "project-1", fromMs: 1, toMs: 2, limit: 10 });

      expectProjectRead(statements()[0], "project-1");
      expect(statements()[0]?.sql).toContain(
        "ORDER BY OccurredAt ASC, GatewayRequestId ASC LIMIT 10",
      );
    });
  });

  describe("when an organisation's events are walked from a cursor", () => {
    it("advances past the cursor in event time and forwards a declared full scan", async () => {
      const { repository, sent, statements } = repositoryOver();

      await repository.walkSpendEvents({
        tenantIds: ["project-1", "project-2"],
        cursor: spendCursors.encodeSpendEventsCursor({
          eventTimestampMs: 10,
          gatewayRequestId: "req-1",
        }),
        limit: 5,
        SKIP_COLD_SCAN_CHECK: true,
      });

      expect(statements()[0]).toMatchObject({
        identity: "reader",
        tenantIds: ["project-1", "project-2"],
      });
      expect(statements()[0]?.settings).toMatchObject({
        SQL_langwatch_tenant_ids: "project-1,project-2",
      });
      expect(sent[0]?.declaresFullScan).toBe(true);
      expect(statements()[0]?.sql).toContain(
        "tuple(EventTimestamp, GatewayRequestId) > tuple({v0:UInt64}, {v1:String})",
      );
      expect(statements()[0]?.params).toMatchObject({ v0: 10, v1: "req-1" });
      expect(statements()[0]?.sql).toContain(
        "ORDER BY EventTimestamp ASC, GatewayRequestId ASC LIMIT 5",
      );
    });
  });

  describe("when a rollup is bucketed by hour in a time zone", () => {
    it("binds the zone, groups and orders by the bucket first, and keeps the deadline", async () => {
      const { repository, statements } = repositoryOver();

      await repository.readSpendSummaries({
        tenantIds: ["project-1"],
        groupBy: ["model"],
        bucket: "hour",
        timezone: "Europe/Amsterdam",
        fromMs: 1,
        toMs: 2,
      });

      const sql = statements()[0]?.sql ?? "";
      const bucket =
        "formatDateTime(toStartOfHour(OccurredAt, {v0:String}), {v1:String}, {v2:String})";
      expect(sql).toContain(`${bucket} AS GroupBucket, Model AS GroupKey0`);
      expect(sql).toContain(`GROUP BY ${bucket}, Model ORDER BY ${bucket} ASC, Model ASC`);
      expect(sql).toContain("SETTINGS max_execution_time = 60");
      expect(sql).not.toContain("Europe/Amsterdam");
      expect(statements()[0]?.params).toMatchObject({
        v0: "Europe/Amsterdam",
        v2: "Europe/Amsterdam",
      });
    });

    it("refuses a cursor walking a different number of dimensions", async () => {
      const { repository } = repositoryOver();

      await expect(
        repository.readSpendSummaries({
          tenantIds: ["project-1"],
          groupBy: ["model", "provider"],
          fromMs: 1,
          toMs: 2,
          cursor: spendCursors.encodeSpendSummariesCursor(["gpt-5"]),
        }),
      ).rejects.toThrow(/groups by 2/);
    });
  });

  describe("when one end user's spend is read for one key", () => {
    it("narrows to the end user, the window and the key", async () => {
      const { repository, statements } = repositoryOver();

      await repository.readEndUserSpend({
        tenantIds: ["project-1"],
        endUserId: "end-user-1",
        fromMs: 1,
        toMs: 2,
        virtualKeyId: "vk-1",
      });

      expect(statements()[0]?.tenantIds).toEqual(["project-1"]);
      expect(statements()[0]?.sql).toContain("EndUserId = {v0:String}");
      expect(statements()[0]?.sql).toContain("VirtualKeyId = {v3:String}");
      expect(statements()[0]?.params).toMatchObject({ v0: "end-user-1", v3: "vk-1" });
    });
  });

  describe("when usage is counted per project", () => {
    it("reads each project's count and earliest request as its own statements", async () => {
      const { repository, statements } = repositoryOver([
        { Total: "0", SpendNanoUsd: "0", FirstMs: "0" },
      ]);

      await expect(
        repository.countUsage({ projectIds: ["project-1", "project-2", "project-1"], since: 3 }),
      ).resolves.toEqual({ requests: 0, spendUsd: 0 });

      expect(statements()).toHaveLength(4);
      expectProjectRead(statements()[0], "project-1");
      expectProjectRead(statements()[2], "project-2");
      expect(statements()[0]?.sql).toContain("FROM gateway_spend FINAL");
      expect(statements()[0]?.sql).toContain("OccurredAt >= fromUnixTimestamp64Milli({v0:Int64})");
      expect(statements()[1]?.sql).toContain("min(OccurredAt)");
      expect(statements()[1]?.sql).not.toContain("FINAL");
    });
  });
});

/**
 * The client's reporting step: each read and write is logged and counted once its
 * retries settle, the way the vendor-client policy reports it.
 * @see specs/ops/clickhouse-statement-reporting.feature
 */
import { describe, expect, it } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import { detectColdScan } from "../coldScanDetector.ts";
import type { QueryDriver } from "../query.ts";
import {
  StatementReporter,
  type StatementLogSink,
  type StatementMetrics,
} from "../statementReporting.ts";

type Line = { level: "debug" | "warn" | "error"; fields: Record<string, unknown>; message: string };

function recordingSink(lines: Line[]): StatementLogSink {
  return {
    debug: (fields, message) => lines.push({ level: "debug", fields, message }),
    warn: (fields, message) => lines.push({ level: "warn", fields, message }),
    error: (fields, message) => lines.push({ level: "error", fields, message }),
  };
}

function reportingClient(driver: Partial<QueryDriver>) {
  const lines: Line[] = [];
  const durations: Parameters<StatementMetrics["observeDuration"]>[0][] = [];
  const counts: Parameters<StatementMetrics["incrementCount"]>[0][] = [];
  const reporter = new StatementReporter({
    metrics: {
      observeDuration: (input) => durations.push(input),
      incrementCount: (input) => counts.push(input),
    },
    outcomeLogger: recordingSink(lines),
    noticeLogger: recordingSink(lines),
    detectColdScan,
  });
  const unused = async (): Promise<never> => {
    throw new Error("not part of this case");
  };
  const client = new ClickHouseQueryClient({
    driver: { execute: unused, insert: unused, command: unused, ...driver },
    reporter,
  });

  return { client, lines, durations, counts };
}

describe("ClickHouseQueryClient reporting", () => {
  describe("given a read that filters on its partition column", () => {
    /** @scenario "A read that succeeds is timed and counted as a success" */
    it("observes its duration and counts a success without a cold-scan warning", async () => {
      const { client, lines, durations, counts } = reportingClient({
        execute: async () => ({ rows: [] }),
      });

      await client.query({
        tenantId: "project_abc",
        table: "stored_spans",
        sql: "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String} AND StartTime >= {from:DateTime64(3)}",
        params: { tenantId: "project_abc" },
      });

      expect(durations).toEqual([
        { queryType: "SELECT", table: "stored_spans", durationSeconds: expect.any(Number) },
      ]);
      expect(counts).toEqual([{ queryType: "SELECT", outcome: "success" }]);
      expect(lines.filter((line) => line.level === "warn")).toEqual([]);
      expect(lines.map((line) => line.message)).toEqual(["ClickHouse query succeeded"]);
    });
  });

  describe("given a read with no predicate on the partition column", () => {
    /** @scenario "A read with no partition predicate is warned about as a cold scan" */
    it("warns with the table it walked", async () => {
      const { client, lines } = reportingClient({ execute: async () => ({ rows: [] }) });

      await client.query({
        tenantId: "project_abc",
        sql: "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String}",
        params: { tenantId: "project_abc" },
      });

      expect(lines).toEqual([
        expect.objectContaining({
          level: "warn",
          fields: expect.objectContaining({ coldScan: true, coldScanTable: "stored_spans" }),
        }),
      ]);
    });
  });

  describe("given a read that fails", () => {
    /** @scenario "A statement that fails is reported and still reaches its caller" */
    it("logs and counts the failure, then raises the original error", async () => {
      const failure = new Error("Code: 241. DB::Exception: Memory limit exceeded");
      const { client, lines, counts } = reportingClient({
        execute: async () => {
          throw failure;
        },
      });

      await expect(
        client.query({
          tenantId: "project_abc",
          sql: "SELECT 1 WHERE TenantId = {tenantId:String}",
          params: { tenantId: "project_abc" },
        }),
      ).rejects.toBe(failure);
      expect(counts).toEqual([{ queryType: "SELECT", outcome: "error" }]);
      expect(lines).toEqual([
        expect.objectContaining({ level: "warn", message: "ClickHouse query failed" }),
      ]);
    });
  });

  describe("given a batch insert", () => {
    /** @scenario "A write is counted as an insert against its table" */
    it("counts an INSERT success against the table it wrote to", async () => {
      const { client, durations, counts } = reportingClient({ insert: async () => undefined });

      await client.insert({
        tenantId: "project_abc",
        table: "stored_spans",
        rows: [{ TenantId: "project_abc" }],
      });

      expect(durations).toEqual([
        { queryType: "INSERT", table: "stored_spans", durationSeconds: expect.any(Number) },
      ]);
      expect(counts).toEqual([{ queryType: "INSERT", outcome: "success" }]);
    });
  });
});

/**
 * The first-write-wins lookup's statement: one tenant, its keys as a tuple membership against
 * zipped bound arrays, inside the batch's inclusive StartTime window.
 * @see specs/trace/span-analytics-written-once.feature
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { SpanAnalyticsClickHouseRepository } from "../span-analytics.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

const TENANT = "project-1";

function lookup(rows: unknown[] = []) {
  const requests: ReadRequest[] = [];
  const repository = SpanAnalyticsClickHouseRepository.create({
    resolveClient: () => Promise.reject(new Error("the lookup only reads")),
    reader: clickHouseQueryClientDouble({
      async read(request: ReadRequest) {
        requests.push(request);
        return { rows };
      },
    }),
  });
  return { repository, requests };
}

describe("SpanAnalyticsClickHouseRepository.existingSpanKeys", () => {
  describe("given a batch's keys and its StartTime window", () => {
    /** @scenario "A re-sent span whose start time moved by under seven days is found" */
    it("reads one tenant's keys by tuple membership inside the inclusive window", async () => {
      const { repository, requests } = lookup([{ TraceId: "trace-1", SpanId: "span-1" }]);

      const found = await repository.existingSpanKeys({
        tenantId: TENANT,
        keys: [
          { traceId: "trace-1", spanId: "span-1" },
          { traceId: "trace-2", spanId: "span-2" },
        ],
        startTimeFromMs: 1_000,
        startTimeToMs: 2_000,
      });

      expect(found).toEqual([{ traceId: "trace-1", spanId: "span-1" }]);
      const statement = requests[0]?.statement;
      expect(statement).toMatchObject({
        kind: "tenant",
        identity: "reader",
        tenantIds: undefined,
        settings: { SQL_langwatch_tenant_ids: TENANT },
        params: { tenantId: TENANT },
      });
      const sql = statement?.sql ?? "";
      expect(sql).toContain("TenantId = {tenantId:String}");
      const zipped =
        /tuple\(TraceId, SpanId\) IN \(arrayZip\(\{(v\d+):Array\(String\)\}, \{(v\d+):Array\(String\)\}\)\)/.exec(
          sql,
        );
      expect(zipped?.slice(1).map((name) => statement?.params[name])).toEqual([
        ["trace-1", "trace-2"],
        ["span-1", "span-2"],
      ]);
      expect(sql).toMatch(/StartTime >= fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/);
      expect(sql).toMatch(/StartTime <= fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/);
    });
  });

  describe("given no keys", () => {
    it("reads nothing", async () => {
      const { repository, requests } = lookup();

      await expect(
        repository.existingSpanKeys({
          tenantId: TENANT,
          keys: [],
          startTimeFromMs: 1_000,
          startTimeToMs: 2_000,
        }),
      ).resolves.toEqual([]);
      expect(requests).toHaveLength(0);
    });
  });
});

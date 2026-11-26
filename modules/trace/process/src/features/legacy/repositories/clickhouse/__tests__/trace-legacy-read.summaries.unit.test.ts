/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-summaries-list.feature
 */
import { detectColdScan } from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { traceSummaryRow } from "../../../../../repositories/clickhouse/__tests__/support/trace-summary-row.support.ts";
import type { TraceClickHouseClient } from "../../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";

const FILTER = {
  sql: "Attributes[{attrKey_0:String}] = {attrValue_1:String}",
  params: { attrKey_0: "langwatch.origin.kind", attrValue_1: "ingestion_source" },
};

type Statement = { query: string; query_params?: Record<string, unknown> };

function compose(answers: unknown[][]) {
  const query = vi.fn(async (_input: Statement) => {
    const rows = answers.shift() ?? [];
    return { json: async (): Promise<unknown[]> => rows };
  });
  const client = createApiFixture<TraceClickHouseClient>({ query });
  const repository = new TraceLegacyReadClickHouseRepository({
    resolveClickHouseClient: async () => client,
  });
  return { repository, query };
}

const window = { projectId: "project-1", startDate: 1_000, endDate: Date.now(), pageSize: 1 };

describe("TraceLegacyReadClickHouseRepository.findTraceSummaries", () => {
  /** @scenario "A summaries-only list reads bare summaries under the list's filter" */
  it("runs the filtered page statement, then the pruned summary read, and nothing else", async () => {
    const { repository, query } = compose([
      [{ TraceId: "trace-1" }],
      [
        traceSummaryRow({
          ts_UpdatedAt: "5000",
          ts_OccurredAt: "4000",
          ts_TotalCost: 0.5,
          ts_Models: ["model-1"],
          ts_Attributes: { "langwatch.origin.kind": "ingestion_source" },
        }),
      ],
    ]);

    const page = await repository.findTraceSummaries(window, {
      dateField: "updated",
      filterWhere: FILTER,
    });

    expect(query).toHaveBeenCalledTimes(2);
    const [pageStatement, summaryStatement] = query.mock.calls.map((call) => call[0]);
    expect(pageStatement?.query).toContain(FILTER.sql);
    expect(pageStatement?.query).not.toContain("count(");
    expect(pageStatement?.query_params).toMatchObject(FILTER.params);
    expect(summaryStatement?.query).not.toContain("ts.ComputedInput");
    expect(summaryStatement?.query).not.toContain("ts.ComputedOutput");
    expect(page.summaries).toEqual([
      expect.objectContaining({
        traceId: "trace-1",
        updatedAt: 5000,
        occurredAt: 4000,
        totalCost: 0.5,
        models: ["model-1"],
        attributes: { "langwatch.origin.kind": "ingestion_source" },
      }),
    ]);
    expect(page.updatedThrough).toBeLessThanOrEqual(Date.now());
  });

  /** @scenario "A summaries-only list pages by the list read's keyset cursor" */
  it("returns a scroll id on a full page that seeks past its last summary", async () => {
    const first = compose([[{ TraceId: "trace-1" }], [traceSummaryRow({ ts_UpdatedAt: "5000" })]]);
    const page = await first.repository.findTraceSummaries(window, { dateField: "updated" });
    expect(page.scrollId).toBeDefined();

    const next = compose([[]]);
    await next.repository.findTraceSummaries(window, {
      dateField: "updated",
      scrollId: page.scrollId ?? null,
    });
    expect(next.query.mock.calls.at(0)?.at(0)?.query_params).toMatchObject({
      lastTimestamp: 5000,
      lastTraceId: "trace-1",
    });
  });

  /** @scenario "A summaries-only list on the updated axis can bound the partitions it reads" */
  it("carries the occurrence floor on every statement, so none is a cold scan", async () => {
    const { repository, query } = compose([
      [{ TraceId: "trace-1" }],
      [traceSummaryRow({ ts_UpdatedAt: "5000", ts_OccurredAt: "4000" })],
    ]);

    await repository.findTraceSummaries(window, {
      dateField: "updated",
      filterWhere: FILTER,
      occurredAtFloorMs: 604_800_123.9,
    });

    const statements = query.mock.calls.map((call) => call[0]);
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      // The outer scan and the latest-version subquery each prune on their own.
      const bounds = statement.query.match(/OccurredAt >= fromUnixTimestamp64Milli\(\{occurredFloor:UInt64\}\)/g);
      expect(bounds?.length).toBeGreaterThanOrEqual(2);
      expect(statement.query_params).toMatchObject({ occurredFloor: 604_800_123 });
      expect(detectColdScan(statement.query)).toBeNull();
    }
  });

  /** @scenario "A summaries-only list reads every partition when no floor is given" */
  it("adds no occurrence bound when no floor is given, so the statements are unchanged", async () => {
    const { repository, query } = compose([
      [{ TraceId: "trace-1" }],
      [traceSummaryRow({ ts_UpdatedAt: "5000", ts_OccurredAt: "4000" })],
    ]);

    await repository.findTraceSummaries(window, { dateField: "updated", filterWhere: FILTER });

    for (const call of query.mock.calls) {
      expect(call[0].query).not.toContain("occurredFloor");
      expect(call[0].query_params).not.toHaveProperty("occurredFloor");
    }
    // The cold scan is what the floor exists to remove: the unbounded statements still warn.
    expect(detectColdScan(query.mock.calls.at(0)?.at(0)?.query ?? "")).toBe("trace_summaries");
  });

  it("ignores a floor on the occurred axis, whose window already bounds OccurredAt", async () => {
    const { repository, query } = compose([[]]);

    await repository.findTraceSummaries(window, { occurredAtFloorMs: 5_000 });

    expect(query.mock.calls.at(0)?.at(0)?.query).not.toContain("occurredFloor");
  });

  /** @scenario "A summaries-only list read that fails is refused, not answered empty" */
  it("fails the read when the store fails the page statement", async () => {
    const query = vi.fn(async (_input: Statement) => {
      throw new Error("clickhouse unavailable");
    });
    const repository = new TraceLegacyReadClickHouseRepository({
      resolveClickHouseClient: async () => createApiFixture<TraceClickHouseClient>({ query }),
    });

    await expect(
      repository.findTraceSummaries(window, { dateField: "updated", filterWhere: FILTER }),
    ).rejects.toThrow("clickhouse unavailable");
  });
});

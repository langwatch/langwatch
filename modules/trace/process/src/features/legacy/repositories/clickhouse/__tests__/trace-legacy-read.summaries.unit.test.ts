/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-summaries-list.feature
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import { traceSummaryRow } from "../../../../../repositories/clickhouse/__tests__/support/trace-summary-row.support.ts";
import { compileLangWatchQLTraceCondition } from "../../../../query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

const ORIGIN_FILTER = "trace.attribute.langwatch.origin.kind:ingestion_source";
const compileOrigin = () => compileLangWatchQLTraceCondition({ filter: ORIGIN_FILTER });

/** The store over a reader that answers each built read in turn and records what it was sent. */
function compose(answers: unknown[][]) {
  const read = vi.fn(async (_request: ReadRequest) => ({ rows: answers.shift() ?? [] }));
  const repository = TraceLegacyReadClickHouseRepository.create({
    reader: clickHouseQueryClientDouble({ read }),
  });
  const sent = () => read.mock.calls.map(([request]) => request.statement);
  return { repository, read, sent };
}

const window = { projectId: "project-1", startDate: 1_000, endDate: Date.now(), pageSize: 1 };

describe("TraceLegacyReadClickHouseRepository.findTraceSummaries", () => {
  /** @scenario "A summaries-only list reads bare summaries under the list's filter" */
  it("runs the filtered page statement, then the pruned summary read, and nothing else", async () => {
    const { repository, read, sent } = compose([
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
      compileFilter: compileOrigin,
    });

    expect(read).toHaveBeenCalledTimes(2);
    const [pageStatement, summaryStatement] = sent();
    // Both read the project alone on its single-tenant scope, as the reader.
    for (const statement of [pageStatement, summaryStatement]) {
      expect(statement).toMatchObject({
        kind: "tenant",
        identity: "reader",
        settings: { SQL_langwatch_tenant_ids: "project-1" },
      });
    }
    expect(pageStatement?.sql).not.toContain("ingestion_source");
    expect(pageStatement?.sql).not.toContain("count(");
    expect(Object.values(pageStatement?.params ?? {})).toEqual(
      expect.arrayContaining(["langwatch.origin.kind", "ingestion_source"]),
    );
    expect(summaryStatement?.sql).not.toContain("ComputedInput");
    expect(summaryStatement?.sql).not.toContain("ComputedOutput");
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
    const [idStatement] = next.sent();
    const seek =
      /toUnixTimestamp64Milli\(UpdatedAt\) > \{(\w+):Int64\} OR \(toUnixTimestamp64Milli\(UpdatedAt\) = \{(\w+):Int64\} AND TraceId > \{(\w+):String\}\)/.exec(
        idStatement?.sql ?? "",
      );
    expect(seek).not.toBeNull();
    expect(idStatement?.params[seek![1]!]).toBe(5000);
    expect(idStatement?.params[seek![3]!]).toBe("trace-1");
  });

  /** @scenario "A summaries-only list read that fails is refused, not answered empty" */
  it("fails the read when the store fails the page statement", async () => {
    const repository = TraceLegacyReadClickHouseRepository.create({
      reader: clickHouseQueryClientDouble({
        read: async () => {
          throw new Error("clickhouse unavailable");
        },
      }),
    });

    await expect(
      repository.findTraceSummaries(window, { dateField: "updated", compileFilter: compileOrigin }),
    ).rejects.toThrow("clickhouse unavailable");
  });

  /** @scenario "A summary read refuses free text it cannot narrow by" */
  it("refuses a free-text filter before it reads anything", async () => {
    const { repository, read } = compose([]);

    await expect(
      repository.findTraceSummaries(window, {
        compileFilter: () => compileLangWatchQLTraceCondition({ filter: "hello" }),
      }),
    ).rejects.toMatchObject({ code: "filter_value_refused" });
    expect(read).not.toHaveBeenCalled();
  });
});

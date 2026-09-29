/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-summaries-list.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#services/trace-canonicalisation.service";

import type { TraceClickHouseClient } from "../clickhouse.trace-member-client.repository.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";
import { traceSummaryRow } from "./support/trace-summary-row.support.ts";

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
    traceCanonicalisation: TraceCanonicalisationService.create(),
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

  /** @scenario "A summaries-only list read that fails is refused, not answered empty" */
  it("fails the read when the store fails the page statement", async () => {
    const query = vi.fn(async (_input: Statement) => {
      throw new Error("clickhouse unavailable");
    });
    const repository = new TraceLegacyReadClickHouseRepository({
      resolveClickHouseClient: async () => createApiFixture<TraceClickHouseClient>({ query }),
      traceCanonicalisation: TraceCanonicalisationService.create(),
    });

    await expect(
      repository.findTraceSummaries(window, { dateField: "updated", filterWhere: FILTER }),
    ).rejects.toThrow("clickhouse unavailable");
  });
});

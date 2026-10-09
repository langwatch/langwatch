/**
 * @vitest-environment node
 * @unit
 * The error text each listed row's evaluation summaries carry, inside and past the window.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { teaserOf } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import { listedRow } from "../../../../services/__tests__/support/trace-list-rows.support.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../../facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceListService } from "../trace-list-read.service.ts";

const TENANT = "tenant-1";
const CUTOFF_MS = 1_700_050_000_000;
const ERROR_TEXT = "e".repeat(300);

function summary({
  traceId,
  status,
  error,
}: {
  traceId: string;
  status: "error" | "processed";
  error: string | null;
}) {
  return {
    tenantId: TENANT,
    evaluationId: `eval_${traceId}_${status}`,
    evaluatorId: "monitor-1",
    evaluatorType: "test/evaluator",
    evaluatorName: "Test Evaluator",
    traceId,
    isGuardrail: false,
    status,
    score: null,
    passed: null,
    label: null,
    error,
  };
}

async function readPage() {
  const service = TraceListService.create({
    discoverUpdates: { publishProjectEvent: async () => {} },
    facets: CLICKHOUSE_FACET_CATALOG,
    repository: {
      listAll: vi.fn().mockResolvedValue({
        rows: [
          listedRow({ tenantId: TENANT, traceId: "trace_old", occurredAt: CUTOFF_MS - 1_000 }),
          listedRow({ tenantId: TENANT, traceId: "trace_new", occurredAt: CUTOFF_MS + 1_000 }),
        ],
        totalHits: 2,
      }),
    } as never,
    evaluationRuns: {
      findSummariesByTraceIds: vi
        .fn()
        .mockResolvedValue([
          summary({ traceId: "trace_old", status: "error", error: ERROR_TEXT }),
          summary({ traceId: "trace_new", status: "error", error: `  ${ERROR_TEXT}\n` }),
          summary({ traceId: "trace_new", status: "processed", error: "stale" }),
        ]),
    },
    topicNames: { findNamesByIds: vi.fn().mockResolvedValue(new Map()) },
  });
  const page = await service.getList({
    authorization: ownProof({ projectId: TENANT }),
    timeRange: { from: 1_700_000_000_000, to: 1_700_086_400_000 },
    sort: { columnId: "timestamp", direction: "desc" },
    pageSize: 50,
    visibilityCutoffMs: CUTOFF_MS,
  });
  const errorsOf = (traceId: string) =>
    page.items
      .find((item) => item.traceId === traceId)
      ?.evaluations.map((evaluation) => evaluation.error);
  return { errorsOf };
}

describe("TraceListService.getList evaluation error text", () => {
  describe("given an errored run on a trace past the visibility window", () => {
    /** @scenario "An errored run on a trace past the visibility window shows only a teaser of its error text" */
    it("carries only the teaser of its error text", async () => {
      const { errorsOf } = await readPage();

      expect(errorsOf("trace_old")).toEqual([teaserOf(ERROR_TEXT)]);
      expect(teaserOf(ERROR_TEXT)).not.toBe(ERROR_TEXT);
    });
  });

  describe("given runs on a trace inside the window", () => {
    it("carries an errored run's text trimmed and whole, and none for a run that did not error", async () => {
      const { errorsOf } = await readPage();

      expect(errorsOf("trace_new")).toEqual([ERROR_TEXT, null]);
    });
  });
});

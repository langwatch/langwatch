/**
 * @vitest-environment node
 * The trace list's evaluation summaries read back over the migrated ClickHouse, error text and all.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { SUMMARY_ERROR_TEXT_MAX_CHARS } from "../../../features/read/rules/evaluation-summary-error.rules.ts";
import { TraceListService } from "../../../features/read/services/trace-list-read.service.ts";
import { listedRow } from "../../../services/__tests__/support/trace-list-rows.support.ts";
import { ClickHouseTraceEvaluationRunsRepository } from "../trace-evaluation-runs.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const TENANT = `summary-error-${nanoid()}`;
const TRACE_ID = `trace-${nanoid()}`;
const PADDED_ERROR = "  \n free_budget_exhausted: spent \t ";
const LONG_ERROR = "y".repeat(5_000);

let ch: ClickHouseClient;
let list: TraceListService;
let NOW: number;

function evaluationRun({
  evaluationId,
  status,
  error,
}: {
  evaluationId: string;
  status: string;
  error: string | null;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: TENANT,
    EvaluationId: evaluationId,
    Version: "v1",
    EvaluatorId: `monitor-${evaluationId}`,
    EvaluatorType: "test/evaluator",
    EvaluatorName: "Test Evaluator",
    TraceId: TRACE_ID,
    IsGuardrail: 0,
    Status: status,
    Score: null,
    Passed: null,
    Label: null,
    Details: null,
    Error: error,
    ErrorDetails: null,
    LastProcessedEventId: `evt-${nanoid()}`,
    ScheduledAt: new Date(NOW),
    CreatedAt: new Date(NOW),
    UpdatedAt: new Date(NOW),
    LastEventOccurredAt: new Date(NOW),
  };
}

async function summaryErrorOf(evaluationId: string) {
  const page = await list.getList({
    authorization: ownProof({ projectId: TENANT, now: Date.now() }),
    timeRange: { from: NOW - 60 * 60 * 1000, to: NOW + 60 * 60 * 1000 },
    sort: { columnId: "timestamp", direction: "desc" },
    pageSize: 10,
  });
  return page.items[0]?.evaluations.find((summary) => summary.evaluationId === evaluationId)?.error;
}

describe.skipIf(!clickHouseConfigured)(
  "given a trace whose evaluation runs stored an error text",
  () => {
    beforeAll(async () => {
      ch = await startMigratedTraceClickHouse();
      NOW = Date.now() - 60 * 1000;
      list = TraceListService.create({
        discoverUpdates: { publishProjectEvent: async () => {} },
        facets: CLICKHOUSE_FACET_CATALOG,
        repository: {
          listAll: vi.fn().mockResolvedValue({
            rows: [listedRow({ tenantId: TENANT, traceId: TRACE_ID, occurredAt: NOW })],
            totalHits: 1,
          }),
        } as never,
        evaluationRuns: ClickHouseTraceEvaluationRunsRepository.create({
          resolveClient: async () => ch,
          clickhouse: authorizedClickHouseFor(ch),
        }),
        topicNames: { findNamesByIds: vi.fn().mockResolvedValue(new Map()) },
      });
      await ch.insert({
        table: "evaluation_runs",
        values: [
          evaluationRun({ evaluationId: "eval_errored", status: "error", error: PADDED_ERROR }),
          evaluationRun({ evaluationId: "eval_processed", status: "processed", error: "stale" }),
          evaluationRun({ evaluationId: "eval_skipped", status: "skipped", error: "stale" }),
          evaluationRun({ evaluationId: "eval_long", status: "error", error: LONG_ERROR }),
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
    }, 120_000);

    describe("when the trace list reads the trace's evaluation summaries", () => {
      /** @scenario "The trace list's evaluation summary carries the error text of an errored run only" */
      it("carries an errored run's error text without the surrounding whitespace", async () => {
        expect(await summaryErrorOf("eval_errored")).toBe("free_budget_exhausted: spent");
      });

      /** @scenario "The trace list's evaluation summary carries the error text of an errored run only" */
      it("carries no error text for a processed or skipped run", async () => {
        expect(await summaryErrorOf("eval_processed")).toBeNull();
        expect(await summaryErrorOf("eval_skipped")).toBeNull();
      });

      it("cuts a long error text short", async () => {
        expect(await summaryErrorOf("eval_long")).toBe(
          `${"y".repeat(SUMMARY_ERROR_TEXT_MAX_CHARS)}…`,
        );
      });
    });
  },
);

/**
 * `evaluator:X AND evaluatorVerdict:fail`, executed against `evaluation_runs`.
 *
 * Each evaluator field used to compile to its own trace-level subquery, so the
 * pair answered "X ran, and something failed". These fixtures put the failing
 * verdict on a different evaluator from the one named, which is the only shape
 * that tells the two readings apart.
 *
 * @see https://github.com/langwatch/tasks/issues/918
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { translateFilterToClickHouse } from "~/server/app-layer/traces/filter-to-clickhouse";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";

const tenantId = `test-eval-scope-${nanoid()}`;
const now = Date.now();
const WINDOW = { from: now - 60_000, to: now + 60_000 };

/** X passed, Y failed with a low score and a label. */
const X_PASSED_Y_FAILED = `trace-x-passed-y-failed-${nanoid()}`;
/** X failed with a low score. */
const X_FAILED = `trace-x-failed-${nanoid()}`;
/** X failed, Y passed. */
const X_FAILED_Y_PASSED = `trace-x-failed-y-passed-${nanoid()}`;

function traceRow(traceId: string) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    LastEventOccurredAt: new Date(now),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: null,
    ComputedOutput: null,
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: [],
    TraceName: "evaluated",
  };
}

function evaluationRow({
  traceId,
  evaluatorId,
  passed,
  score,
  label = null,
}: {
  traceId: string;
  evaluatorId: string;
  passed: 0 | 1;
  score: number;
  label?: string | null;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    EvaluationId: `eval-${nanoid()}`,
    Version: "v1",
    EvaluatorId: evaluatorId,
    EvaluatorType: "custom/test",
    EvaluatorName: evaluatorId,
    TraceId: traceId,
    IsGuardrail: 0,
    Status: "processed",
    Score: score,
    Passed: passed,
    Label: label,
    Details: null,
    Error: null,
    ErrorDetails: null,
    LastProcessedEventId: `evt-${nanoid()}`,
    ScheduledAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    LastEventOccurredAt: new Date(now),
  };
}

let ch: ClickHouseClient;

/** The trace ids a compiled filter selects, sorted. */
async function matching(filter: string): Promise<string[]> {
  const compiled = translateFilterToClickHouse(filter, tenantId, WINDOW);
  if (!compiled) throw new Error(`compiled to nothing: ${filter}`);
  const result = await ch.query({
    query: `SELECT DISTINCT TraceId FROM trace_summaries ts WHERE TenantId = {tenantId:String} AND ${compiled.sql}`,
    query_params: compiled.params,
    format: "JSONEachRow",
  });
  const rows = await result.json<{ TraceId: string }>();
  return rows.map((row) => row.TraceId).sort();
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;

  await ch.insert({
    table: "trace_summaries",
    values: [X_PASSED_Y_FAILED, X_FAILED, X_FAILED_Y_PASSED].map(traceRow),
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  await ch.insert({
    table: "evaluation_runs",
    values: [
      evaluationRow({
        traceId: X_PASSED_Y_FAILED,
        evaluatorId: "X",
        passed: 1,
        score: 0.9,
      }),
      evaluationRow({
        traceId: X_PASSED_Y_FAILED,
        evaluatorId: "Y",
        passed: 0,
        score: 0.1,
        label: "toxic",
      }),
      evaluationRow({
        traceId: X_FAILED,
        evaluatorId: "X",
        passed: 0,
        score: 0.1,
      }),
      evaluationRow({
        traceId: X_FAILED_Y_PASSED,
        evaluatorId: "X",
        passed: 0,
        score: 0.2,
      }),
      evaluationRow({
        traceId: X_FAILED_Y_PASSED,
        evaluatorId: "Y",
        passed: 1,
        score: 0.9,
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
}, 120_000);

afterAll(async () => {
  await stopTestContainers();
});

describe("a trace filter pairing an evaluator with its result", () => {
  describe("when the result belongs to another evaluator on the trace", () => {
    it.each([
      ["evaluator:X AND evaluatorVerdict:fail"],
      ["(evaluator:X AND evaluatorVerdict:fail)"],
      ["evaluator:X AND evaluatorScore:<0.5"],
    ])("leaves it out for %s", async (filter) => {
      expect(await matching(filter)).toEqual(
        [X_FAILED, X_FAILED_Y_PASSED].sort(),
      );
    });

    it("leaves it out for a label only the other evaluator emitted", async () => {
      expect(await matching("evaluator:X AND evaluatorLabel:toxic")).toEqual(
        [],
      );
    });
  });

  describe("when the result is excluded", () => {
    it("judges the named evaluator's verdict, not the trace's", async () => {
      expect(
        await matching("evaluator:X AND NOT evaluatorVerdict:pass"),
      ).toEqual([X_FAILED, X_FAILED_Y_PASSED].sort());
    });
  });

  describe("when no evaluator is named", () => {
    it("matches a result from any evaluator", async () => {
      expect(await matching("evaluatorVerdict:fail")).toEqual(
        [X_PASSED_Y_FAILED, X_FAILED, X_FAILED_Y_PASSED].sort(),
      );
    });
  });
});

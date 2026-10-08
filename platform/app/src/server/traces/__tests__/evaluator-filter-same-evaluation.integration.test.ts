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
/** Holds evaluations stored in more than one version, kept apart from the rest. */
const versionsTenantId = `test-eval-scope-versions-${nanoid()}`;
const now = Date.now();
const WINDOW = { from: now - 60_000, to: now + 60_000 };

/** X passed, Y failed with a low score and a label. */
const X_PASSED_Y_FAILED = `trace-x-passed-y-failed-${nanoid()}`;
/** X failed with a low score. */
const X_FAILED = `trace-x-failed-${nanoid()}`;
/** X failed, Y passed. */
const X_FAILED_Y_PASSED = `trace-x-failed-y-passed-${nanoid()}`;
/** X was scheduled, then failed; the scheduled version is not merged away. */
const X_SCHEDULED_THEN_FAILED = `trace-x-scheduled-then-failed-${nanoid()}`;
/** X ran twice: one run passed, the other failed. */
const X_RAN_TWICE = `trace-x-ran-twice-${nanoid()}`;

function traceRow(traceId: string, tenant = tenantId) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenant,
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
  tenant = tenantId,
  evaluationId = `eval-${nanoid()}`,
  status = "processed",
  updatedAt = new Date(now),
}: {
  traceId: string;
  evaluatorId: string;
  passed: 0 | 1 | null;
  score: number | null;
  label?: string | null;
  tenant?: string;
  evaluationId?: string;
  status?: string;
  updatedAt?: Date;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenant,
    EvaluationId: evaluationId,
    Version: "v1",
    EvaluatorId: evaluatorId,
    EvaluatorType: "custom/test",
    EvaluatorName: evaluatorId,
    TraceId: traceId,
    IsGuardrail: 0,
    Status: status,
    Score: score,
    Passed: passed,
    Label: label,
    Details: null,
    Error: null,
    ErrorDetails: null,
    LastProcessedEventId: `evt-${nanoid()}`,
    ScheduledAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: updatedAt,
    LastEventOccurredAt: new Date(now),
  };
}

let ch: ClickHouseClient;

/** The trace ids a compiled filter selects, sorted. */
async function matching(filter: string, tenant = tenantId): Promise<string[]> {
  const compiled = translateFilterToClickHouse(filter, tenant, WINDOW);
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
    values: [X_PASSED_Y_FAILED, X_FAILED, X_FAILED_Y_PASSED].map((traceId) =>
      traceRow(traceId),
    ),
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

  const xScheduled = `eval-${nanoid()}`;
  await ch.insert({
    table: "trace_summaries",
    values: [X_SCHEDULED_THEN_FAILED, X_RAN_TWICE].map((traceId) =>
      traceRow(traceId, versionsTenantId),
    ),
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  await ch.insert({
    table: "evaluation_runs",
    values: [
      evaluationRow({
        tenant: versionsTenantId,
        traceId: X_SCHEDULED_THEN_FAILED,
        evaluatorId: "X",
        evaluationId: xScheduled,
        status: "scheduled",
        passed: null,
        score: null,
        updatedAt: new Date(now - 1_000),
      }),
      evaluationRow({
        tenant: versionsTenantId,
        traceId: X_SCHEDULED_THEN_FAILED,
        evaluatorId: "X",
        evaluationId: xScheduled,
        passed: 0,
        score: 0.1,
      }),
      evaluationRow({
        tenant: versionsTenantId,
        traceId: X_RAN_TWICE,
        evaluatorId: "X",
        passed: 1,
        score: 0.9,
      }),
      evaluationRow({
        tenant: versionsTenantId,
        traceId: X_RAN_TWICE,
        evaluatorId: "X",
        passed: 0,
        score: 0.1,
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

  describe("when an evaluation is stored in an older version too", () => {
    it("judges it by its latest version only", async () => {
      expect(
        await matching(
          "evaluator:X AND evaluatorStatus:scheduled",
          versionsTenantId,
        ),
      ).toEqual([]);
      expect(
        await matching(
          "evaluator:X AND NOT evaluatorVerdict:fail",
          versionsTenantId,
        ),
      ).toEqual([]);
    });
  });

  describe("when the evaluator ran more than once", () => {
    it("matches a kept result held by any run", async () => {
      expect(
        await matching(
          "evaluator:X AND evaluatorVerdict:pass",
          versionsTenantId,
        ),
      ).toEqual([X_RAN_TWICE]);
    });

    it("matches a run holding either of two picked verdicts", async () => {
      expect(
        await matching(
          "(evaluator:X AND evaluatorVerdict:pass AND evaluatorVerdict:fail)",
          versionsTenantId,
        ),
      ).toEqual([X_RAN_TWICE, X_SCHEDULED_THEN_FAILED].sort());
    });

    it("needs one run to hold a verdict and a score together", async () => {
      expect(
        await matching(
          "(evaluator:X AND evaluatorVerdict:fail AND evaluatorScore:[0.5 TO 1])",
          versionsTenantId,
        ),
      ).toEqual([]);
      expect(
        await matching(
          "(evaluator:X AND evaluatorVerdict:fail AND evaluatorScore:[0 TO 0.5])",
          versionsTenantId,
        ),
      ).toEqual([X_RAN_TWICE, X_SCHEDULED_THEN_FAILED].sort());
    });

    it("drops the trace when any run holds an excluded result", async () => {
      expect(
        await matching(
          "evaluator:X AND NOT evaluatorVerdict:fail",
          versionsTenantId,
        ),
      ).not.toContain(X_RAN_TWICE);
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

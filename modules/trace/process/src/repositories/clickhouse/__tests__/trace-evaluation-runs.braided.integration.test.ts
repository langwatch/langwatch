/**
 * Evaluations are not shared through a braid (ADR-183 §6), against production schema: the
 * reader's evaluation reads of a trace holding braided spans return the reader's own runs, never
 * the owner's. Spec: modules/trace/specs/braided-spans.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { CompiledWhere } from "@langwatch/authorization";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { braidedProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { ClickHouseTraceEvaluationRunsRepository } from "../trace-evaluation-runs.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const run = nanoid();
const reader = `test-braid-eval-reader-${run}`;
const owner = `test-braid-eval-owner-${run}`;
const traceId = `trace-${run}`;
const at = Date.now() - 60 * 60 * 1000;
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

let ch: ClickHouseClient;
let repo: ClickHouseTraceEvaluationRunsRepository;

function evaluationRun({ tenantId }: { tenantId: string }) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    EvaluationId: `eval-${tenantId}`,
    Version: "v1",
    EvaluatorId: `monitor-of-${tenantId}`,
    EvaluatorType: "test/evaluator",
    EvaluatorName: `monitor-of-${tenantId}`,
    TraceId: traceId,
    IsGuardrail: 0,
    Status: "processed",
    Score: 1,
    Passed: 1,
    Label: null,
    Details: null,
    Error: null,
    ErrorDetails: null,
    LastProcessedEventId: `evt-${nanoid()}`,
    ScheduledAt: new Date(at),
    CreatedAt: new Date(at),
    UpdatedAt: new Date(at),
    LastEventOccurredAt: new Date(at),
  };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = ClickHouseTraceEvaluationRunsRepository.create({
    resolveClient: async () => ch,
    clickhouse: authorizedClickHouseFor(ch),
  });
  await ch.insert({
    table: "evaluation_runs",
    values: [evaluationRun({ tenantId: reader }), evaluationRun({ tenantId: owner })],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  await ch.exec({
    query: "ALTER TABLE evaluation_runs DELETE WHERE TenantId IN ({reader:String}, {owner:String})",
    query_params: { reader, owner },
  });
});

describe.skipIf(!clickHouseConfigured)("evaluations of a trace holding braided spans", () => {
  describe("when the owner's monitor scored a span braided into the reader's trace", () => {
    /** @scenario "The owner's evaluation results are not shown on braided spans" */
    it("reads the reader's own evaluations of the trace and none of the owner's", async () => {
      const authorization = braidedProof({
        projectId: reader,
        braids: [{ owner, compiledWhere: WEB }],
      });

      const runs = await repo.findReadableRunsByTraceId({ authorization, traceId });
      const byTrace = await repo.findReadableTraceEvaluations({
        authorization,
        traceIds: [traceId],
      });

      expect(runs.map((evaluation) => evaluation.evaluatorId)).toEqual([`monitor-of-${reader}`]);
      expect(byTrace[traceId]?.map((evaluation) => evaluation.evaluatorId)).toEqual([
        `monitor-of-${reader}`,
      ]);
    });
  });
});

/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { EvaluationApi, type EvaluationRunData } from "@langwatch/evaluation-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { evaluationServer } from "../../evaluation.server.ts";
import { LiveEvaluationRepositories } from "../../repositories/live/live.evaluation.repositories.ts";

const TENANT = "project-1";
const TRACE = "trace-1";

function run(overrides: Partial<EvaluationRunData> = {}): EvaluationRunData {
  return {
    evaluationId: "evaluation-1",
    evaluatorId: "evaluator-1",
    evaluatorType: "langevals/exact_match",
    evaluatorName: "Exact match",
    traceId: TRACE,
    isGuardrail: false,
    status: "processed",
    score: 1,
    passed: true,
    label: null,
    details: null,
    inputs: { output: "hello" },
    error: null,
    errorDetails: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
    LastEventOccurredAt: 1_700_000_000_100,
    archivedAt: null,
    scheduledAt: 1_700_000_000_000,
    startedAt: 1_700_000_000_010,
    completedAt: 1_700_000_000_090,
    costId: null,
    ...overrides,
  };
}

describe("given a process that installs the evaluation module over its repositories", () => {
  describe("when a run is upserted for a trace", () => {
    /** @scenario "An installed evaluation module reads back the runs it wrote" */
    it("reads the run back by id, by trace and among the trace's evaluations", async () => {
      const runtime = await createApp({ role: "worker" })
        .withModules([withMemoryRepositories(evaluationServer)])
        .provide({
          workflow: createApiFixture<WorkflowApi>(),
          trace: createApiFixture<TraceApi>(),
          "model-provider": createApiFixture<ModelProviderApi>(),
        })
        .boot();

      try {
        const app = runtime.service(EvaluationApi);
        await app.upsertRun({ tenantId: TENANT, data: run({ status: "scheduled", updatedAt: 1 }) });
        await app.upsertRun({ tenantId: TENANT, data: run() });

        await expect(
          app.getRunByEvaluationId({ tenantId: TENANT, evaluationId: "evaluation-1" }),
        ).resolves.toEqual(run());
        await expect(app.findRunsByTraceId({ tenantId: TENANT, traceId: TRACE })).resolves.toEqual([
          run(),
        ]);
        const evaluations = await app.findTraceEvaluations({ tenantId: TENANT, traceIds: [TRACE] });
        expect(evaluations[TRACE]).toMatchObject([
          { evaluationId: "evaluation-1", status: "processed", inputs: { output: "hello" } },
        ]);
        await expect(
          app.getRunByEvaluationId({ tenantId: "project-2", evaluationId: "evaluation-1" }),
        ).rejects.toMatchObject({ code: "evaluation_not_found" });
      } finally {
        await runtime.stop();
      }
    });
  });
});

describe("given the live evaluation repositories over the process's ClickHouse member", () => {
  describe("when a run is looked up for a tenant", () => {
    /** @scenario "The live tier reads run history through the process's routing ClickHouse" */
    it("names the tenant on every statement and passes only the member's settings", async () => {
      const statements: { tenantId: string; settings?: Record<string, string | number> }[] = [];
      const clickhouse = createApiFixture<ProcessMembers["clickhouse"]>({
        query: async (request) => {
          statements.push({ tenantId: request.tenantId, settings: request.settings });
          return { rows: [] };
        },
      });
      const repositories = LiveEvaluationRepositories.create({
        prisma: createApiFixture<ProcessMembers["prisma"]>(),
        clickhouse,
      });

      await expect(
        repositories.runs.findByTraceId({ tenantId: TENANT, traceId: TRACE }),
      ).resolves.toEqual([]);
      await expect(
        repositories.runs.getByEvaluationId({
          tenantId: TENANT,
          evaluationId: "evaluation-1",
          retentionFloor: { getFloorMs: async () => 0 },
        }),
      ).rejects.toMatchObject({ code: "evaluation_not_found" });

      expect(statements.length).toBeGreaterThan(1);
      expect(statements.every((statement) => statement.tenantId === TENANT)).toBe(true);
    });
  });
});

/**
 * The dispatch-time re-check over real ClickHouse: an automation whose
 * condition reads an evaluation verdict is confirmed only when the evaluation
 * read actually returns the trace's runs.
 *
 * @see specs/automations/process-manager-dispatch.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TriggerAction, TriggerKind } from "~/generated/prisma/client";
import { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import { EvaluationRunClickHouseRepository } from "~/server/app-layer/evaluations/repositories/evaluation-run.clickhouse.repository";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import type { TriggerSummary } from "../../repositories/trigger.repository";
import {
  type ConfirmSettledMatchDeps,
  confirmSettledMatch,
} from "../confirmSettledMatch";

const projectId = `test-confirm-settled-${nanoid()}`;
const traceId = `trace-${nanoid()}`;
const failingMonitor = "monitor-failing";
const passingMonitor = "monitor-passing";
const rewrittenMonitor = "monitor-rewritten";
const now = Date.now() - 60 * 1000;

let ch: ClickHouseClient;
let deps: ConfirmSettledMatchDeps;

function evaluationRun(
  overrides: Partial<EvaluationRunData>,
): EvaluationRunData {
  return {
    evaluationId: `eval-${nanoid()}`,
    evaluatorId: failingMonitor,
    evaluatorType: "test/evaluator",
    evaluatorName: "Test Evaluator",
    traceId,
    isGuardrail: false,
    status: "processed",
    score: 0,
    passed: false,
    label: null,
    details: "",
    inputs: null,
    error: null,
    errorDetails: null,
    createdAt: now,
    updatedAt: now,
    LastEventOccurredAt: now,
    archivedAt: null,
    scheduledAt: now,
    startedAt: now,
    completedAt: now,
    costId: null,
    ...overrides,
  };
}

function automation(overrides: Partial<TriggerSummary>): TriggerSummary {
  return {
    id: "trigger_1",
    projectId,
    name: "Automation",
    action: TriggerAction.ADD_TO_DATASET,
    triggerKind: TriggerKind.AUTOMATION,
    actionParams: {},
    filters: {},
    filterQuery: null,
    alertType: null,
    message: null,
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 30_000,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
    ...overrides,
  };
}

const foldState: TraceSummaryData = {
  traceId,
  traceName: "",
  spanCount: 1,
  totalDurationMs: 100,
  computedIOSchemaVersion: "2025-12-18",
  computedInput: "hello",
  computedOutput: "world",
  timeToFirstTokenMs: null,
  timeToLastTokenMs: null,
  tokensPerSecond: null,
  containsErrorStatus: false,
  containsOKStatus: true,
  errorMessage: null,
  models: [],
  totalCost: null,
  nonBilledCost: null,
  tokensEstimated: false,
  totalPromptTokenCount: null,
  totalCompletionTokenCount: null,
  outputFromRootSpan: false,
  outputSpanEndTimeMs: 0,
  blockedByGuardrail: false,
  rootSpanType: null,
  containsAi: false,
  topicId: null,
  subTopicId: null,
  annotationIds: [],
  containsPrompt: false,
  selectedPromptId: null,
  selectedPromptSpanId: null,
  selectedPromptStartTimeMs: null,
  lastUsedPromptId: null,
  lastUsedPromptVersionNumber: null,
  lastUsedPromptVersionId: null,
  lastUsedPromptSpanId: null,
  lastUsedPromptStartTimeMs: null,
  LastEventOccurredAt: 0,
  occurredAt: now,
  createdAt: now,
  updatedAt: now,
  attributes: {},
};

const confirm = (trigger: TriggerSummary, onTrace = traceId) =>
  confirmSettledMatch({
    deps,
    trigger,
    projectId,
    traceId: onTrace,
    foldState: { ...foldState, traceId: onTrace },
  });

beforeAll(async () => {
  const client = getTestClickHouseClient();
  if (!client) throw new Error("ClickHouse test container not available");
  ch = client;
  const repository = new EvaluationRunClickHouseRepository({
    resolveClient: async () => ch,
  });
  deps = {
    evaluationRuns: new EvaluationRunService(repository),
    deriveEvents: async () => [],
  };
  await repository.upsert(
    evaluationRun({ evaluatorId: failingMonitor, passed: false }),
    projectId,
  );
  await repository.upsert(
    evaluationRun({ evaluatorId: passingMonitor, passed: true, score: 1 }),
    projectId,
  );
  // One evaluation rewritten in place: failed first, passed on the rerun.
  const rewritten = `eval-${nanoid()}`;
  await repository.upsert(
    evaluationRun({
      evaluationId: rewritten,
      evaluatorId: rewrittenMonitor,
      passed: false,
    }),
    projectId,
  );
  await repository.upsert(
    evaluationRun({
      evaluationId: rewritten,
      evaluatorId: rewrittenMonitor,
      passed: true,
      score: 1,
      updatedAt: now + 1000,
    }),
    projectId,
  );
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query:
        "ALTER TABLE evaluation_runs DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: projectId },
    });
  }
});

describe("confirmSettledMatch over stored evaluation runs (integration)", () => {
  describe("given an automation whose filters read an evaluation verdict", () => {
    describe("when the trace holds the verdict the filter asks for", () => {
      /** @scenario "An evaluation-filtered automation is confirmed at dispatch" */
      it("confirms the match", async () => {
        const trigger = automation({
          filters: { "evaluations.passed": { [failingMonitor]: ["false"] } },
        });

        expect(await confirm(trigger)).toBe(true);
      });

      /** @scenario "An evaluation-filtered automation is confirmed at dispatch" */
      it("confirms a filter that only names the evaluator", async () => {
        const trigger = automation({
          filters: { "evaluations.evaluator_id": [passingMonitor] },
        });

        expect(await confirm(trigger)).toBe(true);
      });
    });

    describe("when the trace holds the opposite verdict", () => {
      /** @scenario "An evaluation-filtered automation is confirmed at dispatch" */
      it("does not confirm the match", async () => {
        const trigger = automation({
          filters: { "evaluations.passed": { [passingMonitor]: ["false"] } },
        });

        expect(await confirm(trigger)).toBe(false);
      });
    });
  });

  describe("given an evaluation that was rewritten with the opposite verdict", () => {
    describe("when the filter asks for the later verdict", () => {
      /** @scenario "An evaluation-filtered automation is confirmed at dispatch" */
      it("confirms the match", async () => {
        const trigger = automation({
          filters: { "evaluations.passed": { [rewrittenMonitor]: ["true"] } },
        });

        expect(await confirm(trigger)).toBe(true);
      });
    });

    describe("when the filter asks for the earlier verdict", () => {
      /** @scenario "An evaluation-filtered automation is confirmed at dispatch" */
      it("does not confirm the match", async () => {
        const trigger = automation({
          filters: { "evaluations.passed": { [rewrittenMonitor]: ["false"] } },
        });

        expect(await confirm(trigger)).toBe(false);
      });
    });
  });

  describe("given an automation whose query reads evaluations", () => {
    describe("when the trace has evaluation runs", () => {
      /** @scenario "An evaluation-filtered automation is confirmed at dispatch" */
      it("confirms has:eval", async () => {
        expect(await confirm(automation({ filterQuery: "has:eval" }))).toBe(
          true,
        );
      });
    });

    describe("when the trace has no evaluation runs", () => {
      it("does not confirm has:eval", async () => {
        const trigger = automation({ filterQuery: "has:eval" });

        expect(await confirm(trigger, `trace-none-${nanoid()}`)).toBe(false);
      });
    });
  });
});

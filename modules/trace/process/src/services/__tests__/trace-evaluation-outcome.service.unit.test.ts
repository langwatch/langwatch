/** Spec: specs/trace/trace-evaluation-analytics.feature */
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import {
  EVALUATION_OUTCOME_TEXT_MAX_LENGTH,
  type RecordEvaluationOutcomeCommandData,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ownProofAuthorizer } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { MemoryTraceEvaluationRunsChannel } from "../../channels/memory/memory.trace-evaluation-runs.channel.ts";
import { createTestRuntime } from "../../eventing/__tests__/trace-summary-test.fixtures.ts";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TraceAnalyticsFoldProjection,
} from "../../eventing/trace-derived.projection.ts";
import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { MemoryTraceAnalyticsRepository } from "../../repositories/memory/memory.trace-analytics-projection.repository.ts";
import {
  EVALUATED_TRACE_WAIT_MS,
  EVALUATION_CLOCK_SKEW_MS,
  LIVE_ROW_LOOKBACK_MS,
} from "../../rules/trace-evaluation-analytics.rules.ts";
import { TraceAnchorService } from "../trace-anchor.service.ts";
import {
  EvaluatedTraceNotYetStoredError,
  TraceEvaluationOutcomeService,
} from "../trace-evaluation-outcome.service.ts";
import { TraceEvaluationOutcomesMigrationService } from "../trace-evaluation-outcomes-migration.service.ts";

const TENANT = "tenant-outcomes";
const TRACE_ID = "trace-outcomes";
const TRACE_ANCHOR_MS = 1_760_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const EVALUATED_AT = TRACE_ANCHOR_MS + 3 * DAY_MS;

const projection = TraceAnalyticsFoldProjection.create({
  store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime: createTestRuntime(),
});

function run(over: Partial<EvaluationRunData> = {}): EvaluationRunData {
  return {
    evaluationId: "evaluation-1",
    evaluatorId: "evaluator-1",
    evaluatorType: "langevals/faithfulness",
    evaluatorName: "Faithfulness",
    traceId: TRACE_ID,
    isGuardrail: true,
    status: "processed",
    score: 1,
    passed: true,
    label: null,
    details: null,
    inputs: null,
    error: null,
    errorDetails: null,
    createdAt: EVALUATED_AT,
    updatedAt: EVALUATED_AT,
    LastEventOccurredAt: EVALUATED_AT,
    archivedAt: null,
    scheduledAt: EVALUATED_AT,
    startedAt: EVALUATED_AT,
    completedAt: EVALUATED_AT,
    costId: null,
    ...over,
  };
}

/** A stored trace, evaluation's runs as scripted, and every outcome the service records. */
async function compose({ now }: { now?: () => number } = {}) {
  const traces = MemoryTraceAnalyticsRepository.create();
  await traces.upsert({
    row: TraceAnalyticsFoldProjection.projectAnalyticsStateToRow({
      state: {
        ...projection.init(),
        traceId: TRACE_ID,
        spanCount: 1,
        storageAnchorMs: TRACE_ANCHOR_MS,
        occurredAt: TRACE_ANCHOR_MS,
        createdAt: TRACE_ANCHOR_MS,
      },
      tenantId: TENANT,
      version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
    }),
    retentionDays: 90,
    appliedEventIds: [],
  });
  const evaluations = MemoryTraceEvaluationRunsChannel.create();
  const recorded: RecordEvaluationOutcomeCommandData[] = [];
  const logger = { warn: vi.fn() };
  const anchors = TraceAnchorService.create({ traces, authorize: ownProofAuthorizer });
  const outcomes = TraceEvaluationOutcomeService.create({
    evaluations,
    anchors,
    commands: { recordEvaluationOutcome: async (data) => void recorded.push(data) },
    logger,
    ...(now ? { now } : {}),
  });
  return { evaluations, recorded, outcomes, anchors, logger };
}

const event = (eventId: string) => ({
  tenantId: TENANT,
  aggregateId: "evaluation-1",
  occurredAt: EVALUATED_AT,
  createdAt: EVALUATED_AT,
  eventId,
});

describe("TraceEvaluationOutcomeService", () => {
  describe("given a stored trace and a reported evaluation of it", () => {
    /** @scenario "An evaluation's outcome is recorded on its trace" */
    it("records the outcome on the trace, stamped with the trace's OccurredAt", async () => {
      const { outcomes, recorded } = await compose();

      await outcomes.recordReported({
        data: {
          evaluationId: "evaluation-1",
          evaluatorName: "Toxicity",
          traceId: TRACE_ID,
          isGuardrail: false,
          status: "error",
          passed: true,
          label: "toxic",
        },
        context: event("evaluation-event-9"),
      });

      expect(recorded).toEqual([
        {
          tenantId: TENANT,
          traceId: TRACE_ID,
          occurredAt: TRACE_ANCHOR_MS,
          idempotencyKey: `${TENANT}:${TRACE_ID}:evaluation-outcome:evaluation-event-9`,
          evaluationId: "evaluation-1",
          evaluatorName: "Toxicity",
          isGuardrail: false,
          status: "error",
          // An errored run's verdict never reaches analytics.
          passed: null,
          label: "toxic",
          evaluationOccurredAt: EVALUATED_AT,
          sourceEventId: "evaluation-event-9",
        },
      ]);
    });
  });

  describe("given an evaluation run on a stored trace that has just completed", () => {
    /** @scenario "A completed evaluation takes its identity from evaluation's run" */
    it("takes the evaluator name and guardrail flag from the run", async () => {
      const { outcomes, recorded, evaluations } = await compose();
      evaluations.runs.set(`${TENANT}:evaluation-1`, run());

      await outcomes.recordCompleted({
        data: { evaluationId: "evaluation-1", status: "processed", passed: false, label: null },
        context: event("evaluation-event-3"),
      });

      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        evaluatorName: "Faithfulness",
        isGuardrail: true,
        passed: false,
        occurredAt: TRACE_ANCHOR_MS,
      });
    });
  });

  describe("given a reported evaluation with an outsized name and label and a clock far ahead", () => {
    const reported = (occurredAt: number) => ({
      data: {
        evaluationId: "evaluation-1",
        evaluatorName: "n".repeat(EVALUATION_OUTCOME_TEXT_MAX_LENGTH + 50),
        traceId: TRACE_ID,
        isGuardrail: false,
        status: "processed" as const,
        passed: true,
        label: "l".repeat(EVALUATION_OUTCOME_TEXT_MAX_LENGTH + 1),
      },
      context: { ...event("evaluation-event-5"), occurredAt },
    });

    /** @scenario "An outsized evaluator name and label are truncated" */
    it("truncates the name and label to the contract's maximum", async () => {
      const { outcomes, recorded } = await compose({ now: () => EVALUATED_AT });

      await outcomes.recordReported(reported(EVALUATED_AT));

      expect(recorded[0]?.evaluatorName).toHaveLength(EVALUATION_OUTCOME_TEXT_MAX_LENGTH);
      expect(recorded[0]?.label).toHaveLength(EVALUATION_OUTCOME_TEXT_MAX_LENGTH);
      expect(recorded[0]?.label?.endsWith("\u2026")).toBe(true);
    });

    /** @scenario "An evaluation time far from its trace is clamped" */
    it("clamps an evaluation time past now plus the clock skew to that bound", async () => {
      const { outcomes, recorded } = await compose({ now: () => EVALUATED_AT });

      await outcomes.recordReported(reported(EVALUATED_AT + 365 * DAY_MS));

      expect(recorded[0]?.evaluationOccurredAt).toBe(EVALUATED_AT + EVALUATION_CLOCK_SKEW_MS);
    });

    /** @scenario "An evaluation time far from its trace is clamped" */
    it("clamps an evaluation time far before its trace to the live-row lookback", async () => {
      const { outcomes, recorded } = await compose({ now: () => EVALUATED_AT });

      await outcomes.recordReported(reported(TRACE_ANCHOR_MS - 10 * DAY_MS));

      expect(recorded[0]?.evaluationOccurredAt).toBe(TRACE_ANCHOR_MS - LIVE_ROW_LOOKBACK_MS);
    });
  });

  describe("given an evaluation whose trace is not stored", () => {
    const unstored = {
      data: {
        evaluationId: "evaluation-2",
        evaluatorName: "Toxicity",
        traceId: "trace-never-stored",
        isGuardrail: false,
        status: "processed" as const,
        passed: true,
        label: null,
      },
      context: event("evaluation-event-4"),
    };

    describe("when it was appended within the wait", () => {
      /** @scenario "An evaluation of a trace not stored yet is retried within the wait" */
      it("records nothing and fails the delivery so the queue retries it", async () => {
        const { outcomes, recorded, logger } = await compose({
          now: () => EVALUATED_AT + EVALUATED_TRACE_WAIT_MS,
        });

        await expect(outcomes.recordReported(unstored)).rejects.toThrow(
          EvaluatedTraceNotYetStoredError,
        );

        expect(recorded).toEqual([]);
        expect(logger.warn).not.toHaveBeenCalled();
      });
    });

    describe("when it was appended longer ago than the wait", () => {
      /** @scenario "An evaluation of a trace still not stored after the wait records nothing" */
      it("records nothing and says so", async () => {
        const { outcomes, recorded, logger } = await compose({
          now: () => EVALUATED_AT + EVALUATED_TRACE_WAIT_MS + 1,
        });

        await outcomes.recordReported(unstored);

        expect(recorded).toEqual([]);
        expect(logger.warn).toHaveBeenCalledTimes(1);
      });
    });
  });
});

describe("TraceEvaluationOutcomesMigrationService", () => {
  describe("given a project with finished evaluations on stored traces", () => {
    /** @scenario "The backfill records each recent outcome on its trace once" */
    it("sends each outcome once, keyed by its evaluation id and stamped with its trace's OccurredAt", async () => {
      const { evaluations, anchors } = await compose();
      const sent: RecordEvaluationOutcomeCommandData[] = [];
      for (const evaluationId of ["evaluation-a", "evaluation-b"]) {
        evaluations.outcomes.push({
          tenantId: TENANT,
          evaluationId,
          traceId: TRACE_ID,
          evaluatorName: "Faithfulness",
          isGuardrail: false,
          status: "processed",
          passed: true,
          label: null,
          occurredAt: EVALUATED_AT,
          lastEventId: `last-${evaluationId}`,
        });
      }
      const backfill = TraceEvaluationOutcomesMigrationService.create({
        projects: {
          listAllWithOrganization: async () => ({
            projects: [{ id: TENANT, organizationId: "organization-1" }],
            orphanIds: [],
            next: null,
          }),
        },
        evaluations,
        anchors,
        commands: { recordEvaluationOutcomes: async (data) => void sent.push(...data) },
        now: () => EVALUATED_AT + 60_000,
      });

      const report = await backfill.recordEvaluationOutcomes({
        resumeFrom: null,
        dryRun: false,
        signal: new AbortController().signal,
        onPage: async () => {},
      });

      expect(
        sent.map(({ idempotencyKey, occurredAt, sourceEventId }) => ({
          idempotencyKey,
          occurredAt,
          sourceEventId,
        })),
      ).toEqual([
        {
          idempotencyKey: `${TENANT}:${TRACE_ID}:evaluation-outcome:backfill:evaluation-a`,
          occurredAt: TRACE_ANCHOR_MS,
          sourceEventId: "last-evaluation-a",
        },
        {
          idempotencyKey: `${TENANT}:${TRACE_ID}:evaluation-outcome:backfill:evaluation-b`,
          occurredAt: TRACE_ANCHOR_MS,
          sourceEventId: "last-evaluation-b",
        },
      ]);
      expect(report).toMatchObject({ projects: 1, outcomes: 2, skippedWithoutTrace: 0 });
    });
  });
});

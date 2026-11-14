import {
  deriveVerdictPassed,
  type EvaluationCompletedEventData,
  type EvaluationReportedEventData,
} from "@langwatch/evaluation-contract";
import { nowInstant } from "@langwatch/time";
import type { RecordEvaluationOutcomeCommandData } from "@langwatch/trace-contract";

import type { TraceEvaluationRuns } from "../channels/trace-evaluation-runs.channel.ts";
import {
  boundedOutcomeCommand,
  EVALUATED_TRACE_WAIT_MS,
} from "../rules/trace-evaluation-analytics.rules.ts";
import type { TraceAnchorService } from "./trace-anchor.service.ts";
import type { TraceProcessingCommandsService } from "./trace-processing-commands.service.ts";

/** The evaluation event a peer subscriber is handed: its tenant, aggregate, instants and id. */
export interface EvaluationEventContext {
  tenantId: string;
  aggregateId: string;
  occurredAt: number;
  /** When evaluation appended the event, by our clock: what the wait for its trace counts from. */
  createdAt: number;
  eventId: string;
}

/** An outcome on its way to its trace, before the trace's OccurredAt is known. */
export type PendingEvaluationOutcome = Omit<
  RecordEvaluationOutcomeCommandData,
  "tenantId" | "occurredAt" | "idempotencyKey"
>;

/** A run the COMPLETED event names that evaluation has not written yet; the delivery retries. */
export class EvaluationRunNotYetReadableError extends Error {
  constructor(evaluationId: string) {
    super(`evaluation run ${evaluationId} is not readable yet; its outcome is retried`);
    this.name = "EvaluationRunNotYetReadableError";
  }
}

/** A trace an evaluation names that trace analytics has not stored yet; the delivery retries. */
export class EvaluatedTraceNotYetStoredError extends Error {
  constructor(traceId: string) {
    super(`trace ${traceId} is not stored yet; its evaluation outcome is retried`);
    this.name = "EvaluatedTraceNotYetStoredError";
  }
}

type TraceEvaluationOutcomeDependencies = Readonly<{
  evaluations: Pick<TraceEvaluationRuns, "findRunByEvaluationId">;
  anchors: Pick<TraceAnchorService, "traceAnchors">;
  commands: Pick<TraceProcessingCommandsService, "recordEvaluationOutcome">;
  logger: Readonly<{ warn(payload: Readonly<Record<string, unknown>>, message: string): void }>;
  /** The clock an evaluation's time is bounded by, injected for test determinism. */
  now?: () => number;
}>;

/**
 * Records an evaluation's outcome on its trace from evaluation's COMPLETED and REPORTED events,
 * stamped with the trace's OccurredAt so the trace fold reads it back (trace ADR-003).
 * Spec: specs/trace/trace-evaluation-analytics.feature
 */
export class TraceEvaluationOutcomeService {
  private readonly now: () => number;

  private constructor(private readonly deps: TraceEvaluationOutcomeDependencies) {
    this.now = deps.now ?? (() => nowInstant().epochMilliseconds);
  }

  static create(deps: TraceEvaluationOutcomeDependencies): TraceEvaluationOutcomeService {
    return new TraceEvaluationOutcomeService(deps);
  }

  /** COMPLETED carries the outcome only: identity comes from evaluation's run. */
  async recordCompleted({
    data,
    context,
  }: {
    data: Pick<EvaluationCompletedEventData, "evaluationId" | "status" | "passed" | "label">;
    context: EvaluationEventContext;
  }): Promise<void> {
    const run = await this.deps.evaluations.findRunByEvaluationId({
      tenantId: context.tenantId,
      evaluationId: data.evaluationId,
    });
    if (!run) throw new EvaluationRunNotYetReadableError(data.evaluationId);
    if (!run.traceId) return;
    await this.recordFromEvent({
      context,
      traceId: run.traceId,
      outcome: {
        evaluationId: data.evaluationId,
        evaluatorName: run.evaluatorName,
        isGuardrail: run.isGuardrail,
        status: data.status,
        passed: deriveVerdictPassed(data),
        label: data.label ?? null,
      },
    });
  }

  /** REPORTED carries identity and outcome together. */
  async recordReported({
    data,
    context,
  }: {
    data: Pick<
      EvaluationReportedEventData,
      "evaluationId" | "evaluatorName" | "traceId" | "isGuardrail" | "status" | "passed" | "label"
    >;
    context: EvaluationEventContext;
  }): Promise<void> {
    if (!data.traceId) return;
    await this.recordFromEvent({
      context,
      traceId: data.traceId,
      outcome: {
        evaluationId: data.evaluationId,
        evaluatorName: data.evaluatorName ?? null,
        isGuardrail: data.isGuardrail ?? false,
        status: data.status,
        passed: deriveVerdictPassed(data),
        label: data.label ?? null,
      },
    });
  }

  private async recordFromEvent({
    context,
    traceId,
    outcome,
  }: {
    context: EvaluationEventContext;
    traceId: string;
    outcome: Omit<PendingEvaluationOutcome, "traceId" | "evaluationOccurredAt" | "sourceEventId">;
  }): Promise<void> {
    const anchors = await this.deps.anchors.traceAnchors({
      tenantId: context.tenantId,
      traces: [{ traceId, nearMs: context.occurredAt }],
      purpose: { kind: "event", eventId: context.eventId },
    });
    const occurredAt = anchors.get(traceId);
    const nowMs = this.now();
    if (occurredAt === undefined) {
      // Main joined at read time, so a late trace still matched: wait for it while it may come.
      if (nowMs - context.createdAt <= EVALUATED_TRACE_WAIT_MS) {
        throw new EvaluatedTraceNotYetStoredError(traceId);
      }
      this.deps.logger.warn(
        { tenantId: context.tenantId, traceId, evaluationId: outcome.evaluationId },
        "skipped an evaluation outcome whose trace was not stored within the wait",
      );
      return;
    }
    await this.deps.commands.recordEvaluationOutcome(
      boundedOutcomeCommand({
        command: {
          ...outcome,
          tenantId: context.tenantId,
          traceId,
          occurredAt,
          evaluationOccurredAt: context.occurredAt,
          sourceEventId: context.eventId,
          idempotencyKey: `${context.tenantId}:${traceId}:evaluation-outcome:${context.eventId}`,
        },
        nowMs,
      }),
    );
  }
}

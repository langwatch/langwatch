import { createHash } from "node:crypto";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { EvaluatorResultData, TargetResultData } from "./schema";
import type { ExperimentRunItemsRow } from "./table";

/** One item row per result event, minus the columns the store's own `toRow`
 * stamps: the tenant, the `ProjectionId` derived from it, and the bookkeeping. */
export type ExperimentRunItemRecord = Omit<
  ExperimentRunItemsRow,
  "ProjectionId" | "TenantId" | "CreatedAt" | "_retention_days"
>;

/**
 * The item's identity: a deterministic hash of its business key, so a
 * redelivered result re-derives the same id and the `ReplacingMergeTree`
 * collapses the duplicate at merge (ADR-103 decision 2).
 *
 * `experimentId` is in the hash because the deployed sort key is
 * `(TenantId, RunId, ProjectionId)`: without it, two experiments sharing a
 * `runId` mint identical sort keys and one item is lost at the next merge.
 * Ids minted before this change no longer collide with these.
 */
export function generateItemProjectionId(args: {
  readonly tenantId: string;
  readonly experimentId: string;
  readonly runId: string;
  readonly index: number;
  readonly targetId: string;
  readonly resultType: "target" | "evaluator";
  readonly evaluatorId: string | null;
}): string {
  if (args.resultType === "evaluator" && !args.evaluatorId) {
    throw new Error("evaluatorId is required for evaluator results");
  }
  if (args.resultType === "target" && args.evaluatorId != null) {
    throw new Error("evaluatorId must be null for target results");
  }

  const hashInput = args.evaluatorId
    ? `${args.tenantId}:${args.experimentId}:${args.runId}:${args.index}:${args.targetId}:${args.evaluatorId}:${args.resultType}`
    : `${args.tenantId}:${args.experimentId}:${args.runId}:${args.index}:${args.targetId}:${args.resultType}`;

  const hash = createHash("sha256").update(hashInput).digest();
  const instance = new Instance(
    Instance.schemes.RANDOM,
    new Uint8Array(hash.subarray(0, 8)),
  );
  // Epoch 0 / sequence 0, so the id depends only on the business-key hash.
  return new Ksuid(
    getEnvironment(),
    KSUID_RESOURCES.EXPERIMENT_RUN_RESULT,
    0,
    instance,
    0,
  ).toString();
}

/** Clock skew can produce negative durations the unsigned columns reject. */
function normalizeDurationMs(
  duration: number | null | undefined,
): number | null {
  return duration != null ? Math.max(0, duration) : null;
}

export function mapTargetResult(
  data: TargetResultData,
): ExperimentRunItemRecord {
  return {
    RunId: data.runId,
    ExperimentId: data.experimentId,
    RowIndex: data.index,
    TargetId: data.targetId,
    ResultType: "target",
    DatasetEntry: JSON.stringify(data.entry),
    Predicted: data.predicted ? JSON.stringify(data.predicted) : null,
    TargetCost: data.cost ?? null,
    TargetDurationMs: normalizeDurationMs(data.duration),
    TargetError: data.error ?? null,
    TargetDomainError: data.domainError
      ? JSON.stringify(data.domainError)
      : null,
    TraceId: data.traceId ?? null,
    EvaluatorId: null,
    EvaluatorName: null,
    EvaluationStatus: "",
    Score: null,
    Label: null,
    Passed: null,
    EvaluationDetails: null,
    EvaluationCost: null,
    EvaluationInputs: null,
    EvaluationDurationMs: null,
    OccurredAt: new Date(data.occurredAt),
  };
}

export function mapEvaluatorResult(
  data: EvaluatorResultData,
): ExperimentRunItemRecord {
  return {
    RunId: data.runId,
    ExperimentId: data.experimentId,
    RowIndex: data.index,
    TargetId: data.targetId,
    ResultType: "evaluator",
    DatasetEntry: "{}",
    Predicted: null,
    TargetCost: null,
    TargetDurationMs: null,
    TargetError: null,
    TargetDomainError: null,
    TraceId: null,
    EvaluatorId: data.evaluatorId,
    EvaluatorName: data.evaluatorName ?? null,
    EvaluationStatus: data.status,
    Score: data.score ?? null,
    Label: data.label ?? null,
    Passed: data.passed == null ? null : data.passed ? 1 : 0,
    EvaluationDetails: data.details ?? null,
    EvaluationCost: data.cost ?? null,
    EvaluationInputs: data.inputs ? JSON.stringify(data.inputs) : null,
    EvaluationDurationMs: normalizeDurationMs(data.duration),
    OccurredAt: new Date(data.occurredAt),
  };
}

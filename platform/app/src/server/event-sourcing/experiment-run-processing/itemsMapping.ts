import { createHash } from "node:crypto";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";
import type {
  EvaluatorResultData,
  ExperimentRunItemRecord,
  TargetResultData,
} from "./schema";

/**
 * `ProjectionId` for one item, and the map from a `targetResultRecorded` /
 * `evaluatorResultRecorded` event to its `experiment_run_items` row
 * (ADR-098 §2 "map", ADR-103 decision 2).
 *
 * ## The `ProjectionId` investigation this task asked for
 *
 * `ProjectionId` is a deterministic hash of the logical item's business key,
 * minted with `IdUtils.generateDeterministicResultId`
 * (`event-sourcing.old/.../utils/id.utils.ts:5-47`): SHA-256 over
 * `${tenantId}:${runId}:${index}:${targetId}[:${evaluatorId}]:${resultType}`,
 * fed into a KSUID pinned at epoch 0 / sequence 0 so the same business key
 * always re-derives the identical id. **This is the right half of ADR-103
 * decision 2**: because the id depends on the delivery's content and not on
 * when or how many times it was delivered, a redelivered result re-derives
 * the same `ProjectionId`, and `ReplacingMergeTree(OccurredAt)` with
 * `ORDER BY (TenantId, RunId, ProjectionId)` collapses the duplicate at
 * merge. `count()` over the table is genuinely a count of logical items, not
 * of deliveries — which is the property `totals.ts`'s derived query depends
 * on.
 *
 * **The wrong half, confirmed by reading the old hash input and the deployed
 * sort key together: `experimentId` is in neither.** ADR-103 names the
 * consequence directly: "Two experiments that share a `runId`... produce
 * item rows with identical sort keys... the defect is invisible until a
 * background merge collapses the two rows into one and the older
 * experiment's item is gone." The read path guards against it today by
 * deduping on the full business tuple *including* `ExperimentId`
 * (`experiment-run.service.ts`), which is what keeps the defect invisible
 * until ClickHouse actually merges the colliding parts — a silent,
 * timing-dependent data loss with no error and no read-time symptom until
 * the moment it fires.
 *
 * `generateItemProjectionId` below closes this **without a migration**: it
 * folds `experimentId` into the hash input, so two experiments sharing a
 * `runId` (and, within it, the same `index`/`targetId`[/`evaluatorId`]) now
 * derive *different* `ProjectionId` values. Since the physical sort key is
 * `(TenantId, RunId, ProjectionId)` — unchanged, and not re-keyable within
 * this task's scope — rows that used to collide on that key no longer do,
 * because the value that differs (`ProjectionId`) is exactly the column the
 * key ends on. The fix lives entirely in what this function hashes, not in
 * the table.
 *
 * This is a deliberate ID-generation change, not a preserved behaviour: a
 * result recorded under the *old* hash (pre-rewrite) and the *same* logical
 * item recorded again under this function post-cutover derive two different
 * `ProjectionId`s and do not collapse into each other. That is the expected,
 * one-time cost of closing a live data-loss defect — the alternative is
 * carrying the collision forward. Flagged in this task's final report rather
 * than silently absorbed.
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
  const instanceIdentifier = new Uint8Array(hash.subarray(0, 8));
  const instance = new Instance(Instance.schemes.RANDOM, instanceIdentifier);
  // Epoch 0 / sequence 0 so the id depends only on the business-key hash,
  // exactly as the old generator did.
  const ksuid = new Ksuid(
    getEnvironment(),
    KSUID_RESOURCES.EXPERIMENT_RUN_RESULT,
    0,
    instance,
    0,
  );
  return ksuid.toString();
}

function normalizeDurationMs(
  duration: number | null | undefined,
): number | null {
  // Clock skew can produce negative durations, which the unsigned duration
  // columns reject — clamped rather than rejected, matching the old pipeline.
  return duration != null ? Math.max(0, duration) : null;
}

/**
 * `targetResultRecorded` -> one `experiment_run_items` row (ADR-098 §2: a
 * map is a pure, independent, per-event projection — this function reads
 * only its own event's data, nothing accumulated).
 */
export function mapTargetResult(args: {
  readonly tenantId: string;
  readonly data: TargetResultData;
}): ExperimentRunItemRecord {
  const { tenantId, data } = args;
  return {
    projectionId: generateItemProjectionId({
      tenantId,
      experimentId: data.experimentId,
      runId: data.runId,
      index: data.index,
      targetId: data.targetId,
      resultType: "target",
      evaluatorId: null,
    }),
    tenantId,
    runId: data.runId,
    experimentId: data.experimentId,
    rowIndex: data.index,
    targetId: data.targetId,
    resultType: "target",
    datasetEntry: JSON.stringify(data.entry),
    predicted: data.predicted ? JSON.stringify(data.predicted) : null,
    targetCost: data.cost ?? null,
    targetDurationMs: normalizeDurationMs(data.duration),
    targetError: data.error ?? null,
    targetDomainError: data.domainError
      ? JSON.stringify(data.domainError)
      : null,
    traceId: data.traceId ?? null,
    evaluatorId: null,
    evaluatorName: null,
    evaluationStatus: "",
    score: null,
    label: null,
    passed: null,
    evaluationDetails: null,
    evaluationCost: null,
    evaluationInputs: null,
    evaluationDurationMs: null,
    occurredAt: data.occurredAt,
  };
}

/** `evaluatorResultRecorded` -> one `experiment_run_items` row. See {@link mapTargetResult}. */
export function mapEvaluatorResult(args: {
  readonly tenantId: string;
  readonly data: EvaluatorResultData;
}): ExperimentRunItemRecord {
  const { tenantId, data } = args;
  return {
    projectionId: generateItemProjectionId({
      tenantId,
      experimentId: data.experimentId,
      runId: data.runId,
      index: data.index,
      targetId: data.targetId,
      resultType: "evaluator",
      evaluatorId: data.evaluatorId,
    }),
    tenantId,
    runId: data.runId,
    experimentId: data.experimentId,
    rowIndex: data.index,
    targetId: data.targetId,
    resultType: "evaluator",
    datasetEntry: "{}",
    predicted: null,
    targetCost: null,
    targetDurationMs: null,
    targetError: null,
    targetDomainError: null,
    traceId: null,
    evaluatorId: data.evaluatorId,
    evaluatorName: data.evaluatorName ?? null,
    evaluationStatus: data.status,
    score: data.score ?? null,
    label: data.label ?? null,
    passed: data.passed == null ? null : data.passed ? 1 : 0,
    evaluationDetails: data.details ?? null,
    evaluationCost: data.cost ?? null,
    evaluationInputs: data.inputs ? JSON.stringify(data.inputs) : null,
    evaluationDurationMs: normalizeDurationMs(data.duration),
    occurredAt: data.occurredAt,
  };
}

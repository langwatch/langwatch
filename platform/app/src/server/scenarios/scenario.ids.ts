/**
 * ID generators for scenario execution.
 *
 * Extracted from scenario.queue.ts so they're available without BullMQ.
 */

import { createHash } from "node:crypto";

import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

/** Generates a unique batch run ID for grouping scenario executions */
export function generateBatchRunId(): string {
  return generate(KSUID_RESOURCES.SCENARIO_BATCH).toString();
}

/** Generates a unique scenario run ID with `scenariorun_` prefix for SDK passthrough */
export function generateScenarioRunId(): string {
  return generate(KSUID_RESOURCES.SCENARIO_RUN).toString();
}

/**
 * Deterministic ids for idempotent suite submits.
 *
 * `QueueRunCommand` already keys everything that matters on `scenarioRunId` —
 * both `aggregateId` and `idempotencyKey` (`<tenant>:<scenarioRunId>:queueRun`).
 * So a repeated submit collapses on its own the moment the ids repeat, with no
 * claim table and no extra round trip: the event store deduplicates the
 * command, and the fold sees one `queued` event per run.
 * Deriving the id IS the idempotency.
 *
 * These are only reached when the caller supplied an idempotency key. A submit
 * without one keeps minting random KSUIDs, so running the same suite twice on
 * purpose stays the default.
 *
 * Shape matches the KSUID generators above — `<resource>_<29 base62 chars>` —
 * because `scenarioRunId` is `z.string()` everywhere and consumers only ever
 * compare it exactly. Nothing decodes a scenario run id, so the time-ordering
 * a real KSUID carries is not load-bearing here.
 */
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SUFFIX_LENGTH = 29;

function deriveId(resource: string, parts: readonly string[]): string {
  // NUL-joined so no combination of field values can collide by concatenation
  // (a scenario id ending in a digit beside a repeat index, say).
  const digest = createHash("sha256").update(parts.join("\u0000")).digest();

  let remaining = 0n;
  for (const byte of digest) remaining = (remaining << 8n) | BigInt(byte);

  let suffix = "";
  while (suffix.length < SUFFIX_LENGTH) {
    suffix = BASE62[Number(remaining % 62n)]! + suffix;
    remaining /= 62n;
  }
  return `${resource}_${suffix}`;
}

/**
 * The batch a given submit always produces.
 *
 * Keyed by the active set as well as the idempotency key, because the batch
 * carries its own denominator: every child stamps `BatchTotal` (ADR-072), so a
 * batch is only meaningful if every member agrees what the total is.
 *
 * Without the set in the key, a retry of the same key against a changed set —
 * a scenario archived between attempts, say — reuses the batch id while
 * recomputing the total. Members common to both attempts collapse onto their
 * first write and keep the OLD total; members new to the second carry the NEW
 * one. One batch id, two denominators, and progress that never reads as
 * complete. Changing the set makes it a different batch, which is what it is.
 */
export function deriveBatchRunId(params: {
  projectId: string;
  suiteId: string;
  idempotencyKey: string;
  /** Scenario ids in the submit. Order-insensitive: sorted before hashing. */
  scenarioIds: readonly string[];
  /** Target reference ids in the submit. Order-insensitive. */
  targetReferenceIds: readonly string[];
  repeatCount: number;
}): string {
  return deriveId(KSUID_RESOURCES.SCENARIO_BATCH, [
    params.projectId,
    params.suiteId,
    params.idempotencyKey,
    [...params.scenarioIds].sort().join(","),
    [...params.targetReferenceIds].sort().join(","),
    String(params.repeatCount),
  ]);
}

/**
 * The run id a given item within that batch always produces.
 *
 * Keyed off `batchRunId` rather than the idempotency key directly, so a run id
 * can never outlive the batch whose total it was queued under. Keying on the
 * raw idempotency key would let the same run id appear in two batches with
 * different denominators — the same defect the batch key above closes, moved
 * one level down.
 */
export function deriveScenarioRunId(params: {
  projectId: string;
  batchRunId: string;
  scenarioId: string;
  targetReferenceId: string;
  repeat: number;
}): string {
  return deriveId(KSUID_RESOURCES.SCENARIO_RUN, [
    params.projectId,
    params.batchRunId,
    params.scenarioId,
    params.targetReferenceId,
    String(params.repeat),
  ]);
}

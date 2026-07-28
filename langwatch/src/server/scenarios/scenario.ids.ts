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
 * `aggregateId`, `idempotencyKey` (`<tenant>:<scenarioRunId>:queueRun`) and
 * `makeJobId`. So a repeated submit collapses on its own the moment the ids
 * repeat, with no claim table and no extra round trip: the event store
 * deduplicates the command, and the fold sees one `queued` event per run.
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

/** The batch a given (project, suite, idempotency key) submit always produces. */
export function deriveBatchRunId(params: {
  projectId: string;
  suiteId: string;
  idempotencyKey: string;
}): string {
  return deriveId(KSUID_RESOURCES.SCENARIO_BATCH, [
    params.projectId,
    params.suiteId,
    params.idempotencyKey,
  ]);
}

/**
 * The run id a given item within that submit always produces. Keyed by
 * everything that distinguishes one queued run from its siblings, so a suite
 * whose scenarios or targets changed between retries still queues the runs
 * that are genuinely new.
 */
export function deriveScenarioRunId(params: {
  projectId: string;
  idempotencyKey: string;
  scenarioId: string;
  targetReferenceId: string;
  repeat: number;
}): string {
  return deriveId(KSUID_RESOURCES.SCENARIO_RUN, [
    params.projectId,
    params.idempotencyKey,
    params.scenarioId,
    params.targetReferenceId,
    String(params.repeat),
  ]);
}

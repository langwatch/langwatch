import type { EvaluationRunData } from "../types";

import { createLogger } from "~/utils/logger/server";

const logger = createLogger(
  "langwatch:app-layer:evaluations:payload-cap",
);

/**
 * Per-value byte ceiling for the unbounded payload columns on `evaluation_runs`
 * (`Inputs`, `Details`, `Error`, `ErrorDetails`).
 *
 * Incident: a single multi-GB `Inputs` value (a full trace context
 * JSON-stringified at write time) produced a ClickHouse part that no longer fit
 * the merge memory budget. The partition's MERGE_PARTS task then retried for
 * ~10 days with `MEMORY_LIMIT_EXCEEDED` (code 241, ~11 GiB against the 14 GiB
 * server cap) and never converged, spiking memory on every backoff. ClickHouse
 * already caps merge *blocks* at 10 MiB (`merge_max_block_size_bytes`), so the
 * only way to force a multi-GB allocation during a merge is a single oversized
 * *row* — which this write-time cap prevents.
 *
 * 8 MiB is far above any legitimate evaluator payload (the offending partition
 * averaged well under 1 MiB/row) while keeping every row trivially mergeable.
 * Mirrors `capOversizedString` / `MAX_MESSAGE_CONTENT_BYTES` in the simulation
 * projection.
 */
export const MAX_EVALUATION_PAYLOAD_BYTES = 8 * 1024 * 1024;

export interface PayloadCapContext {
  tenantId: string;
  evaluationId: string;
}

/**
 * `length * 3 <= maxBytes` is the only safe length-only bypass: UTF-8 uses at
 * most 3 bytes per UTF-16 code unit (a surrogate pair is 4 bytes but occupies
 * two code units, so the per-code-unit ceiling stays 3). Using `length <=
 * maxBytes` would let a multibyte string up to ~3× over the cap slip through.
 */
function withinCap(value: string): boolean {
  if (value.length * 3 <= MAX_EVALUATION_PAYLOAD_BYTES) return true;
  return Buffer.byteLength(value, "utf8") <= MAX_EVALUATION_PAYLOAD_BYTES;
}

/**
 * Cap an oversized free-text column, leaving an observable marker and emitting a
 * structured warn so an upstream regression doesn't silently land an
 * unmergeable row in ClickHouse. `null` passes through unchanged.
 */
export function capPayloadText(
  value: string | null,
  field: "Details" | "Error" | "ErrorDetails",
  ctx: PayloadCapContext,
): string | null {
  if (value === null || withinCap(value)) return value;
  const byteLength = Buffer.byteLength(value, "utf8");
  logger.warn(
    { ...ctx, field, byteLength, maxBytes: MAX_EVALUATION_PAYLOAD_BYTES },
    `evaluation_runs ${field} exceeds size cap — truncating; an oversized row makes the partition unmergeable`,
  );
  return `[truncated: evaluation_runs ${field} was ${byteLength} bytes (cap ${MAX_EVALUATION_PAYLOAD_BYTES})]`;
}

/**
 * Serialize evaluator inputs, replacing an oversized payload with a marker
 * object so the column stays valid JSON *and* the row stays mergeable.
 */
export function capInputs(
  inputs: EvaluationRunData["inputs"],
  ctx: PayloadCapContext,
): string | null {
  if (!inputs) return null;
  const serialized = JSON.stringify(inputs);
  if (withinCap(serialized)) return serialized;
  const byteLength = Buffer.byteLength(serialized, "utf8");
  logger.warn(
    { ...ctx, field: "Inputs", byteLength, maxBytes: MAX_EVALUATION_PAYLOAD_BYTES },
    "evaluation_runs Inputs exceeds size cap — replacing with marker; an oversized row makes the partition unmergeable",
  );
  return JSON.stringify({
    __truncated: true,
    field: "Inputs",
    originalBytes: byteLength,
    cap: MAX_EVALUATION_PAYLOAD_BYTES,
  });
}

/**
 * Belt-and-braces write-time caps for the heavy `evaluation_runs` columns
 * (ADR-039).
 *
 * These run UNCONDITIONALLY at the repository write, independent of the
 * `release_evaluation_payload_offload` feature flag and independent of which
 * writer produced the row. They are the last line of defence that keeps a
 * ClickHouse part merge-safe: even if the offload path is off, fails open, or
 * some other writer inserts a fat payload, a single row can never carry an
 * unbounded `Inputs` / `Details` / `Error` / `ErrorDetails` value into a part
 * that a background merge then has to materialize.
 *
 * The offload path (evaluation-inputs-offload.ts) is the primary mechanism and
 * keeps the FULL content durable. This cap is intentionally coarser: it
 * truncates with an observable marker. In normal operation with offload on,
 * `Inputs` arrives here already as a small marker object, so this cap is a
 * no-op; it only bites on the un-offloaded fat-payload path.
 */

/**
 * Hard cap for the serialized `Inputs` column. Larger than the offload inline
 * threshold (1 MiB) so the offload marker is always the mechanism that shapes
 * normal rows; this only fires for un-offloaded payloads.
 */
export const EVAL_INPUTS_ROW_CAP_BYTES = 8 * 1024 * 1024; // 8 MiB

/** Hard cap for each plain-text column (Details / Error / ErrorDetails). */
export const EVAL_TEXT_ROW_CAP_BYTES = 256 * 1024; // 256 KiB

/** Discriminating key for the write-time truncation marker on `Inputs`. */
export const TRUNCATED_MARKER_KEY = "__lw_truncated" as const;

/** Observable suffix appended to a truncated plain-text column. */
export const TRUNCATED_TEXT_SUFFIX = "…[lw-truncated]" as const;

export interface TruncatedInputsMarker {
  [TRUNCATED_MARKER_KEY]: {
    originalBytes: number;
    cap: number;
  };
}

/**
 * Caps an already-serialized `Inputs` JSON string. Returns the original string
 * when within budget; otherwise returns a valid-JSON truncation marker so
 * every downstream `JSON.parse(Inputs)` still succeeds. `null` passes through.
 */
export function capSerializedInputs(serialized: string | null): {
  value: string | null;
  truncated: boolean;
  originalBytes: number;
} {
  if (serialized === null) {
    return { value: null, truncated: false, originalBytes: 0 };
  }
  const originalBytes = Buffer.byteLength(serialized, "utf8");
  if (originalBytes <= EVAL_INPUTS_ROW_CAP_BYTES) {
    return { value: serialized, truncated: false, originalBytes };
  }
  const marker: TruncatedInputsMarker = {
    [TRUNCATED_MARKER_KEY]: {
      originalBytes,
      cap: EVAL_INPUTS_ROW_CAP_BYTES,
    },
  };
  return { value: JSON.stringify(marker), truncated: true, originalBytes };
}

/**
 * Caps a plain-text column to {@link EVAL_TEXT_ROW_CAP_BYTES}. Truncation
 * slices on bytes and appends {@link TRUNCATED_TEXT_SUFFIX} so the cut is
 * observable. `null` passes through.
 */
export function capText(value: string | null): {
  value: string | null;
  truncated: boolean;
  originalBytes: number;
} {
  if (value === null) {
    return { value: null, truncated: false, originalBytes: 0 };
  }
  const buf = Buffer.from(value, "utf8");
  if (buf.length <= EVAL_TEXT_ROW_CAP_BYTES) {
    return { value, truncated: false, originalBytes: buf.length };
  }
  const head = buf.subarray(0, EVAL_TEXT_ROW_CAP_BYTES).toString("utf8");
  return {
    value: `${head}${TRUNCATED_TEXT_SUFFIX}`,
    truncated: true,
    originalBytes: buf.length,
  };
}

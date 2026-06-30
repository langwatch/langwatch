/**
 * ADR-034: the pure view-model for the dataset-processing bar — no React, no
 * tRPC, so the load-bearing rule is directly testable: the durable `getById`
 * status is the terminal authority and ALWAYS overrides whatever the last
 * (ephemeral) SSE tick said. That is what makes the bar un-hangable
 * (I-TERMINAL-REACHED): a stale `processing` 45% tick can never survive a
 * `getById` that reads `ready`/`failed`.
 */

export type DatasetProgressPhase =
  | "uploading"
  | "processing"
  | "finalizing"
  | "ready"
  | "failed";

/** Latest ephemeral progress tick for one dataset (from the SSE stream). */
export type DatasetProgressLive = {
  bytesRead?: number;
  totalBytes?: number;
  rows?: number;
  phase?: DatasetProgressPhase;
};

/** A (timestamp, input-bytes) sample used to estimate throughput → ETA. */
export type EtaSample = { t: number; bytes: number };

export type DatasetProgressView =
  | { kind: "hidden" }
  | { kind: "failed"; message?: string }
  | { kind: "indeterminate"; phase: DatasetProgressPhase }
  | {
      kind: "determinate";
      percent: number;
      rows?: number;
      etaSeconds?: number;
      phase: DatasetProgressPhase;
    };

/** Coarse durable status as returned by `dataset.getById` (ADR-032). */
export type DatasetStatusLike =
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | null
  | undefined;

const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

/**
 * Estimate seconds remaining from input-byte throughput over the sample window.
 * Returns undefined until there are ≥2 samples and a positive rate — the ADR
 * deliberately does not show an ETA before it can be meaningful.
 */
export const estimateEtaSeconds = (
  samples: EtaSample[],
  totalBytes: number | undefined,
  currentBytes: number | undefined,
): number | undefined => {
  if (!totalBytes || currentBytes == null || samples.length < 2) return undefined;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const elapsedSec = (last.t - first.t) / 1000;
  const bytesDelta = last.bytes - first.bytes;
  if (elapsedSec <= 0 || bytesDelta <= 0) return undefined;
  const rate = bytesDelta / elapsedSec; // bytes/sec
  const remaining = Math.max(0, totalBytes - currentBytes);
  return Math.ceil(remaining / rate);
};

/**
 * Map the durable status + the latest ephemeral tick to what the bar shows.
 *
 * Terminal `getById` status wins over any `live`:
 *  - failed  → failed (durable `statusError`), even if the last tick was 45%.
 *  - ready / null (legacy) / undefined (loading) → hidden (the editor takes over).
 *  - uploading / processing → determinate when a live tick with a total exists,
 *    otherwise an honest indeterminate "Processing…" (refresh / no tick yet).
 */
export const deriveDatasetProgressView = (input: {
  status: DatasetStatusLike;
  statusError?: string | null;
  live: DatasetProgressLive | null;
  etaSeconds?: number;
}): DatasetProgressView => {
  const { status, statusError, live, etaSeconds } = input;

  if (status === "failed") {
    return { kind: "failed", message: statusError ?? undefined };
  }
  if (status === "uploading" || status === "processing") {
    if (live && live.totalBytes && live.totalBytes > 0 && live.bytesRead != null) {
      return {
        kind: "determinate",
        percent: clampPercent((live.bytesRead / live.totalBytes) * 100),
        rows: live.rows,
        etaSeconds,
        phase: live.phase ?? "processing",
      };
    }
    return { kind: "indeterminate", phase: live?.phase ?? status };
  }
  // ready, legacy-null, or not-yet-resolved → nothing to show.
  return { kind: "hidden" };
};

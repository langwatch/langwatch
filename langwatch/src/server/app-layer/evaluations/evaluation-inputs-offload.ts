/**
 * Durable stored-object offload for oversized evaluation inputs (ADR-040).
 *
 * A single evaluator `inputs` object (full conversation context, RAG chunks)
 * can reach GB scale for one run. Carrying that verbatim in the evaluation
 * event's `EventPayload` and in `evaluation_runs.Inputs` is what stalled a
 * production ClickHouse partition merge under the server memory cap.
 *
 * Instead of truncating (which silently destroys the content), oversized
 * inputs are written once to the content-addressed stored-objects service and
 * the payload carries a bounded marker: a small, valid JSON object that
 * references the durable object plus a preview. Reads at API boundaries
 * resolve the marker back to the full inputs transparently; folds and
 * reactors receive the marker opaquely so the fat payload never re-inlines
 * on a fold re-write.
 *
 * This mirrors the trace blob-offload pattern (ADR-022) but stores the
 * content in a DURABLE object rather than a transient spool, because here
 * the goal is to keep `event_log.EventPayload` itself bounded - event_log is
 * not a safe home for GB-scale evaluator inputs.
 */
import { createHash } from "node:crypto";
import type { StoredObjectsService } from "~/server/stored-objects/stored-objects.service";
import { createLogger } from "~/utils/logger/server";
import { streamToBuffer } from "~/utils/streamToBuffer";

/**
 * Inputs serialized to at most this many bytes stay inline. Above it, the
 * inputs are offloaded to a stored object and replaced with a marker.
 * Overridable via LANGWATCH_EVAL_INPUTS_INLINE_MAX_BYTES for operators who
 * need a tighter or looser inline budget.
 */
export const EVAL_INPUTS_INLINE_MAX_BYTES = readByteEnv(
  "LANGWATCH_EVAL_INPUTS_INLINE_MAX_BYTES",
  1024 * 1024, // 1 MiB
);

/**
 * Absolute ceiling on inputs we are willing to move over the wire to object
 * storage. Above it, we do NOT offload the full payload (a multi-GB PUT would
 * itself be a memory/latency hazard); we store a marker carrying only the
 * preview and emit a structured warning attributing the bound to the tenant
 * and evaluation. The full content is dropped in this pathological case -
 * accepted because it protects the platform and is observable.
 */
export const EVAL_INPUTS_HARD_CEILING_BYTES = readByteEnv(
  "LANGWATCH_EVAL_INPUTS_HARD_CEILING_BYTES",
  50 * 1024 * 1024, // 50 MiB
);

/**
 * The inline budget must never exceed the ceiling: an operator setting
 * LANGWATCH_EVAL_INPUTS_INLINE_MAX_BYTES above the ceiling would let the
 * exact payload class the ceiling exists to catch flow through inline.
 */
const EVAL_INPUTS_INLINE_MAX_BYTES_EFFECTIVE = Math.min(
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_HARD_CEILING_BYTES,
);

/** First N bytes of the serialized inputs kept inline on the marker. */
export const EVAL_INPUTS_PREVIEW_BYTES = 16 * 1024; // 16 KiB

/** stored-objects classification for offloaded evaluator inputs. */
export const EVAL_INPUTS_STORED_OBJECT_PURPOSE = "evaluation_inputs" as const;
const EVAL_INPUTS_OWNER_KIND = "evaluation" as const;
const EVAL_INPUTS_MEDIA_TYPE = "application/json" as const;

/** Discriminating key for the offload marker. */
export const STORED_OBJECT_MARKER_KEY = "__lw_stored_object" as const;

const logger = createLogger("langwatch:evaluations:inputs-offload");

/**
 * Marker written in place of oversized inputs. It is a valid JSON object so
 * that every existing `JSON.stringify(inputs)` / `JSON.parse(Inputs)` seam
 * keeps working; consumers that don't resolve it simply see an object with
 * one reserved key.
 *
 * A type alias (not an interface) on purpose: aliases get an implicit index
 * signature, so a value narrowed by {@link isStoredObjectMarker} is directly
 * assignable to the `Record<string, unknown>` seams it flows through - no
 * cast at the call sites.
 */
export type StoredObjectInputsMarker = {
  [STORED_OBJECT_MARKER_KEY]: {
    /** stored_objects id - resolve via StoredObjectsService.getById. */
    id: string;
    /** Byte length of the serialized inputs that were offloaded. */
    sizeBytes: number;
    /**
     * SHA-256 of the serialized inputs. Null when the content was not stored
     * (hard-ceiling case), where only the preview survives.
     */
    sha256: string | null;
    /** First EVAL_INPUTS_PREVIEW_BYTES of the serialized inputs, as a string. */
    preview: string;
    /** True when `preview` is a prefix of a longer serialized payload. */
    truncatedPreview: boolean;
    /**
     * True when the payload exceeded the hard ceiling and only the preview was
     * kept (no durable object). `id` is empty and `sha256` is null then.
     */
    ceilingExceeded?: boolean;
    /**
     * True when the durable PUT failed (storage outage, bad credentials) and
     * the payload was bounded to this preview-only marker instead of
     * re-inlining the raw inputs. `id` is empty and `sha256` is null then.
     */
    offloadFailed?: boolean;
  };
};

/** Type guard: is this value an offload marker (not plain inputs)? */
export function isStoredObjectMarker(
  value: unknown,
): value is StoredObjectInputsMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)[STORED_OBJECT_MARKER_KEY] ===
      "object" &&
    (value as Record<string, unknown>)[STORED_OBJECT_MARKER_KEY] !== null
  );
}

/** Reserved key carrying the compact, safe list projection of a marker. */
export const OFFLOADED_INPUTS_PROJECTION_KEY = "_lw_offloaded" as const;

/**
 * Compact, safe projection of an offload marker for multi-trace / list reads.
 * It exposes only the human-readable preview and whether it is truncated -
 * never the internal storage plumbing (`id`, `sha256`, the raw marker key).
 * List consumers cannot resolve the full inputs; they fetch those lazily
 * through the single-evaluation seam (getEvaluationInputs) when needed.
 */
export interface OffloadedInputsProjection {
  [OFFLOADED_INPUTS_PROJECTION_KEY]: {
    /** First EVAL_INPUTS_PREVIEW_BYTES of the serialized inputs, as a string. */
    preview: string;
    /** True when `preview` is a prefix of longer inputs (always true here). */
    truncated: boolean;
    /** Byte length of the serialized inputs that were offloaded. */
    sizeBytes: number;
  };
}

/**
 * Projects an offload marker to the compact, leak-free shape safe to ship on
 * list/multi-trace read paths. Drops `id` and `sha256` so no internal storage
 * reference ever crosses the service boundary on those paths.
 */
export function projectMarkerForList(
  value: StoredObjectInputsMarker,
): OffloadedInputsProjection {
  const marker = value[STORED_OBJECT_MARKER_KEY];
  return {
    [OFFLOADED_INPUTS_PROJECTION_KEY]: {
      preview: marker.preview,
      truncated: marker.truncatedPreview,
      sizeBytes: marker.sizeBytes,
    },
  };
}

function readByteEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function buildPreview(serialized: string): {
  preview: string;
  truncatedPreview: boolean;
} {
  // Never buffer the whole payload just to cut a preview: this function runs
  // on the very payloads this module exists to bound (GB scale), and
  // Buffer.from(serialized) would double peak memory. Buffer.byteLength
  // computes without allocating, and a UTF-16 code unit encodes to at least
  // one UTF-8 byte, so the first PREVIEW_BYTES code units always cover the
  // first PREVIEW_BYTES output bytes; only that bounded slice gets buffered.
  if (Buffer.byteLength(serialized, "utf8") <= EVAL_INPUTS_PREVIEW_BYTES) {
    return { preview: serialized, truncatedPreview: false };
  }
  const boundedSlice = serialized.slice(0, EVAL_INPUTS_PREVIEW_BYTES);
  const buf = Buffer.from(boundedSlice, "utf8");
  if (buf.length <= EVAL_INPUTS_PREVIEW_BYTES) {
    return { preview: boundedSlice, truncatedPreview: true };
  }
  // toString on a mid-codepoint cut yields the replacement char rather than
  // throwing, which is fine for a human-readable preview.
  const preview = buf.subarray(0, EVAL_INPUTS_PREVIEW_BYTES).toString("utf8");
  return { preview, truncatedPreview: true };
}

/**
 * Preview-only marker for inputs over the hard ceiling: no durable object is
 * written (a multi-GB PUT is itself a hazard), only the preview survives. Warns
 * (attributing the bound to the tenant and evaluation) since the full content
 * is dropped here - accepted because it protects the platform and is observable.
 */
function buildCeilingMarker({
  sizeBytes,
  preview,
  truncatedPreview,
  projectId,
  evaluationId,
}: {
  sizeBytes: number;
  preview: string;
  truncatedPreview: boolean;
  projectId: string;
  evaluationId: string;
}): Record<string, unknown> {
  logger.warn(
    {
      projectId,
      evaluationId,
      sizeBytes,
      hardCeilingBytes: EVAL_INPUTS_HARD_CEILING_BYTES,
    },
    "Evaluation inputs exceed the hard ceiling; storing preview-only marker without offloading full content",
  );
  return {
    [STORED_OBJECT_MARKER_KEY]: {
      id: "",
      sizeBytes,
      sha256: null,
      preview,
      truncatedPreview,
      ceilingExceeded: true,
    },
  } satisfies StoredObjectInputsMarker;
}

/**
 * Preview-only marker for inputs whose durable PUT failed: the evaluation
 * still completes, but the raw inputs must NOT re-inline into the event - an
 * unbounded `event_log.EventPayload` under the exact partial-failure path this
 * module exists for would recreate the fat-payload class behind the 2026-07-10
 * outage. Full recovery is unavailable for this run; the warning makes that
 * observable per tenant and evaluation.
 */
function buildOffloadFailedMarker({
  sizeBytes,
  preview,
  truncatedPreview,
  projectId,
  evaluationId,
  error,
}: {
  sizeBytes: number;
  preview: string;
  truncatedPreview: boolean;
  projectId: string;
  evaluationId: string;
  error: unknown;
}): Record<string, unknown> {
  logger.warn(
    {
      projectId,
      evaluationId,
      sizeBytes,
      error: error instanceof Error ? error.message : String(error),
    },
    "Evaluation inputs offload failed; degrading to a bounded preview-only marker (evaluation completes, full content unavailable for this run)",
  );
  return {
    [STORED_OBJECT_MARKER_KEY]: {
      id: "",
      sizeBytes,
      sha256: null,
      preview,
      truncatedPreview,
      offloadFailed: true,
    },
  } satisfies StoredObjectInputsMarker;
}

/**
 * Writes the serialized inputs to the stored-objects service and returns the
 * marker referencing them. The serialized payload is encoded to UTF-8 exactly
 * once; that single buffer feeds both the store PUT and the SHA-256, so a
 * GB-scale payload is not re-encoded twice.
 */
async function storeOversizedInputs({
  serialized,
  sizeBytes,
  preview,
  truncatedPreview,
  projectId,
  evaluationId,
  storedObjects,
}: {
  serialized: string;
  sizeBytes: number;
  preview: string;
  truncatedPreview: boolean;
  projectId: string;
  evaluationId: string;
  storedObjects: StoredObjectsService;
}): Promise<Record<string, unknown>> {
  const bytes = Buffer.from(serialized, "utf8");
  const stored = await storedObjects.storeFromBytes({
    projectId,
    purpose: EVAL_INPUTS_STORED_OBJECT_PURPOSE,
    ownerKind: EVAL_INPUTS_OWNER_KIND,
    ownerId: evaluationId,
    mediaType: EVAL_INPUTS_MEDIA_TYPE,
    bytes,
  });
  return {
    [STORED_OBJECT_MARKER_KEY]: {
      id: stored.id,
      sizeBytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      preview,
      truncatedPreview,
    },
  } satisfies StoredObjectInputsMarker;
}

/**
 * Offloads inputs to object storage when their serialized size exceeds the
 * inline threshold; otherwise returns them unchanged.
 *
 * Fail-open, bounded: a storage error never blocks the evaluation, but the
 * payload degrades to a preview-only marker (`offloadFailed`) instead of
 * re-inlining the raw inputs - `event_log.EventPayload` and the fold stay
 * bounded even under an S3 outage. Full input recovery is unavailable for
 * runs reported during the outage window; the belt-and-braces repository cap
 * (evaluation-run.clickhouse.repository.ts) remains the last line of defence
 * for any writer that bypasses this path entirely.
 */
export async function offloadInputsIfOversized({
  inputs,
  projectId,
  evaluationId,
  storedObjects,
}: {
  inputs: Record<string, unknown> | null | undefined;
  projectId: string;
  evaluationId: string;
  storedObjects: StoredObjectsService;
}): Promise<{
  inputs: Record<string, unknown> | null;
  offloaded: boolean;
}> {
  if (inputs === null || inputs === undefined) {
    return { inputs: inputs ?? null, offloaded: false };
  }
  // An already-offloaded marker (e.g. an event replayed through this path)
  // must pass through untouched - never double-offload.
  if (isStoredObjectMarker(inputs)) {
    return { inputs, offloaded: false };
  }

  const serialized = JSON.stringify(inputs);
  const sizeBytes = Buffer.byteLength(serialized, "utf8");
  if (sizeBytes <= EVAL_INPUTS_INLINE_MAX_BYTES_EFFECTIVE) {
    return { inputs, offloaded: false };
  }

  const { preview, truncatedPreview } = buildPreview(serialized);

  // Over the hard ceiling: do not move the full payload to storage; keep a
  // preview-only marker (buildCeilingMarker warns). The content is not
  // recoverable here. The marker is a plain JSON object the caller stores
  // opaquely (resolveInputsMarker re-narrows it via the type guard).
  if (sizeBytes > EVAL_INPUTS_HARD_CEILING_BYTES) {
    return {
      inputs: buildCeilingMarker({
        sizeBytes,
        preview,
        truncatedPreview,
        projectId,
        evaluationId,
      }),
      offloaded: false,
    };
  }

  try {
    return {
      inputs: await storeOversizedInputs({
        serialized,
        sizeBytes,
        preview,
        truncatedPreview,
        projectId,
        evaluationId,
        storedObjects,
      }),
      offloaded: true,
    };
  } catch (error) {
    return {
      inputs: buildOffloadFailedMarker({
        sizeBytes,
        preview,
        truncatedPreview,
        projectId,
        evaluationId,
        error,
      }),
      offloaded: false,
    };
  }
}

/**
 * Resolves an offload marker back to the full inputs. Non-markers pass
 * through unchanged. Fail-safe: a missing/unreadable object returns the
 * marker as-is (so the caller still gets the preview) and logs a warning -
 * never throws, so a stale reference cannot break a read.
 */
export async function resolveInputsMarker({
  inputs,
  projectId,
  storedObjects,
}: {
  inputs: Record<string, unknown> | null | undefined;
  projectId: string;
  storedObjects: StoredObjectsService;
}): Promise<Record<string, unknown> | null> {
  if (inputs === null || inputs === undefined) return inputs ?? null;
  if (!isStoredObjectMarker(inputs)) return inputs;

  const marker = inputs[STORED_OBJECT_MARKER_KEY];
  // Preview-only markers (hard ceiling, failed offload): nothing durable was
  // stored; the preview is all there is. Return the marker untouched so the
  // caller can surface the preview.
  if (!marker.id) {
    return inputs;
  }

  try {
    const result = await storedObjects.getById({ projectId, id: marker.id });
    if (!result || !("stream" in result)) {
      logger.warn(
        { projectId, storedObjectId: marker.id },
        "Offloaded evaluation inputs object missing on read; returning marker with preview",
      );
      return inputs;
    }
    // Integrity: the fetched row must be an evaluation-inputs object. A marker
    // pointing (via a same-project id) at an object of another purpose is a
    // misreference; surfacing its bytes would leak unrelated content, so fail
    // safe to the marker/preview instead. Cross-tenant is already blocked by
    // the project_id scoping on getById.
    if (result.row.purpose !== EVAL_INPUTS_STORED_OBJECT_PURPOSE) {
      logger.warn(
        {
          projectId,
          storedObjectId: marker.id,
          purpose: result.row.purpose,
        },
        "Offloaded evaluation inputs object has an unexpected purpose; returning marker with preview",
      );
      return inputs;
    }
    // Bound the read: the object we wrote is at most the hard ceiling, so a
    // stream beyond it is a tampered/unexpected object and must not OOM.
    const buffer = await streamToBuffer(
      result.stream,
      EVAL_INPUTS_HARD_CEILING_BYTES,
    );
    // Integrity: when the marker carries the content hash, the fetched bytes
    // must hash to it. A mismatch means the durable object diverged from what
    // was offloaded (overwrite, corruption); fail safe to the marker/preview.
    if (marker.sha256) {
      const actualSha256 = createHash("sha256").update(buffer).digest("hex");
      if (actualSha256 !== marker.sha256) {
        logger.warn(
          { projectId, storedObjectId: marker.id },
          "Offloaded evaluation inputs failed sha256 verification; returning marker with preview",
        );
        return inputs;
      }
    }
    const parsed: unknown = JSON.parse(buffer.toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    return inputs;
  } catch (error) {
    logger.warn(
      {
        projectId,
        storedObjectId: marker.id,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to resolve offloaded evaluation inputs; returning marker with preview",
    );
    return inputs;
  }
}

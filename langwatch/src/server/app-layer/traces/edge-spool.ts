/**
 * ADR-022: Edge size-check and transient S3 spool for over-threshold command payloads.
 *
 * `maybeSpool` is called at the ingestion edge, after the span is normalized but
 * BEFORE `commands.traces.recordSpan(data).send()`. It checks the total serialized
 * command payload size:
 *   - payload ≤ COMMAND_INLINE_THRESHOLD → returns a regular RecordSpanCommandData (no change)
 *   - payload > COMMAND_INLINE_THRESHOLD:
 *       - try S3 PUT (spool object, transient)
 *           - success → returns oversized command with `{spoolRef}` only; span attributes cleared
 *           - failure → fail-open: returns regular command with full inline payload;
 *                       logs warn "oversize protection skipped; queue carries full payload"
 */

import type { RecordSpanCommandData } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import type { BlobStore } from "./blob-store.service";
import { COMMAND_INLINE_THRESHOLD } from "./lean-for-projection";

export type { COMMAND_INLINE_THRESHOLD };

/** Logger interface used by maybeSpool for the fail-open warn. */
export interface SpoolLogger {
  warn(msg: string, context?: Record<string, unknown>): void;
}

/**
 * Checks whether the serialized command payload exceeds COMMAND_INLINE_THRESHOLD.
 * If so, attempts to spool the full payload to S3 and returns an oversized command
 * carrying only `{spoolRef}`. If the S3 spool PUT fails, fails open (returns the
 * regular command with full inline payload) and logs at `warn`.
 */
export async function maybeSpool({
  data,
  blobStore,
  logger,
}: {
  data: RecordSpanCommandData;
  blobStore: BlobStore;
  logger: SpoolLogger;
}): Promise<RecordSpanCommandData> {
  const serialized = JSON.stringify(data);
  const byteLength = Buffer.byteLength(serialized, "utf-8");

  if (byteLength <= COMMAND_INLINE_THRESHOLD) {
    // Payload fits inline — no S3 PUT needed
    return data;
  }

  // Payload exceeds threshold — attempt to spool to S3
  const { tenantId: projectId, span } = data;
  const traceId = span.traceId as string;
  const spanId = span.spanId as string;
  const spoolBody = Buffer.from(
    JSON.stringify({ span, resource: data.resource, instrumentationScope: data.instrumentationScope }),
    "utf-8",
  );

  try {
    const spoolRef = await blobStore.putSpool({ projectId, traceId, spanId, body: spoolBody });

    // Return oversized command: spoolRef set, span attributes cleared (only id fields remain)
    return {
      ...data,
      spoolRef,
      span: {
        ...span,
        attributes: [],
      },
    };
  } catch {
    // Fail-open: S3 PUT failed — send full inline payload, log warn
    logger.warn(
      "oversize protection skipped; queue carries full payload",
      { traceId, spanId, byteLength },
    );
    return data;
  }
}

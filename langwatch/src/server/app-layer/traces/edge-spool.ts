/**
 * ADR-022: Edge size-check and transient S3 spool for over-threshold command payloads.
 *
 * `maybeSpool` is called at the ingestion edge, after the span is normalized but
 * BEFORE `commands.traces.recordSpan(data).send()`. It checks the total serialized
 * command payload size:
 *   - payload ≤ COMMAND_INLINE_THRESHOLD → returns a regular RecordSpanCommandData (no change)
 *   - payload > COMMAND_INLINE_THRESHOLD:
 *       - try S3 PUT (spool object, transient)
 *           - success → returns oversized command with `{spoolRef}` only; original payload NOT in command
 *           - failure → fail-open: returns regular command with full inline payload;
 *                       logs warn "oversize protection skipped; queue carries full payload"
 *
 * Not yet implemented — stub exported so tests can import and assert the correct thrown
 * error message. Step 5 of the TDD plan replaces this with the real implementation.
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
 *
 * @throws {Error} "not implemented — ADR-022 step 5" until production logic is filled in.
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
  throw new Error("not implemented — ADR-022 step 5 (maybeSpool)");
  // Suppress unused variable errors until implemented
  void data; void blobStore; void logger;
}

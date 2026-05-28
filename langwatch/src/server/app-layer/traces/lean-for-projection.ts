/**
 * ADR-022: Single source of truth for the lean shape used by the projection queue.
 *
 * `leanForProjection` is invoked at TWO call sites:
 *   (a) eventSourcingService.ts:242-251 (live, between storeEvents and router.dispatch)
 *   (b) replayExecutor.apply (replay, before invoking projection.apply)
 *
 * Same utility at both sites → projection state is path-independent. Tests pin this
 * invariant in lean-for-projection.unit.test.ts + replay-projection-parity.integration.test.ts.
 *
 * Not yet implemented — stub exported so tests can import and assert the correct thrown
 * error message. Step 5 of the TDD plan replaces this with the real implementation.
 */

import type { Event } from "~/server/event-sourcing";

/**
 * Spans whose serialized command payload exceeds this threshold are spooled to S3 at
 * the edge, with the command carrying `{spoolRef}` only. Matches the existing
 * `capOversizedAttributes` boundary.
 */
export const COMMAND_INLINE_THRESHOLD = 256 * 1024;

/**
 * Preview budget for IO attributes. Covers a complete chat-style Claude completion at
 * the common max_tokens=8192 setting (~16K tokens × 4 chars/token ≈ 64 KB).
 * Configurable via `LANGWATCH_IO_PREVIEW_BYTES`.
 */
export const IO_PREVIEW_BYTES = 64 * 1024;

/**
 * Set of span attribute keys that are considered "IO" and receive the wide IO_PREVIEW_BYTES
 * budget. Non-IO attributes stay at the existing 2 KB cap.
 */
export const IO_ATTR_KEYS = new Set([
  "langwatch.input",
  "langwatch.output",
  "gen_ai.input.messages",
  "gen_ai.output.messages",
]);

/**
 * Server-internal namespace prefix used by `leanForProjection` to attach eventref pointers
 * (carrying `{ field }`) alongside lean attribute previews. Client-supplied attributes in
 * the `langwatch.reserved.*` namespace are stripped at command-worker ingestion.
 */
export const EVENTREF_ATTR_PREFIX = "langwatch.reserved.eventref.";

/**
 * Rewrites over-threshold IO attribute values to a preview (≤ IO_PREVIEW_BYTES) and attaches
 * a `langwatch.reserved.eventref.<attrKey>` pointer carrying `{ field: <attrKey> }`.
 *
 * - SpanReceived: for each IO attr in IO_ATTR_KEYS that exceeds IO_PREVIEW_BYTES bytes,
 *   replaces the value with a UTF-8-safe preview and attaches an eventref.
 * - LogRecordReceived: if body exceeds IO_PREVIEW_BYTES bytes, replaces body with preview
 *   and attaches eventref.body.
 * - Other event types: pass through unchanged (no-op).
 *
 * @param _event - The event to lean.
 * @returns A new event with IO attributes replaced by previews + eventrefs, or the original
 *   event if no leaning was necessary.
 *
 * @throws {Error} "not implemented — ADR-022 step 5" until production logic is filled in.
 */
export function leanForProjection(_event: Event): Event {
  throw new Error("not implemented — ADR-022 step 5");
}

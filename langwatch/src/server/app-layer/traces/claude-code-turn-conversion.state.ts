/**
 * Conversion state for the INCREMENTAL Claude Code turn -> span converter.
 *
 * The span-sync reactor folds a turn's marked logs into spans in bounded batches
 * (limit = CLAUDE_TURN_LOG_CAP per fetch) so a turn of ANY size converts fully
 * while each reactor pass stays O(new records). Between batches the reactor
 * persists this state in Redis, keyed per (tenantId, traceId). The next batch is
 * fetched strictly after {@link ClaudeTurnConversionState.cursor} and converted
 * with this state, which carries exactly what a later record needs from earlier
 * ones:
 *
 *   - `carryRecords`  the minimal claude log records whose spans could still
 *                     change: an anchor still missing its request/response body,
 *                     an orphan body/response awaiting its anchor, and a
 *                     tool_decision / tool_result whose span is not yet complete
 *                     (its output is recovered from a LATER model call's request
 *                     body, which may land in a future batch). Re-emitting these
 *                     from the carry set is what completes a cross-batch join; the
 *                     deterministic span ids + completeness nudge make the later,
 *                     more complete emission win the stored_spans RMT dedup.
 *   - `promptTextById` the clean user-typed prompt per `prompt.id`, lifted from a
 *                     `user_prompt` record in an earlier batch so a later model
 *                     call whose request body claude truncated inline still shows
 *                     the turn's input.
 *   - root accumulators (`rootStartMs`, `rootInput`, `lastAssistantResponse`,
 *                     `sessionId`, `rootProvenance`) so the root agent span is
 *                     re-emitted every pass, enveloping the growing turn.
 *
 * SIZE IS LOAD-BEARING. This blob is written to Redis on every batch, so it must
 * stay small: the carry set is capped, the prompt map is capped, and the two
 * text fields are byte-bounded. {@link serializeClaudeTurnConversionState}
 * enforces every bound before the value leaves this module.
 *
 * Corrupt / missing state === start from zero. A lost state re-converts the turn
 * from the first record (the reactor resets the cursor to zero on a missing /
 * unparseable blob); the spans upsert over themselves by their deterministic ids,
 * so the redraw is idempotent. That full-redraw-on-lost-state property is the
 * correctness backstop for every partial-state edge, and is asserted directly in
 * the equivalence + state-loss tests.
 */

import { z } from "zod";

import { capPayloadString } from "~/server/event-sourcing/pipelines/trace-processing/utils/capOversizedLogRecord";
import type { ClaudeCodeLogRecordInput } from "./claude-code-log-to-span";

/**
 * Max records carried between batches. A carried record is an anchor / body /
 * response / tool event still awaiting a cross-batch join partner; in a healthy
 * turn only a handful straddle any single batch boundary. The bound keeps a
 * pathological turn from parking an unbounded carry set in Redis; when it bites,
 * the OLDEST carried records are dropped (a very stale unpaired half is the
 * least likely to ever complete), which at worst leaves one span missing a part
 * until the full-redraw path reconverges.
 */
export const MAX_CARRY_RECORDS = 64;

/**
 * Max `prompt.id -> text` entries kept in state. A turn has one user prompt in
 * the common case; the bound tolerates a handful of prompt ids across a turn's
 * model calls without letting the map grow with the turn.
 */
export const MAX_PROMPT_TEXT_ENTRIES = 16;

/**
 * Byte bound on the root input and the last-assistant-response fields held in
 * state (8KB each). The rendered root span still caps these through
 * capPayloadString at emit; this second, smaller bound keeps the persisted blob
 * compact regardless of the emit-time cap.
 */
export const MAX_STATE_TEXT_BYTES = 8 * 1024;

/**
 * A claude log record reduced to what the carry set needs to re-run a join: the
 * span id (load-bearing, a model span's deterministic id IS its anchor's own
 * span id, so a carried anchor must keep it to upsert the same span on re-emit),
 * the ordering keys, the event identity, and the attribute bag (which already
 * carries the body payloads, model, request_id, tool_use_id, …). Resource +
 * scope are dropped from the carry set to keep it small, a re-emitted carried
 * span inherits resource/scope from the current batch via the builders'
 * fallbacks, and the authoritative provenance rides on the span the batch that
 * OWNS the record already emitted.
 */
export interface CarriedClaudeRecord {
  spanId: string;
  timeUnixMs: number;
  eventName: string;
  attrs: Record<string, string>;
}

/** The last converted record's order key (matches the repository ORDER BY). */
export interface ClaudeTurnCursor {
  timeUnixMs: number;
  sequence: number;
}

/** Root-span accumulators carried across batches (all scalar / bounded). */
export interface ClaudeTurnRootState {
  /** Earliest record time seen, so the root envelope starts no later. */
  startMs: number;
  /**
   * Latest child end time seen across all batches, so the root envelope ends no
   * earlier as the turn grows (a later batch may bring an earlier-ending span,
   * so the end must accumulate rather than be re-derived per batch).
   */
  endMs: number;
  /** The user prompt text (bounded), the root's input. */
  input: string | null;
  /** The latest genuine assistant reply text (bounded), for observability. */
  lastAssistantResponse: string | null;
  /** The turn's session id, lifted to conversation.id + thread.id on the root. */
  sessionId: string | null;
  /** user_prompt provenance attrs (command_name, prompt_length, …), bounded. */
  provenance: Record<string, string>;
  /** Count of model-call anchors converted so far (for future root attrs). */
  modelCallCount: number;
  /** Count of tool spans converted so far (for future root attrs). */
  toolCallCount: number;
}

/** Persisted per-(tenantId, traceId) incremental conversion state. */
export interface ClaudeTurnConversionState {
  cursor: ClaudeTurnCursor;
  carryRecords: CarriedClaudeRecord[];
  promptTextById: Record<string, string>;
  root: ClaudeTurnRootState;
}

const cursorSchema = z.object({
  timeUnixMs: z.number(),
  sequence: z.number(),
});

const carriedRecordSchema = z.object({
  spanId: z.string(),
  timeUnixMs: z.number(),
  eventName: z.string(),
  attrs: z.record(z.string()),
});

const rootStateSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
  input: z.string().nullable(),
  lastAssistantResponse: z.string().nullable(),
  sessionId: z.string().nullable(),
  provenance: z.record(z.string()),
  modelCallCount: z.number(),
  toolCallCount: z.number(),
});

export const claudeTurnConversionStateSchema = z.object({
  cursor: cursorSchema,
  carryRecords: z.array(carriedRecordSchema),
  promptTextById: z.record(z.string()),
  root: rootStateSchema,
});

/** The zero state a fresh (or lost-state) conversion starts from. */
export function emptyClaudeTurnConversionState(): ClaudeTurnConversionState {
  return {
    cursor: { timeUnixMs: 0, sequence: 0 },
    carryRecords: [],
    promptTextById: {},
    root: {
      startMs: Number.POSITIVE_INFINITY,
      endMs: Number.NEGATIVE_INFINITY,
      input: null,
      lastAssistantResponse: null,
      sessionId: null,
      provenance: {},
      modelCallCount: 0,
      toolCallCount: 0,
    },
  };
}

/** A carried record projected back into the converter's full record shape. */
export function carriedToRecord(
  carried: CarriedClaudeRecord,
  traceId: string,
): ClaudeCodeLogRecordInput {
  return {
    traceId,
    // The span id is preserved from the owning batch so a re-emitted carried
    // anchor upserts the SAME model span (its id is the anchor's own span id). A
    // carried body/response keeps its id too but is never emitted on its own , 
    // it only contributes to the eventual span once its anchor is in the batch.
    spanId: carried.spanId,
    timeUnixMs: carried.timeUnixMs,
    eventName: carried.eventName,
    attrs: carried.attrs,
    resource: null,
    instrumentationScope: null,
  };
}

/** Reduce a full record to the compact carry shape. */
export function recordToCarried(
  record: ClaudeCodeLogRecordInput,
): CarriedClaudeRecord {
  return {
    spanId: record.spanId,
    timeUnixMs: record.timeUnixMs,
    eventName: record.eventName,
    attrs: record.attrs,
  };
}

const boundText = (value: string | null): string | null =>
  value === null
    ? null
    : capPayloadString(value, MAX_STATE_TEXT_BYTES, "claude_state");

/**
 * Enforce every size bound and JSON-serialize the state for Redis. Applying the
 * bounds here (not at the mutation sites) guarantees no oversized blob ever
 * leaves the module regardless of how the core built the state.
 *
 * When the carry set overflows, the OLDEST records are dropped (kept suffix), on
 * the reasoning that a very stale unpaired half is the least likely to complete;
 * the prompt map keeps its first {@link MAX_PROMPT_TEXT_ENTRIES}.
 */
export function serializeClaudeTurnConversionState(
  state: ClaudeTurnConversionState,
): string {
  const carryRecords =
    state.carryRecords.length > MAX_CARRY_RECORDS
      ? state.carryRecords.slice(state.carryRecords.length - MAX_CARRY_RECORDS)
      : state.carryRecords;

  const promptEntries = Object.entries(state.promptTextById).slice(
    0,
    MAX_PROMPT_TEXT_ENTRIES,
  );
  const promptTextById: Record<string, string> = {};
  for (const [key, value] of promptEntries) promptTextById[key] = value;

  const bounded: ClaudeTurnConversionState = {
    cursor: state.cursor,
    carryRecords,
    promptTextById,
    root: {
      ...state.root,
      // +/-Infinity is not valid JSON; a not-yet-established start/end persists a
      // sentinel 0 that the next load restores to the Infinity sentinel the core
      // envelopes with (re-derived from the batch).
      startMs: Number.isFinite(state.root.startMs) ? state.root.startMs : 0,
      endMs: Number.isFinite(state.root.endMs) ? state.root.endMs : 0,
      input: boundText(state.root.input),
      lastAssistantResponse: boundText(state.root.lastAssistantResponse),
    },
  };
  return JSON.stringify(bounded);
}

/**
 * Parse a persisted state blob back into a {@link ClaudeTurnConversionState}, or
 * null when the value is missing / unparseable / fails the schema. A null return
 * is the reactor's cue to reset the cursor to zero and re-convert the turn from
 * the start (idempotent full redraw), corrupt state is never trusted.
 */
export function deserializeClaudeTurnConversionState(
  raw: string | null | undefined,
): ClaudeTurnConversionState | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = claudeTurnConversionStateSchema.safeParse(parsed);
  if (!result.success) return null;
  // A persisted 0 start/end means "not yet established"; restore the Infinity
  // sentinels the core envelopes with so a re-emit does not clamp the root
  // envelope to the epoch.
  const root = result.data.root;
  return {
    ...result.data,
    root: {
      ...root,
      startMs: root.startMs > 0 ? root.startMs : Number.POSITIVE_INFINITY,
      endMs: root.endMs > 0 ? root.endMs : Number.NEGATIVE_INFINITY,
    },
  };
}

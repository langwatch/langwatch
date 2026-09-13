import type { Cluster, Redis } from "ioredis";
import { isCodexScope } from "./coding-agent-span-filter";

/**
 * Codex helper threads.
 *
 * Codex 0.154's TUI generates the thread title (and the recap) on a hidden
 * thread of its own: `tui/src/app/thread_title.rs` starts one through
 * `tui/src/temporary_structured_request.rs`, which asks the in-process
 * app-server for a thread with `ephemeral: true`, `thread_source:
 * Feature("system")`, no tools and read-only permissions, runs one structured
 * turn on it and unsubscribes. The thread has a thread id of its own and
 * exports through the same `[otel]` exporters as the session it serves, so
 * without this module every title generation lands as a second session with
 * one turn, a withheld prompt and no title.
 *
 * Nothing on the helper's `session_task.turn` span or its log events names
 * the thread it serves, and nothing on them says it is a helper: the session
 * source that would (`SessionTelemetryMetadata.session_source`) reaches
 * codex's metric tags only. What codex does state is on the app-server
 * request spans, which it exports too. `temporary_structured_request.rs`
 * mints every request id for these threads with one prefix:
 *
 *   - `thread/start`       `temporary-structured-<uuid>`
 *   - `turn/start`         `temporary-structured-turn-<uuid>`
 *   - `thread/unsubscribe` `temporary-structured-unsubscribe-<uuid>`
 *
 * and stamps it as `rpc.request_id` on the request span (a user-driven
 * `turn/start` carries the TUI's own request counter, `"5"`). The `turn/start`
 * span is the ROOT of the same trace the helper's `session_task.turn` lands
 * in, so trace id is the join. The request spans are infrastructure noise and
 * stay filtered (`coding-agent-span-filter.ts`); what they say about their
 * trace is remembered here and stamped onto the turn span, which codex exports
 * in a later batch (the request returns once the turn is dispatched; the turn
 * span ends when the model answers).
 *
 * The memo is Redis-backed because those two batches can land on different
 * pods. Ordering holds by construction: codex's batch exporter sends spans in
 * end order, one request at a time, and the request span ends before the turn
 * span starts its model call.
 */

/**
 * The stamp a span of an auxiliary trace carries. The coding-agent session
 * fold lifts it as a fact and marks the session, and the Sessions list omits
 * marked sessions.
 */
export const AUXILIARY_SESSION_ATTR = "langwatch.session.auxiliary";

const TEMPORARY_STRUCTURED_REQUEST_ID_PREFIX = "temporary-structured-";

/**
 * How long an auxiliary trace is remembered for its remaining spans.
 *
 * The same 31 days ingestion accepts a span's start time from
 * (`SPAN_MAX_PAST_MS` in `trace-request-collection.service.ts`, pinned to this
 * constant by the module's unit test). The request span and the turn span it
 * marks normally land seconds apart, but nothing in the exporter contract
 * bounds the delay between two batches, and a memo that expired first would
 * store the turn unmarked and let the helper thread list as a session. Any
 * span that arrives late enough for the memo to be gone is a span ingestion
 * rejects anyway.
 */
export const AUXILIARY_TRACE_MEMO_TTL_SECONDS = 31 * 24 * 60 * 60;

/**
 * Whether a codex span is one of the app-server request spans codex's
 * temporary structured request helper issues. Scope-gated: the request id
 * shape is codex's own, and a foreign span reusing it must not mark a trace.
 */
export function isCodexTemporaryStructuredRequestSpan({
  scopeName,
  attributes,
}: {
  scopeName: string | null | undefined;
  attributes: Record<string, unknown>;
}): boolean {
  if (!isCodexScope(scopeName)) return false;
  const requestId = attributes["rpc.request_id"];
  return (
    typeof requestId === "string" &&
    requestId.startsWith(TEMPORARY_STRUCTURED_REQUEST_ID_PREFIX)
  );
}

export interface AuxiliaryTraceMemo {
  mark(params: { tenantId: string; traceId: string }): Promise<void>;
  has(params: { tenantId: string; traceId: string }): Promise<boolean>;
}

const memoKey = ({
  tenantId,
  traceId,
}: {
  tenantId: string;
  traceId: string;
}): string => `coding-agent:auxiliary-trace:${tenantId}:${traceId}`;

export class RedisAuxiliaryTraceMemo implements AuxiliaryTraceMemo {
  constructor(private readonly redis: Redis | Cluster) {}

  async mark({
    tenantId,
    traceId,
  }: {
    tenantId: string;
    traceId: string;
  }): Promise<void> {
    await this.redis.set(
      memoKey({ tenantId, traceId }),
      "1",
      "EX",
      AUXILIARY_TRACE_MEMO_TTL_SECONDS,
    );
  }

  async has({
    tenantId,
    traceId,
  }: {
    tenantId: string;
    traceId: string;
  }): Promise<boolean> {
    return (await this.redis.exists(memoKey({ tenantId, traceId }))) === 1;
  }
}

/** For tests and for a process with no Redis. */
export class InMemoryAuxiliaryTraceMemo implements AuxiliaryTraceMemo {
  private readonly marked = new Set<string>();

  async mark({
    tenantId,
    traceId,
  }: {
    tenantId: string;
    traceId: string;
  }): Promise<void> {
    this.marked.add(memoKey({ tenantId, traceId }));
  }

  async has({
    tenantId,
    traceId,
  }: {
    tenantId: string;
    traceId: string;
  }): Promise<boolean> {
    return this.marked.has(memoKey({ tenantId, traceId }));
  }
}

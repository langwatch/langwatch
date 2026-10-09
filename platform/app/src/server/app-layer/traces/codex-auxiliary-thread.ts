import type { OtlpSpan } from "../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { TraceRequestUtils } from "../../event-sourcing/pipelines/trace-processing/utils/traceRequest.utils";
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
 * `turn/start` carries the TUI's own request counter, `"5"`). The request
 * span names no thread, but its `app_server.serialized_request_queue` child
 * does: `key = Thread { thread_id: "<uuid>" }`, and the two end together, so
 * codex's batch exporter sends them in one batch. That is the join: the
 * helper's thread id is read off the child in the same batch and stamped on
 * the request span as `langwatch.thread.id`, which is what lets the request
 * span through the noise filter and gives the coding-agent session fold a
 * contribution keyed by the helper's thread id. The fold absorbs facts in any
 * order, so the helper's turn span and log events, exported in other batches,
 * need no stamp of their own.
 */

/**
 * The fact a helper thread's request span contributes to its session. The
 * fold sets a sticky flag from it, and the Sessions list omits marked
 * sessions.
 */
export const AUXILIARY_SESSION_FACT = "langwatch.session.auxiliary";

/**
 * Where the helper's thread id lands on its request span. The same key the
 * codex extractor sets for the session on every other codex record, so the
 * span reads as the thread's on every surface.
 */
export const HELPER_THREAD_ID_ATTR = "langwatch.thread.id";

const TEMPORARY_STRUCTURED_REQUEST_ID_PREFIX = "temporary-structured-";

/** The child of an app-server request span that names the thread it queued on. */
const REQUEST_QUEUE_SPAN_NAME = "app_server.serialized_request_queue";

/** `Thread { thread_id: "01a0…" }`, as codex's Debug formatting spells it. */
const QUEUE_KEY_THREAD_ID =
  /thread_id: "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/;

/**
 * Whether a codex span is one of the app-server request spans codex's
 * temporary structured request helper issues. Scope-gated: the request id
 * shape is codex's own, and a foreign span reusing it must not mark a thread.
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

function stringAttributes(span: OtlpSpan): Record<string, unknown> {
  return Object.fromEntries(
    span.attributes.map((a) => [a.key, a.value.stringValue]),
  );
}

/** The parsed spans of one instrumentation scope entry of an export request. */
export type ScopedSpans = {
  scopeName: string | null | undefined;
  spans: OtlpSpan[];
};

/**
 * The helper thread each temporary structured request span in one export
 * request was issued for, keyed by the request span's id: the request span
 * carries the mark, its queue child carries the thread id. The mark is
 * scope-gated per entry, the child is matched by parent id across every
 * entry of the request, so a pair the exporter splits over two scope entries
 * still joins. A request span whose child is not in the request maps to
 * nothing, and the helper then lists as a session, which is the failure
 * before this module rather than a wrong attribution.
 */
export function codexHelperThreadMarkersOf({
  scopes,
}: {
  scopes: ScopedSpans[];
}): Map<string, string> {
  const markers = new Map<string, string>();
  const requestSpanIds = temporaryStructuredRequestSpanIdsOf(scopes);
  if (requestSpanIds.size === 0) return markers;

  for (const span of scopes.flatMap((scope) => scope.spans)) {
    if (span.name !== REQUEST_QUEUE_SPAN_NAME || !span.parentSpanId) continue;
    const parentId = TraceRequestUtils.normalizeOtlpId(span.parentSpanId);
    if (!requestSpanIds.has(parentId)) continue;
    const threadId = queuedThreadIdOf(span);
    if (threadId) markers.set(parentId, threadId);
  }
  return markers;
}

/** The ids of the temporary structured request spans in one export request. */
function temporaryStructuredRequestSpanIdsOf(
  scopes: ScopedSpans[],
): Set<string> {
  const ids = new Set<string>();
  for (const { scopeName, spans } of scopes) {
    if (!isCodexScope(scopeName)) continue;
    for (const span of spans) {
      const attributes = stringAttributes(span);
      if (isCodexTemporaryStructuredRequestSpan({ scopeName, attributes })) {
        ids.add(TraceRequestUtils.normalizeOtlpId(span.spanId));
      }
    }
  }
  return ids;
}

/** The thread id a queue child names, off its Debug-formatted `key`. */
function queuedThreadIdOf(span: OtlpSpan): string | undefined {
  const key = stringAttributes(span).key;
  if (typeof key !== "string") return undefined;
  return QUEUE_KEY_THREAD_ID.exec(key)?.[1];
}

export function stampCodexHelperThread({
  span,
  threadId,
}: {
  span: OtlpSpan;
  threadId: string;
}): OtlpSpan {
  return {
    ...span,
    attributes: [
      ...span.attributes,
      { key: HELPER_THREAD_ID_ATTR, value: { stringValue: threadId } },
    ],
  };
}

export function codexAuxiliarySessionFacts({
  scopeName,
  attributes,
}: {
  scopeName: string | null | undefined;
  attributes: Record<string, unknown>;
}): Record<string, boolean> {
  return isCodexTemporaryStructuredRequestSpan({ scopeName, attributes })
    ? { [AUXILIARY_SESSION_FACT]: true }
    : {};
}

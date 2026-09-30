import { isCodexScope } from "./coding-agent-span-filter.ts";

/**
 * Codex helper threads: the TUI's title generator and recap run on a hidden thread of their own.
 * Only the app-server request span names it, by a `temporary-structured-` request id, and the
 * thread id sits on its `app_server.serialized_request_queue` child, in the same export batch.
 */

/** The fact a helper thread's request span contributes; the fold keeps it as a sticky flag. */
export const AUXILIARY_SESSION_FACT = "langwatch.session.auxiliary";

/** Where the helper's thread id lands on its request span, as on every other codex record. */
export const HELPER_THREAD_ID_ATTR = "langwatch.thread.id";

/** The child of an app-server request span that names the thread it queued on. */
export const REQUEST_QUEUE_SPAN_NAME = "app_server.serialized_request_queue";

const TEMPORARY_STRUCTURED_REQUEST_ID_PREFIX = "temporary-structured-";

/** `Thread { thread_id: "01a0…" }`, as codex's Debug formatting spells it. */
const QUEUE_KEY_THREAD_ID =
  /thread_id: "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/;

/** Scope-gated: the request id shape is codex's own; a foreign span reusing it marks nothing. */
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
    typeof requestId === "string" && requestId.startsWith(TEMPORARY_STRUCTURED_REQUEST_ID_PREFIX)
  );
}

/** The thread id a queue child names, read off its Debug-formatted `key` attribute. */
export function queuedThreadIdOf({ key }: { key: unknown }): string | undefined {
  return typeof key === "string" ? QUEUE_KEY_THREAD_ID.exec(key)?.[1] : undefined;
}

/** The session fact a codex helper thread's request span contributes, or none. */
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

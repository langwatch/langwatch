function isChatMessage(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Remove the given message roles (and optionally assistant `tool_calls`) from a
 * conversation serialized as JSON. Handles the LangWatch
 * `{ type: "chat_messages", value: [...] }` wrapper and a bare messages array.
 * Returns the rewritten JSON and how many messages/tool-call sets were removed,
 * or `null` when the value is not a conversation (left untouched, never thrown).
 *
 * Pure, so it lives in the contract: the ingestion drop policy and the trace
 * read mappers both strip through it, and neither side needs the other's
 * server package to do so.
 */
export function stripRolesFromChatArrayJson(
  json: string,
  roles: ReadonlySet<string>,
  stripToolCalls: boolean,
): { json: string; removed: number } | null {
  if (roles.size === 0 && !stripToolCalls) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  let messages: unknown[];
  let rewrap: (next: unknown[]) => unknown;
  if (Array.isArray(parsed)) {
    messages = parsed;
    rewrap = (next) => next;
  } else if (isChatMessage(parsed) && Array.isArray((parsed as { value?: unknown }).value)) {
    messages = (parsed as { value: unknown[] }).value;
    rewrap = (next) => ({ ...parsed, value: next });
  } else {
    return null;
  }

  let removed = 0;
  const next: unknown[] = [];
  for (const message of messages) {
    const role = isChatMessage(message) ? message.role : undefined;
    if (typeof role === "string" && roles.has(role)) {
      removed++;
      continue;
    }

    if (stripToolCalls && isChatMessage(message) && message.tool_calls != null) {
      const { tool_calls: _dropped, ...rest } = message;
      removed++;
      next.push(rest);
      continue;
    }

    next.push(message);
  }

  if (removed === 0) {
    return null;
  }

  return { json: JSON.stringify(rewrap(next)), removed };
}

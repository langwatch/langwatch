function isChatMessage(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stripMessages({
  messages,
  roles,
  stripToolCalls,
}: {
  messages: unknown[];
  roles: ReadonlySet<string>;
  stripToolCalls: boolean;
}): { next: unknown[]; removed: number } {
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
  return { next, removed };
}

/**
 * Remove message roles (and optionally assistant tool_calls) from JSON chat
 * conversations. Returns rewritten JSON and removal count, or null if not a
 * conversation. Pure contract function used by ingestion and read paths.
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

  const { next, removed } = stripMessages({ messages, roles, stripToolCalls });
  if (removed === 0) {
    return null;
  }

  return { json: JSON.stringify(rewrap(next)), removed };
}

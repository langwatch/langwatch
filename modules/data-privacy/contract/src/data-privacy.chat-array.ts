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
 * conversations. `unchanged` when it is not a conversation or nothing was removed.
 * Pure contract function used by ingestion and read paths.
 */
export type ChatArrayRoleStrip =
  | { kind: "stripped"; json: string; removed: number }
  | { kind: "unchanged" };

export function stripRolesFromChatArrayJson(
  json: string,
  roles: ReadonlySet<string>,
  stripToolCalls: boolean,
): ChatArrayRoleStrip {
  if (roles.size === 0 && !stripToolCalls) {
    return { kind: "unchanged" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { kind: "unchanged" };
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
    return { kind: "unchanged" };
  }

  const { next, removed } = stripMessages({ messages, roles, stripToolCalls });
  if (removed === 0) {
    return { kind: "unchanged" };
  }

  return { kind: "stripped", json: JSON.stringify(rewrap(next)), removed };
}

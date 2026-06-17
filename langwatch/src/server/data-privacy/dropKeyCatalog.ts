import {
  type CompiledAttributeMatcher,
  compileAttributePatterns,
  matchesAnyAttributePattern,
} from "./attributePatternMatcher";
import {
  CONTENT_CATEGORIES,
  type ContentCategory,
  type ResolvedDataPrivacy,
} from "./dataPrivacy.types";

/**
 * The built-in span-attribute keys that carry each content category. When a
 * category is set to `drop`, every key in its set is stripped before the span is
 * stored. Seeded from the OpenTelemetry GenAI conventions plus the vendor
 * dialects LangWatch ingests (Vercel AI SDK, OpenInference, Traceloop) and the
 * LangWatch-canonicalised `langwatch.input`/`langwatch.output`. Metadata keys
 * (tokens, cost, model, latency, ids, names, status) are deliberately absent, so
 * they always survive a drop.
 */
export const CONTENT_KEY_CATALOG: Record<ContentCategory, readonly string[]> = {
  input: [
    "gen_ai.input.messages",
    "gen_ai.prompt",
    "ai.prompt",
    "ai.prompt.messages",
    "llm.input_messages",
    "langwatch.input",
    "input",
    "input.value",
    "raw_input",
    "traceloop.entity.input",
  ],
  output: [
    "gen_ai.output.messages",
    "gen_ai.completion",
    "ai.response",
    "ai.response.text",
    "ai.response.object",
    "llm.output_messages",
    "langwatch.output",
    "output",
    "output.value",
    "traceloop.entity.output",
  ],
  system: ["gen_ai.system_instructions"],
  tools: [
    "gen_ai.tool.call.arguments",
    "gen_ai.tool.call.result",
    "ai.toolCall",
    "ai.toolCall.args",
  ],
};

/**
 * System instructions and tool calls do not only live in their own attributes
 * (`gen_ai.system_instructions`, `gen_ai.tool.call.*`); they also ride inside the
 * captured input/output conversation as chat messages with `role: "system"` or
 * `role: "tool"`, and as `tool_calls` on assistant messages. Canonicalization
 * (which runs AFTER the drop) re-derives `gen_ai.system_instructions` from that
 * conversation, so dropping the key alone is not enough: the role has to be
 * stripped from the conversation arrays too, or the content survives.
 */
const ROLE_BASED_CATEGORY_ROLES: Partial<
  Record<ContentCategory, readonly string[]>
> = {
  system: ["system"],
  tools: ["tool", "function"],
};

/** Catalog keys whose value is a chat-message conversation (input and output). */
export const CHAT_ARRAY_KEYS: ReadonlySet<string> = new Set([
  ...CONTENT_KEY_CATALOG.input,
  ...CONTENT_KEY_CATALOG.output,
]);

/**
 * For a resolved policy, the message roles to remove from conversation arrays and
 * whether assistant `tool_calls` should be stripped, derived from which
 * role-based categories (`system`, `tools`) are set to `drop`.
 */
export function rolesDroppedFromChatArrays(policy: ResolvedDataPrivacy): {
  roles: Set<string>;
  stripToolCalls: boolean;
} {
  const roles = new Set<string>();
  let stripToolCalls = false;
  for (const category of CONTENT_CATEGORIES) {
    const categoryRoles = ROLE_BASED_CATEGORY_ROLES[category];
    if (categoryRoles && policy.categories[category].disposition === "drop") {
      for (const role of categoryRoles) roles.add(role);
      if (category === "tools") stripToolCalls = true;
    }
  }
  return { roles, stripToolCalls };
}

function isChatMessage(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Remove the given message roles (and optionally assistant `tool_calls`) from a
 * conversation serialized as JSON. Handles the LangWatch
 * `{ type: "chat_messages", value: [...] }` wrapper and a bare messages array.
 * Returns the rewritten JSON and how many messages/tool-call sets were removed,
 * or `null` when the value is not a conversation (left untouched, never thrown).
 */
export function stripRolesFromChatArrayJson(
  json: string,
  roles: ReadonlySet<string>,
  stripToolCalls: boolean,
): { json: string; removed: number } | null {
  if (roles.size === 0 && !stripToolCalls) return null;

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
  } else if (
    isChatMessage(parsed) &&
    Array.isArray((parsed as { value?: unknown }).value)
  ) {
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
    if (
      stripToolCalls &&
      isChatMessage(message) &&
      message.tool_calls != null
    ) {
      const { tool_calls: _dropped, ...rest } = message;
      removed++;
      next.push(rest);
      continue;
    }
    next.push(message);
  }

  if (removed === 0) return null;
  return { json: JSON.stringify(rewrap(next)), removed };
}

/** Marker stamped on a span whose content was dropped, so the UI can explain it. */
export const PRIVACY_DROPPED_MARKER_ATTR = "langwatch.privacy.dropped";

/**
 * Marker stamped on a span whose attributes were dropped by custom attribute
 * rules, listing the dropped key NAMES (never the values) so the trace view can
 * explain the absence. Capped to keep the marker small.
 */
export const PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR =
  "langwatch.privacy.dropped_attributes";
export const DROPPED_ATTRIBUTES_MARKER_MAX_KEYS = 20;

/**
 * The attribute keys dropped by `drop` CATEGORIES for a resolved policy: every
 * key of each `drop` category's built-in set. Custom attribute rules are
 * matched separately via `computeDropMatchers` (they support wildcards).
 */
export function computeDroppedKeys(policy: ResolvedDataPrivacy): Set<string> {
  const keys = new Set<string>();
  for (const category of CONTENT_CATEGORIES) {
    if (policy.categories[category].disposition === "drop") {
      for (const key of CONTENT_KEY_CATALOG[category]) keys.add(key);
    }
  }
  return keys;
}

/** Compiled matchers for the policy's `drop`-disposition custom attribute rules. */
export function computeDropMatchers(
  policy: ResolvedDataPrivacy,
): CompiledAttributeMatcher[] {
  return compileAttributePatterns(
    policy.customAttributes
      .filter((rule) => rule.disposition === "drop")
      .map((rule) => rule.pattern),
  );
}

/** The categories currently set to `drop`, for the span marker / observability. */
export function droppedCategories(
  policy: ResolvedDataPrivacy,
): ContentCategory[] {
  return CONTENT_CATEGORIES.filter(
    (c) => policy.categories[c].disposition === "drop",
  );
}

/**
 * Return a copy of an attribute map with every dropped key removed (exact
 * catalog keys plus wildcard custom matchers), how many keys were stripped, and
 * which keys the custom matchers removed. The input is not mutated.
 */
export function stripDroppedAttributes(
  attributes: Record<string, unknown>,
  droppedKeys: Set<string>,
  dropMatchers: CompiledAttributeMatcher[] = [],
): {
  attributes: Record<string, unknown>;
  droppedCount: number;
  droppedAttributeKeys: string[];
} {
  if (droppedKeys.size === 0 && dropMatchers.length === 0) {
    return { attributes, droppedCount: 0, droppedAttributeKeys: [] };
  }
  let droppedCount = 0;
  const droppedAttributeKeys: string[] = [];
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (droppedKeys.has(key)) {
      droppedCount++;
      continue;
    }
    if (matchesAnyAttributePattern(key, dropMatchers)) {
      droppedCount++;
      droppedAttributeKeys.push(key);
      continue;
    }
    next[key] = value;
  }
  return { attributes: next, droppedCount, droppedAttributeKeys };
}

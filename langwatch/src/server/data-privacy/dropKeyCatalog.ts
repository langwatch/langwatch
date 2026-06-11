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

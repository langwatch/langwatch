/**
 * Content-block cost taxonomy (ADR-033, Decision 3).
 *
 * Two axes — input and output — each a fixed set of categories plus a
 * catch-all. Values are frozen wire strings: they are fold keys, span
 * attribute values, and dashboard lanes, so growth is additive only and a
 * shipped value is never renamed (ADR-033 Constants: CATEGORY_ENUM).
 *
 * Internal constants, no external input — `as const` object + derived union,
 * no Zod (house rule).
 */

export const InputCategory = {
  SYSTEM_PROMPT: "system_prompt",
  USER_INPUT: "user_input",
  PRIOR_CONTEXT: "prior_context",
  TOOL_RESULT_BUILTIN: "tool_result_builtin",
  TOOL_RESULT_MCP: "tool_result_mcp",
  TOOL_DEFINITIONS: "tool_definitions",
  MCP_TOOL_DEFINITIONS: "mcp_tool_definitions",
  SKILL_CONTENT: "skill_content",
  MEMORY_CONTEXT: "memory_context",
  FILE_ATTACHMENT: "file_attachment",
  IMAGE: "image",
  OTHER_INPUT: "other_input",
} as const;

export const OutputCategory = {
  ASSISTANT_TEXT: "assistant_text",
  TOOL_CALL_BUILTIN: "tool_call_builtin",
  TOOL_CALL_MCP: "tool_call_mcp",
  SKILL_INVOCATION: "skill_invocation",
  THINKING: "thinking",
  OTHER_OUTPUT: "other_output",
} as const;

export type InputCategory = (typeof InputCategory)[keyof typeof InputCategory];
export type OutputCategory =
  (typeof OutputCategory)[keyof typeof OutputCategory];
export type Category = InputCategory | OutputCategory;

export type Axis = "input" | "output";

/** The catch-all category for an axis — receives unattributable tokens so
 * per-category totals always reconcile to provider truth (ADR-033 Decision 2.4). */
export function catchAllFor(axis: Axis): Category {
  return axis === "input"
    ? InputCategory.OTHER_INPUT
    : OutputCategory.OTHER_OUTPUT;
}

/** Built-in vs MCP discrimination on tool names (Claude Code wire convention). */
export const MCP_TOOL_PREFIX = "mcp__";

/** Hard bound on the per-span detail array; overflow blocks aggregate into the
 * axis catch-all so category totals stay complete even when detail is truncated. */
export const MAX_CLASSIFIED_BLOCKS_PER_SPAN = 512;

/** Which heuristic set produced these categories — replay/audit (ADR-015). */
export const CLASSIFIER_VERSION = 1;

/** Per-block detail attribute on spans. The `reserved` prefix is mandatory:
 * it is the only namespace `stripReservedAttributes` scrubs from ingested SDK
 * spans, so system-computed classifications cannot be spoofed. */
export const SPAN_ATTR_BLOCKS = "langwatch.reserved.blocks.classification";
export const SPAN_ATTR_CLASSIFIER_VERSION =
  "langwatch.reserved.blocks.classifier_version";

/** Prefix for the per-category running-total span attributes the trace fold
 * rolls up (`langwatch.reserved.blockcat.<category>.tokens` / `.cost_usd`).
 * `reserved` prefix required — spoof protection via `stripReservedAttributes`. */
export const SPAN_ATTR_BLOCKCAT_PREFIX = "langwatch.reserved.blockcat.";

export function blockCategoryTokensAttr(category: Category): string {
  return `${SPAN_ATTR_BLOCKCAT_PREFIX}${category}.tokens`;
}

export function blockCategoryCostAttr(category: Category): string {
  return `${SPAN_ATTR_BLOCKCAT_PREFIX}${category}.cost_usd`;
}

/**
 * The span-side vocabulary the Claude Code log join reads: which `Span.params` keys carry the
 * identifiers it matches on, and the small readers that turn a raw attribute string into the
 * value it means. Pure, so the join and its tests share one spelling of each key.
 */

import type { Span } from "@langwatch/trace-contract";

/** Span attribute keys (unflattened onto `Span.params` by the span mapper). */
export const SPAN_REQUEST_ID_KEY = "request_id";
export const SPAN_QUERY_SOURCE_KEY = "query_source";
export const SPAN_TOOL_USE_ID_KEY = "tool_use_id";
export const SPAN_TOOL_CALL_ID_KEY = "gen_ai.tool.call.id";
export const SPAN_USER_PROMPT_KEY = "user_prompt";
/** The turn-root span every claude session emits per user prompt. */
export const INTERACTION_SPAN_NAME = "claude_code.interaction";
export const CLAUDE_SPAN_NAME_PREFIX = "claude_code.";

export function readStringParam(
  params: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = params?.[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

export function nonEmptyOrNull(value: string | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function spanToolUseId(span: Span): string | null {
  return (
    readStringParam(span.params, SPAN_TOOL_USE_ID_KEY) ??
    readStringParam(span.params, SPAN_TOOL_CALL_ID_KEY)
  );
}

export function isInteractionSpan(span: Span): boolean {
  return (
    span.name === INTERACTION_SPAN_NAME ||
    readStringParam(span.params, SPAN_USER_PROMPT_KEY) !== null
  );
}

export function parseBoolAttr(value: string | undefined): boolean | null {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}

export function parseNumberAttr(value: string | undefined): number | null {
  if (value === undefined || value.length === 0) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

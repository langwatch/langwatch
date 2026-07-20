import { CLAUDE_CODE_EVENT_SCOPE } from "./claude-code-log-events";

/**
 * Classification of Claude Code's log records, stamped at canonical ingest.
 *
 * Claude splits one model call across three log events and one tool run across
 * two, so the kind marking is how a reader finds "the records that make up
 * this turn" without re-deriving the event vocabulary. The marked rows are
 * the CONTENT source for the Terminal transcript and the read-time span
 * enrichment — they retain at full trace retention like any other log.
 * (An earlier design synthesized spans from these rows and could therefore
 * expire them after a day; that converter is gone, so no shortened retention
 * survives here.)
 */

/**
 * The three claude_code log events that describe one model call: the cost
 * anchor plus the raw request/response payloads.
 */
export const CLAUDE_CODE_CONVERTIBLE_EVENTS: ReadonlySet<string> = new Set([
  "api_request",
  "api_request_body",
  "api_response_body",
]);

/**
 * The two claude_code log events that describe one tool invocation:
 * `tool_decision` (the permission decision + source) and `tool_result` (the
 * terminal event carrying tool name, input, duration, success). Paired by
 * `tool_use_id` — both carry it.
 */
export const CLAUDE_CODE_TOOL_EVENTS: ReadonlySet<string> = new Set([
  "tool_decision",
  "tool_result",
]);

export function isClaudeCodeConvertibleLog(
  scopeName: string,
  eventName: string | undefined,
): boolean {
  return (
    scopeName === CLAUDE_CODE_EVENT_SCOPE &&
    eventName !== undefined &&
    CLAUDE_CODE_CONVERTIBLE_EVENTS.has(eventName)
  );
}

export function isClaudeCodeToolLog(
  scopeName: string,
  eventName: string | undefined,
): boolean {
  return (
    scopeName === CLAUDE_CODE_EVENT_SCOPE &&
    eventName !== undefined &&
    CLAUDE_CODE_TOOL_EVENTS.has(eventName)
  );
}

/**
 * Attribute the receiver stamps on every claude_code log it saves, valued by
 * {@link claudeCodeLogKind}. Lets the marked read find a turn's records by
 * one attribute-key match instead of re-listing the event vocabulary in SQL.
 */
export const CLAUDE_CODE_KIND_ATTR = "langwatch.claude_code.kind";

/**
 * The PII redaction level the receiver used at ingest, stamped on each saved
 * claude_code log so any later reader redacts derived output at the same
 * level the ingest path used (readers have no request context).
 */
export const CLAUDE_CODE_PII_ATTR = "langwatch.claude_code.pii";

/** The kind of fact a claude_code log record carries, or null for the rest. */
export function claudeCodeLogKind(
  scopeName: string,
  eventName: string | undefined,
): string | null {
  if (scopeName !== CLAUDE_CODE_EVENT_SCOPE || eventName === undefined) {
    return null;
  }
  if (CLAUDE_CODE_CONVERTIBLE_EVENTS.has(eventName)) return "model";
  if (CLAUDE_CODE_TOOL_EVENTS.has(eventName)) return "tool";
  if (eventName === "user_prompt") return "turn";
  return null;
}

/**
 * Claude Code log-record classifier + marking constants (write-path).
 *
 * Claude Code 2.x emits its model calls and tool calls as OTLP LOG records
 * (scope `com.anthropic.claude_code.events`), not spans. These constants and
 * classifier functions identify those log events at ingest so the receiver can
 * mark them. The log records are the content-of-record — real OTLP tracing
 * spans plus log enrichment now carry the trace, so the logs are no longer
 * folded into synthesized spans.
 */

export const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";

/**
 * The three claude_code log events that describe one model call: `api_request`
 * (the anchor: model, tokens, cost, duration, request_id), `api_request_body`
 * (the request payload) and `api_response_body` (the response payload).
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
 * `tool_use_id` (both carry it).
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
 * Attribute the receiver stamps on every claude_code log it saves, recording
 * the kind of event the log carries (from {@link claudeCodeLogKind}).
 */
export const CLAUDE_CODE_KIND_ATTR = "langwatch.claude_code.kind";

/**
 * The PII redaction level the receiver used at ingest, stamped on each saved
 * claude_code log.
 */
export const CLAUDE_CODE_PII_ATTR = "langwatch.claude_code.pii";

/**
 * The kind of a claude_code log event (`model` / `tool` / `turn`), or null when
 * the event is not a recognised claude_code model / tool / turn event. The
 * receiver stamps this value under {@link CLAUDE_CODE_KIND_ATTR}.
 */
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

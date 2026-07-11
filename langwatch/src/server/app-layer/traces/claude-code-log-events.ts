/**
 * Claude Code instrumentation-scope constants.
 *
 * Claude Code 2.x emits its model calls and tool calls as OTLP LOG records
 * (scope `com.anthropic.claude_code.events`) and, under the enhanced-telemetry
 * beta, real tracing spans (scope `com.anthropic.claude_code.tracing`). These
 * two scope names are the only shared vocabulary the ingest path needs.
 */

export const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";

/**
 * The OTLP instrumentation scope Claude Code's enhanced-telemetry beta stamps
 * on its REAL tracing spans (`llm_request`, `tool`, `interaction`) — distinct
 * from {@link CLAUDE_CODE_EVENT_SCOPE}, which is the LOG scope carrying the
 * content records.
 */
export const CLAUDE_CODE_TRACING_SCOPE = "com.anthropic.claude_code.tracing";

/**
 * Coding-agent harness detection (ADR-033 Decision 6).
 *
 * v1 scope is coding-agent CLI traffic — Claude Code and Codex. Scope is a
 * predicate over already-captured evidence, not a separate ingestion path:
 * classification only runs when this returns a harness.
 *
 * Detection reads the instrumentation scope name and stable canonical markers:
 *   - Claude Code: scope `com.anthropic.claude_code.events` (native + the
 *     synthesized gen_ai spans that preserve it), or `gen_ai.system=claude_code`
 *     stamped by the claude-code log-to-span converter.
 *   - Codex: scope `codex_cli_rs` (the Rust CLI native spans), or
 *     `langwatch.codex.rollout` (the CLI transcript-reconstruction path, which
 *     emits a `langwatch.*` scope so the infra-span filter leaves its content
 *     spans alone — see `codex-rollout-otlp.ts`).
 *
 * Constants mirror the source-of-truth strings in
 * `claude-code-log-to-span.ts` (CLAUDE_CODE_EVENT_SCOPE) and the codex extractor
 * (`codex_cli_rs`) / rollout reconstructor (`langwatch.codex.rollout`); they are
 * inlined here to keep this a dependency-free pure predicate. Gateway-path
 * origin markers are not stamped today (README lists
 * only response headers, no request-origin attribute), so widening the predicate
 * to generic traffic is a later concern (Decision 6, open question).
 */

export type CodingAgentHarness = "claude" | "codex";

const CLAUDE_CODE_SCOPE = "com.anthropic.claude_code.events";
const CODEX_RUST_SCOPE = "codex_cli_rs";
const CODEX_ROLLOUT_SCOPE = "langwatch.codex.rollout";
const GEN_AI_SYSTEM = "gen_ai.system";
const CLAUDE_CODE_SYSTEM = "claude_code";

export function detectCodingAgentHarness({
  instrumentationScopeName,
  spanAttributes,
}: {
  instrumentationScopeName?: string | null;
  spanAttributes: Record<string, unknown>;
}): CodingAgentHarness | null {
  const scope = instrumentationScopeName ?? "";

  if (scope === CLAUDE_CODE_SCOPE) return "claude";
  if (scope === CODEX_RUST_SCOPE || scope === CODEX_ROLLOUT_SCOPE)
    return "codex";

  if (spanAttributes[GEN_AI_SYSTEM] === CLAUDE_CODE_SYSTEM) return "claude";

  return null;
}

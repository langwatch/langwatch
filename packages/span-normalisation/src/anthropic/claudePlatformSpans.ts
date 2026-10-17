/** The span names the Claude SDK and the Claude API give the spans that carry token usage. */
export const CLAUDE_PLATFORM_SPAN_NAMES = {
  MESSAGES_CREATE: "anthropic.messages.create",
  MODEL_REQUEST: "anthropic.model_request",
  COMPACTION: "anthropic.compaction",
  OUTCOME_EVALUATION: "anthropic.session.outcome_evaluation",
} as const;

const CLAUDE_API_SCOPE_NAME = "com.anthropic.claude-platform";
const CLAUDE_SDK_SCOPE_PREFIX = "com.anthropic.sdk.";

/**
 * Whether an instrumentation scope is the Claude API's or a Claude SDK's
 * (`com.anthropic.sdk.<language>`, with `.<platform>` on a cloud client).
 * Claude Code's `com.anthropic.claude_code*` scopes are not.
 */
export function isClaudePlatformScope(scopeName: string | null | undefined): boolean {
  if (typeof scopeName !== "string") {
    return false;
  }

  return scopeName === CLAUDE_API_SCOPE_NAME || scopeName.startsWith(CLAUDE_SDK_SCOPE_PREFIX);
}

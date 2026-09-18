// Filter codex/opencode's internal span noise (DB, file IO, auth) by scope;
// keeps AI-semantic spans only; other OTLP sources never touched.

export const CODEX_SCOPE = "codex_cli_rs";
/**
 * codex names its instrumentation scope after the originator: `codex exec`
 * sessions arrive under `codex_exec`, the interactive TUI under
 * `codex_cli_rs` — same emitter, same noise (500+ spans per exec turn), same filter.
 */
export const CODEX_EXEC_SCOPE = "codex_exec";
export const OPENCODE_SCOPE = "opencode";

/** The per-turn rollup span codex emits (model + tokens + cost + reasoning). */
const CODEX_TURN_SPAN = "session_task.turn";

/**
 * The app-server request span starting a codex helper thread's turn, kept
 * only once ingestion stamps the helper's thread id — that stamp is the
 * admission; the same span for a user-driven turn carries none and stays noise.
 */
const CODEX_TURN_REQUEST_SPAN = "turn/start";
const CODEX_HELPER_THREAD_STAMP = "langwatch.thread.id";

const CODEX_SCOPES: ReadonlySet<string> = new Set([CODEX_SCOPE, CODEX_EXEC_SCOPE]);

const CODING_AGENT_SCOPES: ReadonlySet<string> = new Set([
  CODEX_SCOPE,
  CODEX_EXEC_SCOPE,
  OPENCODE_SCOPE,
]);

/** Whether spans under this scope are subject to the coding-agent filter. */
export function isCodingAgentNoiseScope(scopeName: string | null | undefined): boolean {
  return typeof scopeName === "string" && CODING_AGENT_SCOPES.has(scopeName);
}

/**
 * Whether a span from a noisy coding-agent scope carries AI-semantic value
 * worth keeping. Everything else from that scope is infra noise.
 */
function isAiSemanticCodingAgentSpan({
  scopeName,
  spanName,
  attributeKeys,
}: {
  scopeName: string;
  spanName: string;
  attributeKeys: readonly string[];
}): boolean {
  const hasGenAi = attributeKeys.some((k) => k.startsWith("gen_ai."));
  if (CODEX_SCOPES.has(scopeName)) {
    // Keep turn rollup and model-call spans; tool spans emit as log events instead.
    return (
      spanName === CODEX_TURN_SPAN ||
      hasGenAi ||
      (spanName === CODEX_TURN_REQUEST_SPAN && attributeKeys.includes(CODEX_HELPER_THREAD_STAMP))
    );
  }
  if (scopeName === OPENCODE_SCOPE) {
    // opencode wraps the Vercel AI SDK, whose operation spans are all named
    // ai.* (ai.streamText, ai.streamText.doStream, ai.toolCall, ...). Its
    // infra spans are named after internal modules (sql.execute, Session.get,
    // Config.get) and carry no gen_ai/ai attributes.
    const hasAi = attributeKeys.some((k) => k.startsWith("ai.") || k.startsWith("gen_ai."));
    return spanName.startsWith("ai.") || hasAi;
  }
  return true;
}

/**
 * Whether to drop this span as coding-agent members noise. Returns
 * false (keep) for every span not emitted under a known noisy coding-agent
 * scope, so unrelated OTLP is untouched.
 */
export function shouldFilterCodingAgentSpan({
  scopeName,
  spanName,
  attributeKeys,
}: {
  scopeName: string | null | undefined;
  spanName: string;
  attributeKeys: readonly string[];
}): boolean {
  if (!isCodingAgentNoiseScope(scopeName)) return false;
  return !isAiSemanticCodingAgentSpan({
    scopeName: scopeName as string,
    spanName,
    attributeKeys,
  });
}

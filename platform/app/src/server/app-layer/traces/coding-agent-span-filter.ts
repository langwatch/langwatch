/**
 * Coding-assistant span noise filter.
 *
 * codex (instrumentation scope `codex_cli_rs`) and opencode (scope `opencode`)
 * export their ENTIRE internal call graph over OTLP: DB queries, file IO,
 * config reads, auth, websockets, session init, plugin enumeration. For a
 * single "hello" that is hundreds of spans fragmented across dozens of trace
 * ids, burying the few spans that represent actual model and tool activity. In
 * an LLM-observability product that is pure noise (claude reads cleanly because
 * its log-only telemetry is folded into one focused tree).
 *
 * This filter keeps only the AI-semantic spans for those two KNOWN tools and
 * drops the infra plumbing. It is gated on the instrumentation scope name, so
 * any OTHER OTLP (customer apps, custom SDKs, OpenInference, Traceloop, raw
 * OTLP) is NEVER touched. A trace whose spans are all filtered never gets
 * created, which is what removes the infra-only fragment traces.
 */

export const CODEX_SCOPE = "codex_cli_rs";
export const OPENCODE_SCOPE = "opencode";

/** The per-turn rollup span codex emits (model + tokens + cost + reasoning). */
const CODEX_TURN_SPAN = "session_task.turn";

const CODING_AGENT_SCOPES: ReadonlySet<string> = new Set([
  CODEX_SCOPE,
  OPENCODE_SCOPE,
]);

/** Whether spans under this scope are subject to the coding-agent filter. */
export function isCodingAgentNoiseScope(
  scopeName: string | null | undefined,
): boolean {
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
  if (scopeName === CODEX_SCOPE) {
    // The turn rollup is the authoritative AI span; model-call spans
    // (handle_responses) carry native gen_ai.usage.
    return spanName === CODEX_TURN_SPAN || hasGenAi;
  }
  if (scopeName === OPENCODE_SCOPE) {
    // opencode wraps the Vercel AI SDK, whose operation spans are all named
    // ai.* (ai.streamText, ai.streamText.doStream, ai.toolCall, ...). Its
    // infra spans are named after internal modules (sql.execute, Session.get,
    // Config.get) and carry no gen_ai/ai attributes.
    const hasAi = attributeKeys.some(
      (k) => k.startsWith("ai.") || k.startsWith("gen_ai."),
    );
    return spanName.startsWith("ai.") || hasAi;
  }
  return true;
}

/**
 * Whether to drop this span as coding-agent infrastructure noise. Returns
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

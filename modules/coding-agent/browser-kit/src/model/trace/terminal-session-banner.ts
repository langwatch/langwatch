import { isModelCallSpan, pickString } from "@langwatch/coding-agent-contract";
import type { SpanDetail } from "@langwatch/trace-contract";

/**
 * The handful of facts a coding agent prints above the prompt at session
 * start: agent, version, model, where it's running. Sourced from OTel
 * resource/span attributes, not the bounded `coding_agent_sessions` fold (ADR-041).
 */

/** Which agent's mark and name the banner draws. */
export type BannerAgent =
  | "claude_code"
  | "claude_cowork"
  | "opencode"
  | "codex"
  | "gemini_cli"
  | "copilot"
  | "unknown";

export interface SessionBanner {
  agent: BannerAgent;
  version: string | null;
  model: string | null;
  repo: string | null;
}

/**
 * Service-name fragments, tested in order. Cowork comes before claude: it is the Claude runtime
 * under another service name, so "claude" alone must not claim it.
 */
const SERVICE_NAME_AGENTS: { fragment: string; agent: BannerAgent }[] = [
  { fragment: "cowork", agent: "claude_cowork" },
  { fragment: "claude", agent: "claude_code" },
  { fragment: "opencode", agent: "opencode" },
  { fragment: "codex", agent: "codex" },
  { fragment: "gemini", agent: "gemini_cli" },
  { fragment: "copilot", agent: "copilot" },
];

/** Span-name namespaces, tested in order; Copilot alone names its call span "chat <model>". */
const SPAN_NAME_AGENTS: { matches: (name: string) => boolean; agent: BannerAgent }[] = [
  { matches: (name) => name.startsWith("claude_code."), agent: "claude_code" },
  {
    matches: (name) => name.startsWith("opencode.") || name.startsWith("ai.stream"),
    agent: "opencode",
  },
  { matches: (name) => name === "session_task.turn", agent: "codex" },
  { matches: (name) => name === "llm_call", agent: "gemini_cli" },
  { matches: (name) => name.startsWith("chat "), agent: "copilot" },
];

/**
 * The agent, from the resource `service.name` the wrapper stamps (or the
 * agent stamps itself), with the span-name namespace as the fallback for
 * traces ingested without one.
 */
function detectBannerAgent({
  serviceName,
  spans,
}: {
  serviceName: string;
  spans: SpanDetail[];
}): BannerAgent {
  const service = serviceName.toLowerCase();
  const byService = SERVICE_NAME_AGENTS.find(({ fragment }) => service.includes(fragment));
  if (byService) return byService.agent;

  for (const span of spans) {
    const bySpan = SPAN_NAME_AGENTS.find(({ matches }) => matches(span.name));
    if (bySpan) return bySpan.agent;
  }
  return "unknown";
}

/**
 * `resourceAttributes` comes from the root-span `resourceInfo` read (same
 * across a session). `spans` supplies the model, per-call not per-resource —
 * the LAST model call's model is what the session ended on.
 */
export function deriveSessionBanner({
  resourceAttributes,
  spans,
}: {
  resourceAttributes: Record<string, string>;
  spans: SpanDetail[];
}): SessionBanner {
  let model: string | null = null;
  // Chronological order is the contract "last model call" depends on — the
  // caller may hand spans in tree order.
  for (const span of [...spans].toSorted((a, b) => a.startTimeMs - b.startTimeMs)) {
    if (!isModelCallSpan(span.name)) continue;
    // pickString resolves dotted keys against BOTH attribute shapes — the
    // span mapper unflattens params into nested objects, so a flat lookup
    // of "gen_ai.request.model" reads nothing on real spans.
    const params = (span.params ?? {}) as Record<string, unknown>;
    const value =
      pickString(params, "gen_ai.request.model") ??
      pickString(params, "ai.model.id") ??
      pickString(params, "model");
    if (value !== null) model = value;
  }

  return {
    agent: detectBannerAgent({
      serviceName: resourceAttributes["service.name"] ?? "",
      spans,
    }),
    // Some agents ship service.version already v-prefixed; the banner adds
    // its own v, so strip one here or it renders "vv24.11.1".
    version: str(resourceAttributes["service.version"])?.replace(/^v/, "") ?? null,
    model,
    repo: str(resourceAttributes["project.repo"]),
  };
}

function str(value: string | undefined): string | null {
  return value != null && value.length > 0 ? value : null;
}

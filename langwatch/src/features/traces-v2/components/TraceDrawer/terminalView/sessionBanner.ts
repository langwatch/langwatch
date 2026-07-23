import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import {
  isModelCallSpan,
  readString,
} from "~/server/app-layer/traces/coding-agent-transcript.derivation";

/**
 * The handful of facts a coding agent itself prints above the prompt when a
 * session starts: which agent it is, its version, the model, and where it's
 * running. Sourced straight from the OTel resource/span attributes rather
 * than the `coding_agent_sessions` fold — the fold is a bounded aggregate
 * (ADR-041) and deliberately doesn't carry identity strings the drawer
 * already has spans for.
 */

/** Which agent's mark and name the banner draws. */
export type BannerAgent =
  | "claude_code"
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
  if (service.includes("claude")) return "claude_code";
  if (service.includes("opencode")) return "opencode";
  if (service.includes("codex")) return "codex";
  if (service.includes("gemini")) return "gemini_cli";
  if (service.includes("copilot")) return "copilot";

  for (const span of spans) {
    if (span.name.startsWith("claude_code.")) return "claude_code";
    if (span.name.startsWith("opencode.") || span.name.startsWith("ai.stream"))
      return "opencode";
    if (span.name === "session_task.turn") return "codex";
    if (span.name === "llm_call") return "gemini_cli";
    // Copilot's call span is "chat <model>" — the only agent naming this way.
    if (span.name.startsWith("chat ")) return "copilot";
  }
  return "unknown";
}

/**
 * `resourceAttributes` comes from the `resourceInfo` read (root span only —
 * these are the same across a session). `spans` supplies the model, which is
 * per-call rather than per-resource: the LAST model call's model is what the
 * session ended on.
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
  for (const span of [...spans].sort((a, b) => a.startTimeMs - b.startTimeMs)) {
    if (!isModelCallSpan(span.name)) continue;
    // readString resolves dotted keys against BOTH attribute shapes — the
    // span mapper unflattens params into nested objects, so a flat lookup
    // of "gen_ai.request.model" reads nothing on real spans.
    const params = (span.params ?? {}) as Record<string, unknown>;
    const value =
      readString(params, "gen_ai.request.model") ??
      readString(params, "ai.model.id") ??
      readString(params, "model");
    if (value !== null) model = value;
  }

  return {
    agent: detectBannerAgent({
      serviceName: resourceAttributes["service.name"] ?? "",
      spans,
    }),
    // Some agents ship service.version already v-prefixed; the banner adds
    // its own v, so strip one here or it renders "vv24.11.1".
    version:
      str(resourceAttributes["service.version"])?.replace(/^v/, "") ?? null,
    model,
    repo: str(resourceAttributes["project.repo"]),
  };
}

function str(value: string | undefined): string | null {
  return value != null && value.length > 0 ? value : null;
}

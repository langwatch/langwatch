import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";

/**
 * The handful of facts Claude Code itself prints above the prompt when a
 * session starts: its own version, the model, and where it's running. Sourced
 * straight from the OTel resource/span attributes rather than the
 * `coding_agent_sessions` fold — the fold is a bounded aggregate (ADR-041) and
 * deliberately doesn't carry identity strings the drawer already has spans for.
 */
export interface SessionBanner {
  version: string | null;
  model: string | null;
  repo: string | null;
}

const MODEL_CALL_SPAN_NAMES = new Set([
  "claude_code.llm_request",
  "opencode.llm",
  "chat",
]);

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
  for (const span of spans) {
    if (!MODEL_CALL_SPAN_NAMES.has(span.name)) continue;
    const params = (span.params ?? {}) as Record<string, unknown>;
    const value = params["gen_ai.request.model"] ?? params.model;
    if (typeof value === "string" && value.length > 0) model = value;
  }

  return {
    version: str(resourceAttributes["service.version"]),
    model,
    repo: str(resourceAttributes["project.repo"]),
  };
}

function str(value: string | undefined): string | null {
  return value != null && value.length > 0 ? value : null;
}

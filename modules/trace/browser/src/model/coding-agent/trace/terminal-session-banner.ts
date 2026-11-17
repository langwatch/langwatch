import {
  type CodingAgent,
  detectCodingAgent,
  isModelCallSpan,
  pickString,
} from "@langwatch/coding-agent-contract";
import type { SpanDetail, TraceLogRecordDto } from "@langwatch/trace-contract";

/**
 * The handful of facts a coding agent prints above the prompt at session
 * start: agent, version, model, where it's running. Sourced from OTel
 * resource/span attributes, not the bounded `coding_agent_sessions` fold (ADR-041).
 */

/** Which agent's mark and name the banner draws: one per agent the contract can name. */
type BannerAgent = CodingAgent;

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
  { fragment: "grok", agent: "grok" },
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
  // An agent that names its spans in its own namespace (pi) is named by the contract's registry.
  for (const span of spans) {
    const byRegistry = detectCodingAgent({ recordName: span.name });
    if (byRegistry !== "unknown") return byRegistry;
  }
  return "unknown";
}

/** The fields of a trace log record the banner reads, for an agent that sends no spans. */
export type BannerLogRecord = Pick<
  TraceLogRecordDto,
  "timeUnixMs" | "attributes" | "resourceAttributes"
>;

/**
 * `resourceAttributes` comes from the root span's `resourceInfo` read, the same across a session.
 * `spans` supplies the model: the last model call's model is what the session ended on. A
 * logs-only agent (Grok, ADR-192) has neither, so its log records stand in for both.
 */
export function deriveSessionBanner({
  resourceAttributes,
  spans,
  logs = [],
}: {
  resourceAttributes: Record<string, string>;
  spans: SpanDetail[];
  logs?: readonly BannerLogRecord[];
}): SessionBanner {
  const chronologicalLogs = [...logs].toSorted((a, b) => a.timeUnixMs - b.timeUnixMs);
  const resource =
    Object.keys(resourceAttributes).length > 0
      ? resourceAttributes
      : logResourceAttributes(chronologicalLogs);

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
  // Grok names the model on every turn record as `model`; the last one is what it ended on.
  if (model === null) {
    for (const log of chronologicalLogs) model = str(log.attributes.model) ?? model;
  }

  return {
    agent: detectBannerAgent({
      serviceName: resource["service.name"] ?? "",
      spans,
    }),
    version: bannerVersion(resource["service.version"]),
    model,
    repo: str(resource["project.repo"]),
  };
}

/** The resource of the first record an agent sent, past any record LangWatch's own CLI posted. */
function logResourceAttributes(logs: readonly BannerLogRecord[]): Record<string, string> {
  const fromAgent = logs.find(({ resourceAttributes }) => {
    const service = (resourceAttributes["service.name"] ?? "").toLowerCase();
    return SERVICE_NAME_AGENTS.some(({ fragment }) => service.includes(fragment));
  });
  return fromAgent?.resourceAttributes ?? logs[0]?.resourceAttributes ?? {};
}

/**
 * The version as the agent prints it. The banner adds its own v, so a leading one goes ("vv24"),
 * as does a build suffix after a space: Grok's "1.0.70 (f50904eaee6c)" prints as 1.0.70.
 */
function bannerVersion(value: string | undefined): string | null {
  const [version = ""] = (str(value) ?? "").split(/\s/);
  return str(version.replace(/^v/, ""));
}

function str(value: string | undefined): string | null {
  return value != null && value.length > 0 ? value : null;
}

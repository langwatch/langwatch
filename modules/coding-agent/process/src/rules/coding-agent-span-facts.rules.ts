import {
  CODING_AGENT_CONTRIBUTION_KEYS,
  codexAuxiliarySessionFacts,
  type CodingAgentReceivedSpan,
  type ContributeSpanFactsCommandData,
  declaredSpanSessionFacts,
  detectCodingAgent,
  deriveSpanConversationKey,
  SPANS_REQUIRE_SESSION_KEY_AGENT_IDS,
} from "@langwatch/coding-agent-contract";

/** What one span lifts to: its contribution, or ignored as ambient telemetry with no session. */
export type SpanContribution =
  | { outcome: "contributes"; contribution: ContributeSpanFactsCommandData }
  | { outcome: "ignored" };

/**
 * The bounded session facts one normalized span contributes, as main's dispatch lifted them;
 * ignored when its agent requires the session key and the span carries none.
 */
export function liftSpanContribution({
  tenantId,
  occurredAt,
  span,
}: CodingAgentReceivedSpan): SpanContribution {
  const serviceName = span.resourceAttributes["service.name"];
  // Cowork shares Claude Code's vocabulary; only the service name tells them apart.
  const agent = detectCodingAgent({
    recordName: span.name,
    scopeName: span.instrumentationScope.name,
    serviceName: typeof serviceName === "string" ? serviceName : null,
  });
  // The agent's own reading first: codex keeps the session under thread.id, not the shared key.
  const sessionKey = deriveSpanConversationKey({
    agent,
    name: span.name,
    attrs: span.spanAttributes,
  });
  if (sessionKey === null && SPANS_REQUIRE_SESSION_KEY_AGENT_IDS.has(agent)) {
    return { outcome: "ignored" };
  }
  const facts = {
    ...liftSpanFacts(span.spanAttributes),
    // A codex helper thread's request span says so through its request id; the fold reads the
    // derived fact, never the vendor literal.
    ...codexAuxiliarySessionFacts({
      scopeName: span.instrumentationScope.name,
      attributes: span.spanAttributes,
    }),
    ...declaredSpanSessionFacts({
      agent,
      name: span.name,
      attributes: span.spanAttributes,
      resourceAttributes: span.resourceAttributes,
    }),
    ...toolCallFileFacts({ name: span.name, attributes: span.spanAttributes }),
  };
  const serviceVersion = span.resourceAttributes["service.version"];
  if (typeof serviceVersion === "string" && serviceVersion.length > 0) {
    facts["service.version"] = serviceVersion;
  } else if (typeof serviceVersion === "number" && Number.isFinite(serviceVersion)) {
    facts["service.version"] = String(serviceVersion);
  }

  const contribution: ContributeSpanFactsCommandData = {
    tenantId,
    sessionId: sessionKey ?? span.traceId,
    sessionKeySource: sessionKey !== null ? "provider" : "trace_fallback",
    agent,
    occurredAt,
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    startTimeUnixMs: span.startTimeUnixMs,
    endTimeUnixMs: span.endTimeUnixMs,
    statusCode: span.statusCode ?? 0,
    facts,
    scopeName: span.instrumentationScope.name || null,
  };
  return { outcome: "contributes", contribution };
}

/**
 * Tool spans whose call arguments name the one file the tool read or wrote, and the tools that do:
 * pi's file tools take it as `path` (pi-coding-agent `dist/core/tools/{read,edit,write}.d.ts`).
 * Arguments ride a span only with content capture on, so without it no file is touched.
 */
const FILE_ARGUMENT_TOOLS: Readonly<Record<string, { tools: ReadonlySet<string>; key: string }>> = {
  "pi.harness.tool": { tools: new Set(["read", "edit", "write"]), key: "path" },
};

/** The `file_path` fact a file tool's call arguments name; none for any other span. */
function toolCallFileFacts({
  name,
  attributes,
}: {
  name: string;
  attributes: Record<string, unknown>;
}): Record<string, string> {
  const declared = FILE_ARGUMENT_TOOLS[name];
  const tool = attributes["gen_ai.tool.name"];
  if (declared === undefined || typeof tool !== "string" || !declared.tools.has(tool)) return {};
  const raw = attributes["gen_ai.tool.call.arguments"];
  let args: unknown = raw;
  if (typeof raw === "string") {
    try {
      args = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  const filePath =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)[declared.key]
      : null;
  return typeof filePath === "string" && filePath.length > 0 ? { file_path: filePath } : {};
}

function liftSpanFacts(attrs: Record<string, unknown>): Record<string, string | number | boolean> {
  const facts: Record<string, string | number | boolean> = {};
  for (const key of CODING_AGENT_CONTRIBUTION_KEYS) {
    const value = attrs[key];
    if (
      (typeof value === "string" && value.length > 0) ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      facts[key] = value;
    }
  }
  return facts;
}

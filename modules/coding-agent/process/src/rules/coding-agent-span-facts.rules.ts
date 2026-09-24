import {
  CODING_AGENT_CONTRIBUTION_KEYS,
  type CodingAgentReceivedSpan,
  type ContributeSpanFactsCommandData,
  detectCodingAgent,
  resolveSpanConversationKey,
} from "@langwatch/coding-agent-contract";

/** The bounded session facts one normalized span contributes, as main's dispatch lifted them. */
export function liftSpanContribution({
  tenantId,
  occurredAt,
  span,
}: CodingAgentReceivedSpan): ContributeSpanFactsCommandData {
  const serviceName = span.resourceAttributes["service.name"];
  // Cowork shares Claude Code's vocabulary; only the service name tells them apart.
  const agent = detectCodingAgent({
    recordName: span.name,
    scopeName: span.instrumentationScope.name,
    serviceName: typeof serviceName === "string" ? serviceName : null,
  });
  // The agent's own reading first: codex keeps the session under thread.id, not the shared key.
  const sessionKey = resolveSpanConversationKey({
    agent,
    name: span.name,
    attrs: span.spanAttributes,
  });
  const facts = liftSpanFacts(span.spanAttributes);
  const serviceVersion = span.resourceAttributes["service.version"];
  if (typeof serviceVersion === "string" && serviceVersion.length > 0) {
    facts["service.version"] = serviceVersion;
  } else if (typeof serviceVersion === "number" && Number.isFinite(serviceVersion)) {
    facts["service.version"] = String(serviceVersion);
  }

  return {
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

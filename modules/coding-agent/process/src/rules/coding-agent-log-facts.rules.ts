import {
  type ContributeLogFactsCommandData,
  deriveConversationKey,
  deriveSessionTitleFromPrompt,
  detectCodingAgent,
  extractCodingAgentLogFacts,
  LOGS_REQUIRE_SESSION_KEY_AGENT_IDS,
  normalizeEventName,
  pickDeclaredCodingAgent,
  SESSION_TITLE_FACT_KEY,
  SESSION_TITLE_FALLBACK_FACT_KEY,
} from "@langwatch/coding-agent-contract";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { createLogger } from "@langwatch/observability";
import type { TraceApi } from "@langwatch/trace-contract";
import { z } from "zod";

/** The event whose body carries the generated conversation title. */
const RESPONSE_BODY_EVENT_NAME = "api_response_body";

/** The utility call that generates it, apart from every conversational turn. */
const TITLE_QUERY_SOURCE = "generate_session_title";

const logger = createLogger("langwatch:coding-agent:log-facts");
const flatAttributesSchema = z.record(z.string(), z.unknown());

type LogFacts = Record<string, string | number | boolean>;
type ResponseContent = Pick<TraceApi, "deriveClaudeResponseContent">;

/** A received record either contributes session facts or is no coding-agent session's. */
type LogContribution =
  | { outcome: "contributes"; contribution: ContributeLogFactsCommandData }
  | { outcome: "ignored" };

const IGNORED: LogContribution = { outcome: "ignored" };

/** The bounded session facts one received log record contributes, as main's dispatch lifted. */
export function liftLogContribution({
  record,
  traces,
}: {
  record: CanonicalLogRecord;
  traces: ResponseContent;
}): LogContribution {
  const attributes = parseFlatAttributes(record.attributesFlatJson);
  if (attributes === null) return IGNORED;
  // The canonical preparation keeps `eventName` in its own column; some agents only spell it there.
  if (record.eventName && attributes["event.name"] === undefined) {
    attributes["event.name"] = record.eventName;
  }
  // A cheap name/scope gate first; Cowork passes as claude_code and the resource parse relabels it.
  const facts = extractCodingAgentLogFacts({ scopeName: record.scopeName, attributes });
  if (facts === null) return IGNORED;

  const resourceAttributes = parseFlatAttributes(record.resourceAttributesFlatJson);
  stampServiceVersion({ facts, resourceAttributes });
  stampSessionTitle({ facts, attributes, traces });
  stampPromptTitleFallback({ facts, attributes });

  const agent = detectContributionAgent({
    scopeName: record.scopeName,
    attributes,
    serviceName: deriveServiceName(resourceAttributes),
    facts,
  });
  if (agent === null) return IGNORED;
  return keyContribution({ record, attributes, agent, facts });
}

function keyContribution({
  record,
  attributes,
  agent,
  facts,
}: {
  record: CanonicalLogRecord;
  attributes: Record<string, unknown>;
  agent: string;
  facts: LogFacts;
}): LogContribution {
  const sessionKey = deriveConversationKey(attributes) ?? (record.providerSessionId || null);
  const correlated = record.correlationSource !== "none";
  const correlationTraceId =
    correlated && record.correlationTraceId ? record.correlationTraceId : null;
  // A keyless record from an agent that stamps every session event is ambient telemetry.
  if (sessionKey === null && LOGS_REQUIRE_SESSION_KEY_AGENT_IDS.has(agent)) return IGNORED;
  // No session key and no correlation: there is nothing to aggregate under.
  const sessionId = sessionKey ?? correlationTraceId;
  if (sessionId === null) return IGNORED;

  const contribution: ContributeLogFactsCommandData = {
    tenantId: record.tenantId,
    sessionId,
    sessionKeySource: sessionKey !== null ? "provider" : "trace_fallback",
    agent,
    occurredAt: record.occurredAt,
    recordId: record.recordId,
    traceId: correlationTraceId,
    spanId: correlated && record.correlationSpanId ? record.correlationSpanId : null,
    timeUnixMs: record.timeUnixMs,
    severityNumber: record.severityNumber,
    providerKind: record.providerKind,
    scopeName: record.scopeName || null,
    facts,
  };
  return { outcome: "contributes", contribution };
}

function stampServiceVersion({
  facts,
  resourceAttributes,
}: {
  facts: LogFacts;
  resourceAttributes: Record<string, unknown> | null;
}): void {
  const serviceVersion = resourceAttributes?.["service.version"];
  if (typeof serviceVersion === "string" && serviceVersion.length > 0) {
    facts["service.version"] = serviceVersion;
  }
}

function deriveServiceName(resourceAttributes: Record<string, unknown> | null): string | null {
  const serviceName = resourceAttributes?.["service.name"];
  return typeof serviceName === "string" && serviceName.length > 0 ? serviceName : null;
}

/** The generated title rides inside one utility call's body; only the title becomes a fact. */
function stampSessionTitle({
  facts,
  attributes,
  traces,
}: {
  facts: LogFacts;
  attributes: Record<string, unknown>;
  traces: ResponseContent;
}): void {
  if (
    facts["event.name"] !== RESPONSE_BODY_EVENT_NAME ||
    facts.query_source !== TITLE_QUERY_SOURCE ||
    typeof attributes.body !== "string"
  ) {
    return;
  }
  const title = traces.deriveClaudeResponseContent({ body: attributes.body }).sessionTitle;
  if (title !== null) facts[SESSION_TITLE_FACT_KEY] = title;
}

/** A prompt-derived name candidate the fold falls back to when no title was generated. */
function stampPromptTitleFallback({
  facts,
  attributes,
}: {
  facts: LogFacts;
  attributes: Record<string, unknown>;
}): void {
  const eventName = facts["event.name"];
  if (typeof eventName !== "string") return;
  if (normalizeEventName(eventName) !== "user_prompt") return;
  if (typeof attributes.prompt !== "string") return;
  const title = deriveSessionTitleFromPrompt(attributes.prompt);
  if (title !== null) facts[SESSION_TITLE_FALLBACK_FACT_KEY] = title;
}

/** Resolve agent label; rejects unknown (from LangWatch companion event declaration). */
function detectContributionAgent({
  scopeName,
  attributes,
  serviceName,
  facts,
}: {
  scopeName: string | null | undefined;
  attributes: Record<string, unknown>;
  serviceName: string | null;
  facts: LogFacts;
}): string | null {
  const eventName = attributes["event.name"];
  const detected = detectCodingAgent({
    scopeName,
    recordName: typeof eventName === "string" ? eventName : null,
    serviceName,
  });
  return detected !== "unknown" ? detected : pickDeclaredCodingAgent(facts);
}

/** The canonical row stores attributes flattened as JSON: parse or skip. */
function parseFlatAttributes(json: string): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    const result = flatAttributesSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch (error) {
    // Written by our own preparation, so unreachable; one record must never poison the queue.
    logger.warn({ error }, "unparseable canonical log attributes; skipping");
    return null;
  }
}

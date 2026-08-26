import type { EventSubscriberDefinition } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE } from "../../log-processing/schemas/constants";
import type { LogProcessingEvent } from "../../log-processing/schemas/events";
import { LOGS_REQUIRE_SESSION_KEY_AGENT_IDS } from "@langwatch/coding-agent-contract";
import type { ContributeLogFactsCommandData } from "../schemas/commands";
import {
  declaredCodingAgent,
  detectCodingAgent,
  liftCodingAgentLogFacts,
  normalizeEventName,
  resolveConversationKey,
  SESSION_TITLE_FACT_KEY,
  SESSION_TITLE_FALLBACK_FACT_KEY,
  sessionTitleFromPrompt,
} from "@langwatch/coding-agent-contract";

/** The event whose body carries the generated conversation title. */
const RESPONSE_BODY_EVENT_NAME = "api_response_body";

/** The utility call that generates it, apart from every conversational turn. */
const TITLE_QUERY_SOURCE = "generate_session_title";

const logger = createLogger("langwatch:coding-agent:log-facts-dispatch");

/**
 * The log→session dispatcher (ADR-056 §2): a subscriber on log-processing's
 * stored canonical records that lifts a coding-agent log's scalar facts and
 * contributes them to its session.
 *
 * `liftCodingAgentLogFacts` is the gate — it returns null for anything that
 * is not a coding agent's record, so an ordinary application log costs one
 * detection call. The lifted vocabulary is scalars only; the record's
 * content stays in the canonical row, reachable via `recordId`.
 *
 * Two facts are DERIVED here rather than lifted, because both live somewhere
 * the vocabulary cannot reach: the resource's `service.version`, and the
 * generated conversation title, which sits inside one response body.
 */
export function createCodingAgentLogFactsDispatchSubscriber(deps: {
  contributeLogFacts: (data: ContributeLogFactsCommandData) => Promise<void>;
  traceCanonicalisation: TraceCanonicalisationService;
}): EventSubscriberDefinition<LogProcessingEvent> {
  return {
    name: "codingAgentLogFactsDispatch",
    eventTypes: [CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE],
    options: {
      deduplication: {
        makeId: (event) =>
          `coding-agent-log-facts:${event.tenantId}:${String(event.aggregateId)}`,
        ttlMs: 60_000,
      },
    },
    handle: async (event) => {
      const record = event.data;
      const attributes = parseFlatAttributes(record.attributesFlatJson);
      if (attributes === null) return;
      // The canonical preparation extracts `eventName` into its own column
      // and some agents only spell it there.
      if (record.eventName && attributes["event.name"] === undefined) {
        attributes["event.name"] = record.eventName;
      }

      // Two-phase detection, so an ordinary application log costs one cheap
      // name/scope check and never a resource-attributes parse. Cowork's
      // events reuse Claude Code's runtime (anthropic scope, claude_code
      // event names), so they PASS this gate as claude_code; the resource
      // parse below then supplies the service.name that relabels them
      // claude_cowork at the contribution.
      const facts = liftCodingAgentLogFacts({
        scopeName: record.scopeName,
        attributes,
      });
      if (facts === null) return;

      const resourceAttributes = parseFlatAttributes(record.resourceAttributesFlatJson);
      const rawServiceName = resourceAttributes?.["service.name"];
      const serviceName =
        typeof rawServiceName === "string" && rawServiceName.length > 0
          ? rawServiceName
          : null;

      const serviceVersion = resourceAttributes?.["service.version"];
      if (typeof serviceVersion === "string" && serviceVersion.length > 0) {
        facts["service.version"] = serviceVersion;
      }

      stampSessionTitle({
        facts,
        attributes,
        traceCanonicalisation: deps.traceCanonicalisation,
      });
      stampPromptTitleFallback({ facts, attributes });

      const agent = resolveContributionAgent({
        scopeName: record.scopeName,
        attributes,
        serviceName,
        facts,
      });
      if (agent === null) return;

      const sessionKey =
        resolveConversationKey(attributes) ?? (record.providerSessionId || null);
      const correlationTraceId =
        record.correlationSource !== "none" && record.correlationTraceId
          ? record.correlationTraceId
          : null;

      // An agent that stamps its session id on every session event (codex)
      // gets no trace fallback: a keyless record of theirs is ambient
      // process telemetry — an auth refresh, not a session — and keying it
      // on the trace would mint an empty one-record session.
      if (sessionKey === null && LOGS_REQUIRE_SESSION_KEY_AGENT_IDS.has(agent)) return;

      // No session key and no correlation: there is nothing to aggregate
      // under. The canonical row still holds the record.
      const sessionId = sessionKey ?? correlationTraceId;
      if (sessionId === null) return;

      await deps.contributeLogFacts({
        tenantId: record.tenantId,
        sessionId,
        sessionKeySource: sessionKey !== null ? "provider" : "trace_fallback",
        agent,
        occurredAt: record.occurredAt,
        recordId: record.recordId,
        traceId: correlationTraceId,
        spanId:
          record.correlationSource !== "none" && record.correlationSpanId
            ? record.correlationSpanId
            : null,
        timeUnixMs: record.timeUnixMs,
        severityNumber: record.severityNumber,
        providerKind: record.providerKind,
        scopeName: record.scopeName || null,
        facts,
      });
    },
  };
}

/**
 * Stamp the conversation title Claude generates for the session. It rides
 * inside the body of one utility model call, so it cannot be lifted by the
 * vocabulary; the body itself stays in the canonical row and only the title
 * becomes a fact, which the fold then reads like any other.
 */
function stampSessionTitle({
  facts,
  attributes,
  traceCanonicalisation,
}: {
  facts: Record<string, string | number | boolean>;
  attributes: Record<string, unknown>;
  traceCanonicalisation: TraceCanonicalisationService;
}): void {
  if (
    facts["event.name"] !== RESPONSE_BODY_EVENT_NAME ||
    facts.query_source !== TITLE_QUERY_SOURCE ||
    typeof attributes.body !== "string"
  ) {
    return;
  }
  const title = traceCanonicalisation.deriveClaudeResponseContent({
    body: attributes.body,
  }).sessionTitle;
  if (title !== null) facts[SESSION_TITLE_FACT_KEY] = title;
}

/**
 * Stamp a prompt-derived name candidate on every prompt event that carries
 * the user's words. The fold fills an empty title from it and otherwise
 * ignores it, so the session ends up named by the FIRST thing the user asked
 * unless the agent generated a real title. The vocabulary lifts prompt
 * lengths, never text, so like the generated title this is derived here,
 * where the full attributes are still in hand.
 */
function stampPromptTitleFallback({
  facts,
  attributes,
}: {
  facts: Record<string, string | number | boolean>;
  attributes: Record<string, unknown>;
}): void {
  const eventName = facts["event.name"];
  if (typeof eventName !== "string") return;
  if (normalizeEventName(eventName) !== "user_prompt") return;
  if (typeof attributes.prompt !== "string") return;
  const title = sessionTitleFromPrompt(attributes.prompt);
  if (title !== null) facts[SESSION_TITLE_FALLBACK_FACT_KEY] = title;
}

/**
 * The agent a contribution is labeled with, or null when nothing names one.
 *
 * The record's own evidence names it for everything except the LangWatch
 * companion event, which carries no vendor evidence at all and declares its
 * agent instead. A declaration LangWatch cannot resolve contributes nothing:
 * `unknown` must never reach a contribution (`contributionBaseSchema`), and
 * the companion event is usually a session's FIRST signal, so a bad label
 * here would be the one the first-writer-wins fold keeps forever.
 */
function resolveContributionAgent({
  scopeName,
  attributes,
  serviceName,
  facts,
}: {
  scopeName: string | null | undefined;
  attributes: Record<string, unknown>;
  serviceName: string | null;
  facts: Record<string, string | number | boolean>;
}): string | null {
  const eventName = attributes["event.name"];
  const detected = detectCodingAgent({
    scopeName,
    recordName: typeof eventName === "string" ? eventName : null,
    serviceName,
  });
  return detected !== "unknown" ? detected : declaredCodingAgent(facts);
}

/** The canonical row stores attributes flattened as JSON — parse or skip. */
function parseFlatAttributes(json: string): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    // A canonical row's JSON is written by our own preparation, so this
    // should be unreachable — but a dispatcher must never poison the queue
    // over one record.
    logger.warn({ error }, "unparseable canonical log attributes; skipping");
    return null;
  }
}

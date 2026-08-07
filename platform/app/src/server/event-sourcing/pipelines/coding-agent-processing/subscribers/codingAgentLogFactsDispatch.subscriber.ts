import { createLogger } from "@langwatch/observability";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import { CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE } from "../../log-processing/schemas/constants";
import type { LogProcessingEvent } from "../../log-processing/schemas/events";
import type { CanonicalLogRecord } from "../../log-processing/schemas/logRecord";
import type { ContributeLogFactsCommandData } from "../schemas/commands";
import {
  detectCodingAgent,
  liftCodingAgentLogFacts,
  resolveConversationKey,
} from "../services/coding-agent-normalization";

const logger = createLogger("langwatch:coding-agent:log-facts-dispatch");

/** The canonical preparation extracts `eventName` into its own column and
 * some agents only spell it there. */
function withEventNameFallback(
  attributes: Record<string, unknown>,
  record: CanonicalLogRecord,
): Record<string, unknown> {
  if (record.eventName && attributes["event.name"] === undefined) {
    attributes["event.name"] = record.eventName;
  }
  return attributes;
}

function resolveServiceIdentity(
  resourceAttributes: Record<string, unknown> | null,
): { serviceName: string | null; serviceVersion: string | null } {
  const rawServiceName = resourceAttributes?.["service.name"];
  const serviceName =
    typeof rawServiceName === "string" && rawServiceName.length > 0
      ? rawServiceName
      : null;

  const rawServiceVersion = resourceAttributes?.["service.version"];
  const serviceVersion =
    typeof rawServiceVersion === "string" && rawServiceVersion.length > 0
      ? rawServiceVersion
      : null;

  return { serviceName, serviceVersion };
}

/** No session key and no correlation: there is nothing to aggregate under.
 * The canonical row still holds the record. */
function resolveSessionIdentity({
  attributes,
  record,
}: {
  attributes: Record<string, unknown>;
  record: CanonicalLogRecord;
}): {
  sessionId: string | null;
  sessionKeySource: "provider" | "trace_fallback";
  correlationTraceId: string | null;
  correlationSpanId: string | null;
} {
  const sessionKey =
    resolveConversationKey(attributes) ?? (record.providerSessionId || null);
  const correlationTraceId =
    record.correlationSource !== "none" && record.correlationTraceId
      ? record.correlationTraceId
      : null;
  const correlationSpanId =
    record.correlationSource !== "none" && record.correlationSpanId
      ? record.correlationSpanId
      : null;

  return {
    sessionId: sessionKey ?? correlationTraceId,
    sessionKeySource: sessionKey !== null ? "provider" : "trace_fallback",
    correlationTraceId,
    correlationSpanId,
  };
}

function toContributeLogFactsCommand({
  record,
  facts,
  attributes,
  serviceName,
  sessionIdentity,
}: {
  record: CanonicalLogRecord;
  facts: Record<string, string | number | boolean>;
  attributes: Record<string, unknown>;
  serviceName: string | null;
  sessionIdentity: {
    sessionId: string;
    sessionKeySource: "provider" | "trace_fallback";
    correlationTraceId: string | null;
    correlationSpanId: string | null;
  };
}): ContributeLogFactsCommandData {
  return {
    tenantId: record.tenantId,
    sessionId: sessionIdentity.sessionId,
    sessionKeySource: sessionIdentity.sessionKeySource,
    agent: detectCodingAgent({
      scopeName: record.scopeName,
      recordName:
        typeof attributes["event.name"] === "string"
          ? (attributes["event.name"] as string)
          : null,
      serviceName,
    }),
    occurredAt: record.occurredAt,
    recordId: record.recordId,
    traceId: sessionIdentity.correlationTraceId,
    spanId: sessionIdentity.correlationSpanId,
    timeUnixMs: record.timeUnixMs,
    severityNumber: record.severityNumber,
    providerKind: record.providerKind,
    scopeName: record.scopeName || null,
    facts,
  };
}

/**
 * The log→session dispatcher (ADR-056 §2): a subscriber on log-processing's
 * stored canonical records that lifts a coding-agent log's scalar facts and
 * contributes them to its session.
 *
 * `liftCodingAgentLogFacts` is the gate — it returns null for anything that
 * is not a coding agent's record, so an ordinary application log costs one
 * detection call. The lifted vocabulary is scalars only; the record's
 * content stays in the canonical row, reachable via `recordId`.
 */
export function createCodingAgentLogFactsDispatchSubscriber(deps: {
  contributeLogFacts: (data: ContributeLogFactsCommandData) => Promise<void>;
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
      const rawAttributes = parseFlatAttributes(record.attributesFlatJson);
      if (rawAttributes === null) return;
      const attributes = withEventNameFallback(rawAttributes, record);

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

      const { serviceName, serviceVersion } = resolveServiceIdentity(
        parseFlatAttributes(record.resourceAttributesFlatJson),
      );
      if (serviceVersion !== null) {
        facts["service.version"] = serviceVersion;
      }

      const sessionIdentity = resolveSessionIdentity({ attributes, record });
      if (sessionIdentity.sessionId === null) return;

      await deps.contributeLogFacts(
        toContributeLogFactsCommand({
          record,
          facts,
          attributes,
          serviceName,
          sessionIdentity: {
            ...sessionIdentity,
            sessionId: sessionIdentity.sessionId,
          },
        }),
      );
    },
  };
}

/** The canonical row stores attributes flattened as JSON — parse or skip. */
function parseFlatAttributes(json: string): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
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

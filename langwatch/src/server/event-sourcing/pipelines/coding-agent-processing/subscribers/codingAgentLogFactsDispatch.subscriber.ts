import { createLogger } from "@langwatch/observability";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types";
import { CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE } from "../../log-processing/schemas/constants";
import type { LogProcessingEvent } from "../../log-processing/schemas/events";
import type { ContributeLogFactsCommandData } from "../schemas/commands";
import {
  detectCodingAgent,
  liftCodingAgentLogFacts,
  resolveConversationKey,
} from "../services/coding-agent-normalization";

const logger = createLogger(
  "langwatch:coding-agent:log-facts-dispatch",
);

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
      const attributes = parseFlatAttributes(record.attributesFlatJson);
      if (attributes === null) return;
      // The canonical preparation extracts `eventName` into its own column
      // and some agents only spell it there.
      if (record.eventName && attributes["event.name"] === undefined) {
        attributes["event.name"] = record.eventName;
      }

      const facts = liftCodingAgentLogFacts({
        scopeName: record.scopeName,
        attributes,
      });
      if (facts === null) return;

      const resourceAttributes = parseFlatAttributes(
        record.resourceAttributesFlatJson,
      );
      const serviceVersion = resourceAttributes?.["service.version"];
      if (typeof serviceVersion === "string" && serviceVersion.length > 0) {
        facts["service.version"] = serviceVersion;
      }

      const sessionKey =
        resolveConversationKey(attributes) ??
        (record.providerSessionId || null);
      const correlationTraceId =
        record.correlationSource !== "none" && record.correlationTraceId
          ? record.correlationTraceId
          : null;

      // No session key and no correlation: there is nothing to aggregate
      // under. The canonical row still holds the record.
      const sessionId = sessionKey ?? correlationTraceId;
      if (sessionId === null) return;

      await deps.contributeLogFacts({
        tenantId: record.tenantId,
        sessionId,
        sessionKeySource: sessionKey !== null ? "provider" : "trace_fallback",
        agent: detectCodingAgent({
          scopeName: record.scopeName,
          recordName:
            typeof attributes["event.name"] === "string"
              ? (attributes["event.name"] as string)
              : null,
        }),
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

/** The canonical row stores attributes flattened as JSON — parse or skip. */
function parseFlatAttributes(
  json: string,
): Record<string, unknown> | null {
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

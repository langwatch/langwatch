// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `governance_ocsf_events` as a real projection (ADR-075 Class C).
 *
 * WHY THIS IS A PROJECTION AND NOT A HANDLER
 * ------------------------------------------
 * This stream is an AUDIT trail. `folds.feature` and
 * `event-log-durability.feature` both told auditors it "derives from the
 * append-only event_log" and is "rebuildable at any time". It was not:
 * it was written by `governanceOcsfEventsSync.reactor.ts`, and the projection
 * router only ever dispatched a reactor on the live event path — replay
 * rebuilt folds and never invoked a reactor. An entry lost to a failed write
 * was lost
 * permanently, and the audit trail could diverge from the log it claims
 * to derive from with nothing able to notice or repair it.
 *
 * As a map projection it is rebuilt by `replayMapProjection`
 * (`projection.map(event) → store.append(record, ctx)`), so a rebuild
 * re-derives every governed activity in the replayed window.
 *
 * WHY PER SPAN, NOT PER TRACE
 * ---------------------------
 * The reactor keyed rows on `EventId = traceId`. Both the spec table
 * (`| event_id | the span_id (hex) or log_record id |`) and migration
 * 00026's own comment ("EventId is the span_id (hex) for span-shaped
 * traces") say the span id. Span grain is also what makes this stream
 * rebuildable at all: a span is an immutable event in the log, so the row
 * derived from it is a pure, total function of one event — the same input
 * always yields a byte-identical row under the same key. A trace-grained
 * row is a function of the trace's *whole* history, which only a stateful
 * fold can see, and whose intermediate states the reactor was writing one
 * over the other.
 *
 * Idempotency (the precondition, verified before relying on it):
 * `governance_ocsf_events` is
 * `ReplacingMergeTree(LastUpdatedAt) ORDER BY (TenantId, EventId)`
 * (migration 00026). `LastUpdatedAt` is `DEFAULT now64(3)` and this
 * projection does not set it, so a re-derived row carries a newer version
 * than the row it replaces and wins the merge — with identical content,
 * because the derivation reads nothing but the span. Re-running a rebuild
 * over events already recorded therefore converges instead of
 * accumulating. No migration is needed for this table.
 *
 * Spec: specs/ai-gateway/governance/folds.feature §"governance_ocsf_events"
 *       specs/ai-gateway/governance/siem-export.feature
 * ADR:  dev/docs/adr/075-post-event-work-subscribers-and-process-managers.md
 */

import {
  type GovernanceOcsfEventInput,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import { spanCostService } from "@ee/governance/services/spanDerivation.composition";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import { stringAttr } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-summary.utils";
import {
  type SpanReceivedEvent,
  spanReceivedEventSchema,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "~/server/event-sourcing/projections/abstractMapProjection";
import type { AppendStore } from "~/server/event-sourcing/projections/mapProjection.types";
import { GOVERNANCE_ATTR } from "../services/governanceAttributeKeys";
import {
  normalizeGovernanceSpanOrNull,
  readGovernanceSpanFacts,
} from "./governanceSpanFacts";

const spanEvents = [spanReceivedEventSchema] as const;

/** OCSF class/category emitted for every governance row (OWASP AOS API Activity). */
const OCSF_CLASS_API_ACTIVITY = 6003;
const OCSF_CATEGORY_APPLICATION_ACTIVITY = 6;

/**
 * Actor identity keys, in precedence order.
 *
 * `langwatch.user.id` is the canonical dotted form the spec names;
 * `langwatch.user_id` is the legacy form the receiver-side sources still
 * emit and the one the retired reactor read off the hoisted trace
 * attribute map. Reading both means the conversion does not silently drop
 * actor attribution for a source that has not migrated.
 */
const ACTOR_USER_ID_KEYS = [
  ATTR_KEYS.LANGWATCH_USER_ID,
  ATTR_KEYS.LANGWATCH_USER_ID_LEGACY,
] as const;

const ATTR_USER_EMAIL = "user.email";
const ATTR_ENDUSER_ID = "enduser.id";
const ATTR_TOOL_NAME = "tool.name";

/**
 * Fallback verb, kept from the reactor so a span with no tool name and no
 * span name still produces a non-empty OCSF `api.operation`.
 */
const ACTION_FALLBACK = "trace.recorded";

function firstStringAttr(
  span: NormalizedSpan,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = stringAttr(span.spanAttributes, key);
    if (value) return value;
  }
  return "";
}

/**
 * Derives the OCSF row for one governance span, or null when the span is
 * not governance traffic.
 *
 * PURE and TOTAL over its input: it reads the span and nothing else — no
 * clock, no random, no I/O, no accumulated state. That is what makes a
 * rebuild reproduce the live row exactly rather than approximately, and
 * it is the property the rebuild scenarios in folds.feature rest on.
 * Exported so tests can exercise the derivation without a queue.
 */
export function deriveGovernanceOcsfEvent({
  tenantId,
  span,
}: {
  tenantId: string;
  span: NormalizedSpan;
}): GovernanceOcsfEventInput | null {
  const facts = readGovernanceSpanFacts(span);
  if (!facts) return null;

  const actorUserId = firstStringAttr(span, ACTOR_USER_ID_KEYS);
  const actorEmail = stringAttr(span.spanAttributes, ATTR_USER_EMAIL) ?? "";
  const actorEnduserId = stringAttr(span.spanAttributes, ATTR_ENDUSER_ID) ?? "";

  // Action: the tool the span invoked, else the span's own name (what the
  // spec asks for now that the row is per span), else the historic sentinel.
  const actionName =
    stringAttr(span.spanAttributes, ATTR_TOOL_NAME) ||
    span.name ||
    ACTION_FALLBACK;

  // Target: the requested model, else whatever model the span resolved to.
  // Empty is acceptable — OCSF treats the target endpoint as optional.
  const targetName =
    stringAttr(span.spanAttributes, ATTR_KEYS.GEN_AI_REQUEST_MODEL) ??
    spanCostService.extractModelsFromSpan(span)[0] ??
    "";

  const anomalyAlertId =
    stringAttr(span.spanAttributes, GOVERNANCE_ATTR.ANOMALY_ALERT_ID) ?? "";
  const severityId = anomalyAlertId ? OCSF_SEVERITY.MEDIUM : OCSF_SEVERITY.INFO;

  const rawOcsfJson = JSON.stringify({
    class_uid: OCSF_CLASS_API_ACTIVITY,
    category_uid: OCSF_CATEGORY_APPLICATION_ACTIVITY,
    activity_id: OCSF_ACTIVITY.INVOKE,
    type_uid: OCSF_CLASS_API_ACTIVITY * 100 + OCSF_ACTIVITY.INVOKE,
    severity_id: severityId,
    time: facts.eventTimeMs,
    actor: {
      user: { uid: actorUserId, email_addr: actorEmail },
      enduser: { uid: actorEnduserId },
    },
    api: { operation: actionName },
    dst_endpoint: { name: targetName },
    metadata: {
      product: { name: "LangWatch", vendor_name: "LangWatch" },
      extension: {
        uid: "langwatch.governance",
        source_type: facts.sourceType,
        source_id: facts.sourceId,
        trace_id: facts.traceId,
        span_id: facts.eventId,
        anomaly_alert_id: anomalyAlertId || undefined,
      },
    },
  });

  return {
    tenantId,
    eventId: facts.eventId,
    traceId: facts.traceId,
    sourceId: facts.sourceId,
    sourceType: facts.sourceType,
    activityId: OCSF_ACTIVITY.INVOKE,
    severityId,
    eventTime: new Date(facts.eventTimeMs),
    actorUserId,
    actorEmail,
    actorEnduserId,
    actionName,
    targetName,
    anomalyAlertId,
    rawOcsfJson,
  };
}

/**
 * Map projection that derives one OCSF v1.1 audit row per governance span.
 *
 * Non-governance spans — the overwhelming majority of platform traffic —
 * are rejected by a raw-wire attribute scan BEFORE normalisation runs, so
 * this projection costs an array scan on the hot path and nothing more.
 */
export class GovernanceOcsfEventsMapProjection
  extends AbstractMapProjection<GovernanceOcsfEventInput, typeof spanEvents>
  implements MapEventHandlers<typeof spanEvents, GovernanceOcsfEventInput>
{
  readonly name = "governanceOcsfEvents";
  readonly store: AppendStore<GovernanceOcsfEventInput>;
  protected readonly events = spanEvents;

  override options = {
    // Per-span parallelism: OCSF rows are independent of each other and of
    // sibling spans — nothing is accumulated, so nothing needs ordering.
    groupKeyFn: (event: { id: string }) => `governance-ocsf:${event.id}`,
  };

  constructor(deps: { store: AppendStore<GovernanceOcsfEventInput> }) {
    super();
    this.store = deps.store;
  }

  mapTraceSpanReceived(
    event: SpanReceivedEvent,
  ): GovernanceOcsfEventInput | null {
    const span = normalizeGovernanceSpanOrNull(event);
    if (!span) return null;

    return deriveGovernanceOcsfEvent({ tenantId: event.tenantId, span });
  }
}

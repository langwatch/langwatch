// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type GovernanceOcsfEventInput,
  type GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type {
  ReactorContext,
  ReactorDefinition,
} from "~/server/event-sourcing/reactors/reactor.types";
import { throttledPerWindow } from "~/server/event-sourcing/reactors/throttleWindow";
import { captureException, toError } from "~/utils/posthogErrorCapture";

const logger = createLogger(
  "langwatch:trace-processing:governance-ocsf-events-sync-reactor",
);

/**
 * Dedup window for the same trace's reactor firings. Within this
 * window, replays for the same (tenant, trace) are suppressed by the
 * BullMQ job-id contract. Outside the window, structural idempotency
 * comes from the ReplacingMergeTree(LastUpdatedAt) ORDER BY
 * (TenantId, EventId) — replays collapse to the latest version of
 * the same row.
 */
/**
 * OCSF rows are pulled by cursor-paginated SIEM consumers that keep their own
 * watermark, so a row landing half a minute later is picked up by the next
 * pull rather than missed.
 */
export const GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS = 30_000;

import {
  GOVERNANCE_ATTR,
  isGovernanceOriginTrace,
} from "../services/governanceAttributeKeys";

const ATTR_INGESTION_SOURCE_ID = GOVERNANCE_ATTR.INGESTION_SOURCE_ID;
const ATTR_INGESTION_SOURCE_TYPE = GOVERNANCE_ATTR.INGESTION_SOURCE_TYPE;
const ATTR_USER_ID = GOVERNANCE_ATTR.USER_ID;
const ATTR_USER_EMAIL = "user.email";
const ATTR_ENDUSER_ID = "enduser.id";
const ATTR_GEN_AI_REQUEST_MODEL = "gen_ai.request.model";
const ATTR_TOOL_NAME = "tool.name";
const ATTR_ANOMALY_ALERT_ID = GOVERNANCE_ATTR.ANOMALY_ALERT_ID;

export interface GovernanceOcsfEventsSyncReactorDeps {
  governanceOcsfEventsRepository: GovernanceOcsfEventsClickHouseRepository;
}

/**
 * Projects one governance trace onto an OCSF v1.1 row.
 *
 * Action prefers the trace's tool invocation as the verb; non-LLM activity
 * (agent CRUD, plain traces) falls back to a generic "trace.recorded",
 * which is better than an empty operation.
 *
 * Target prefers `gen_ai.request.model`, falling back to the rolled-up
 * Models[0] on the fold state. For non-LLM events Models[] may be empty —
 * an empty target is acceptable per the OCSF spec, where it is optional.
 *
 * Severity is INFO unless the trace carries an anomaly alert, which
 * elevates it to MEDIUM per the spec.
 */
function buildOcsfEventRow({
  tenantId,
  foldState,
  sourceId,
  occurredAtMs,
}: {
  tenantId: string;
  foldState: TraceSummaryData;
  sourceId: string;
  occurredAtMs: number;
}): GovernanceOcsfEventInput {
  const sourceType =
    foldState.attributes[ATTR_INGESTION_SOURCE_TYPE] ?? "unknown";
  const actorUserId = foldState.attributes[ATTR_USER_ID] ?? "";
  const actorEmail = foldState.attributes[ATTR_USER_EMAIL] ?? "";
  const actorEnduserId = foldState.attributes[ATTR_ENDUSER_ID] ?? "";
  const actionName = foldState.attributes[ATTR_TOOL_NAME] ?? "trace.recorded";
  const targetName =
    foldState.attributes[ATTR_GEN_AI_REQUEST_MODEL] ??
    foldState.models[0] ??
    "";
  const anomalyAlertId = foldState.attributes[ATTR_ANOMALY_ALERT_ID] ?? "";
  const severityId = anomalyAlertId ? OCSF_SEVERITY.MEDIUM : OCSF_SEVERITY.INFO;

  const rawOcsfJson = JSON.stringify({
    class_uid: 6003,
    category_uid: 6,
    activity_id: OCSF_ACTIVITY.INVOKE,
    type_uid: 6003 * 100 + OCSF_ACTIVITY.INVOKE,
    severity_id: severityId,
    time: occurredAtMs,
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
        source_type: sourceType,
        source_id: sourceId,
        trace_id: foldState.traceId,
        anomaly_alert_id: anomalyAlertId || undefined,
      },
    },
  });

  return {
    tenantId,
    eventId: foldState.traceId,
    traceId: foldState.traceId,
    sourceId,
    sourceType,
    activityId: OCSF_ACTIVITY.INVOKE,
    severityId,
    eventTime: new Date(occurredAtMs),
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
 * Folds completed governance-origin traces into per-event OCSF v1.1
 * rows in ClickHouse. Each trace produces ONE row keyed by
 * (TenantId, EventId) where EventId = traceId (we use traceId as
 * the per-trace OCSF event identifier; per-span OCSF emission would
 * be too noisy for SIEM consumers — the trace-level rollup is the
 * security-relevant unit).
 *
 * Registered on the trace_processing pipeline downstream of the
 * traceSummary fold. Reads governance origin attributes + actor
 * identity + target model off the fold state. Traces without
 * `langwatch.origin.kind = "ingestion_source"` are not governance
 * traffic and are declined before a job is enqueued.
 *
 * The row itself is built by `buildOcsfEventRow`.
 *
 * Spec: specs/ai-gateway/governance/folds.feature §"governance_ocsf_events"
 */
export function createGovernanceOcsfEventsSyncReactor(
  deps: GovernanceOcsfEventsSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "governanceOcsfEventsSync",
    // Pre-enqueue (ADR-026). See governanceKpisSync for the reasoning: the
    // origin check is pure, reads the payload the handler would receive, and
    // rejects the bulk of trace traffic before a job is packed. Kept in
    // `handle` too — inline mode, fail-open dispatch, and jobs queued before
    // this gate existed all still reach the handler.
    shouldReact: (_event, context) =>
      isGovernanceOriginTrace(context.foldState.attributes),
    options: {
      // NOTE: the handler swallows repository failures by design (see its
      // catch, and the test pinning it). The window makes that cheaper to get
      // wrong: a burst now leaves ONE job, so a failed write is retried by
      // the NEXT window rather than by the next span, and a failure in a
      // trace's final window is not retried at all. Whether these should
      // rethrow is an open question — rethrowing retries the job under Redis,
      // but on the in-memory queue `send` awaits completion, so it would
      // surface as fold redelivery instead.
      // Level-triggered: the envelope is rebuilt from the fold's current
      // state, so the LAST event of a trace must always land.
      ...throttledPerWindow({
        makeJobId: (payload) =>
          `governance-ocsf-events-sync-${payload.event.tenantId}-${payload.event.aggregateId}`,
        windowMs: GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
      }),
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;

      if (!isGovernanceOriginTrace(foldState.attributes)) {
        return;
      }

      const sourceId = foldState.attributes[ATTR_INGESTION_SOURCE_ID];
      if (!sourceId) {
        logger.warn(
          {
            tenantId,
            traceId: foldState.traceId,
          },
          "governance trace missing langwatch.ingestion_source.id — skipping OCSF fold",
        );
        return;
      }

      const occurredAtMs = foldState.occurredAt;
      if (!occurredAtMs || occurredAtMs <= 0) {
        return;
      }

      try {
        await deps.governanceOcsfEventsRepository.insertEvent(
          buildOcsfEventRow({ tenantId, foldState, sourceId, occurredAtMs }),
        );
      } catch (error) {
        logger.error(
          {
            tenantId,
            sourceId,
            traceId: foldState.traceId,
            error,
          },
          "failed to fold governance trace into governance_ocsf_events",
        );
        captureException(toError(error));
      }
    },
  };
}

import {
  GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
  type GovernanceOcsfEventInput,
} from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import type {
  ReactorContext,
  ReactorDefinition,
} from "~/server/event-sourcing/reactors/reactor.types";
import type { TraceSummaryData } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";

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
export const GOVERNANCE_OCSF_EVENTS_SYNC_DEBOUNCE_TTL_MS = 5 * 60_000;

const ATTR_ORIGIN_KIND = "langwatch.origin.kind";
const ATTR_INGESTION_SOURCE_ID = "langwatch.ingestion_source.id";
const ATTR_INGESTION_SOURCE_TYPE = "langwatch.ingestion_source.source_type";
const ATTR_USER_ID = "langwatch.user_id";
const ATTR_USER_EMAIL = "user.email";
const ATTR_ENDUSER_ID = "enduser.id";
const ATTR_GEN_AI_REQUEST_MODEL = "gen_ai.request.model";
const ATTR_TOOL_NAME = "tool.name";
const ATTR_ANOMALY_ALERT_ID = "langwatch.governance.anomaly_alert_id";
const ORIGIN_KIND_VALUE = "ingestion_source";

export interface GovernanceOcsfEventsSyncReactorDeps {
  governanceOcsfEventsRepository: GovernanceOcsfEventsClickHouseRepository;
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
 * `langwatch.origin.kind = "ingestion_source"` are skipped — not
 * governance traffic.
 *
 * Severity is INFO by default; elevated to MEDIUM (warning tier)
 * when `langwatch.governance.anomaly_alert_id` is set per the spec.
 *
 * Spec: specs/ai-gateway/governance/folds.feature §"governance_ocsf_events"
 */
export function createGovernanceOcsfEventsSyncReactor(
  deps: GovernanceOcsfEventsSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "governanceOcsfEventsSync",
    options: {
      makeJobId: (payload) =>
        `governance-ocsf-events-sync-${payload.event.tenantId}-${payload.event.aggregateId}`,
      ttl: GOVERNANCE_OCSF_EVENTS_SYNC_DEBOUNCE_TTL_MS,
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;

      const originKind = foldState.attributes[ATTR_ORIGIN_KIND];
      if (originKind !== ORIGIN_KIND_VALUE) {
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
        const sourceType =
          foldState.attributes[ATTR_INGESTION_SOURCE_TYPE] ?? "unknown";
        const actorUserId = foldState.attributes[ATTR_USER_ID] ?? "";
        const actorEmail = foldState.attributes[ATTR_USER_EMAIL] ?? "";
        const actorEnduserId = foldState.attributes[ATTR_ENDUSER_ID] ?? "";

        // Action: prefer the trace's first model invocation as the verb.
        // For non-LLM activity (tool calls, agent CRUD), action will fall
        // back to a generic "trace.recorded" — better than empty.
        const actionName =
          foldState.attributes[ATTR_TOOL_NAME] ?? "trace.recorded";

        // Target: prefer gen_ai.request.model for LLM invocations; fall
        // back to the rolled-up Models[0] from the fold state. For
        // non-LLM events, Models[] may be empty — empty target is
        // acceptable per OCSF spec (target is optional).
        const targetName =
          foldState.attributes[ATTR_GEN_AI_REQUEST_MODEL] ??
          foldState.models[0] ??
          "";

        const anomalyAlertId =
          foldState.attributes[ATTR_ANOMALY_ALERT_ID] ?? "";
        const severityId = anomalyAlertId
          ? OCSF_SEVERITY.MEDIUM
          : OCSF_SEVERITY.INFO;

        const eventTime = new Date(occurredAtMs);
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

        const row: GovernanceOcsfEventInput = {
          tenantId,
          eventId: foldState.traceId,
          traceId: foldState.traceId,
          sourceId,
          sourceType,
          activityId: OCSF_ACTIVITY.INVOKE,
          severityId,
          eventTime,
          actorUserId,
          actorEmail,
          actorEnduserId,
          actionName,
          targetName,
          anomalyAlertId,
          rawOcsfJson,
        };

        await deps.governanceOcsfEventsRepository.insertEvent(row);
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
        captureException(error);
      }
    },
  };
}

import { createLogger } from "@langwatch/observability";
import {
  NOTIFY_TRIGGER_ACTIONS,
  triggerReadsEvaluations,
} from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { TriggerMatchRecordedEventData } from "~/server/event-sourcing/pipelines/automations/schemas/events";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
} from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/constants";
import type { EvaluationProcessingEvent } from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/events";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import type { EventSubscriberDefinition } from "~/server/event-sourcing/subscribers/eventSubscriber.types";

const logger = createLogger(
  "langwatch:triggers:evaluation-alert-trigger-match-subscriber",
);

/** Debounce window before an evaluation outcome is matched against automations. */
const EVALUATION_ALERT_TRIGGER_MATCH_DELAY_MS = 10_000;

/** Dedup window collapsing repeat outcomes on one evaluation into one match run. */
const EVALUATION_ALERT_TRIGGER_MATCH_DEDUP_TTL_MS = 30_000;

/** Replay floods, resyncs and late-arriving results never raise a live alert. */
const EVALUATION_ALERT_TRIGGER_MATCH_MAX_AGE_MS = 60 * 60 * 1000;

/** The evaluation statuses that represent a finished run worth alerting on. */
const TERMINAL_EVALUATION_STATUSES = new Set(["processed", "error", "skipped"]);

/**
 * Port for handing a matched trigger off into the automations pipeline. Defined
 * here in the OSS automations pipeline (Apache-2.0) so the Enterprise
 * trace-alert subscriber depends inward on OSS, never the reverse. The payload
 * is a plain, license-agnostic shape with nothing EE-specific.
 */
export interface RecordTriggerMatchPort {
  send(
    data: TriggerMatchRecordedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}

interface EvaluationAlertTriggerMatchDeps {
  triggers: TriggerService;
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  recordTriggerMatch: RecordTriggerMatchPort;
}

/**
 * The two facts this subscriber acts on, read off the committed event itself
 * rather than off the fold the same event feeds (event-carried state transfer,
 * ADR-075): a terminal status, and the trace the outcome belongs to.
 *
 * **Total by construction — it must be.** This doubles as the enqueue filter,
 * and the routing path has no retry, so a throw there permanently loses the
 * job for this event. Every branch below is a `typeof` check, a length check or
 * a set lookup; there is no decoding, no I/O and no fold read. Anything
 * fallible belongs in `handle`, where a failure retries that job alone.
 *
 * `traceId` is absent on every `lw.evaluation.completed` event committed before
 * the field was added to the schema, and on any `reported` event for an
 * evaluation that never named a trace. Absence is a skip, exactly as the fold
 * read it before: an evaluation nobody can point at a trace has no trace
 * summary to match automations against.
 */
function readAlertableOutcome(
  event: EvaluationProcessingEvent,
): { traceId: string } | null {
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null) return null;
  const { status, traceId } = data as { status?: unknown; traceId?: unknown };
  if (typeof status !== "string" || !TERMINAL_EVALUATION_STATUSES.has(status)) {
    return null;
  }
  if (typeof traceId !== "string" || traceId.length === 0) return null;
  return { traceId };
}

/**
 * Matches a finished evaluation against the project's trace automations
 * (ADR-075 Class B): a plain event subscriber, with no fold bound to it.
 *
 * It reads `status` and `traceId` off the evaluation event, and the trace
 * summary off a DIFFERENT aggregate's projection — a legitimate cross-aggregate
 * read, unlike reading back the projection built from the stream being
 * consumed, which races its own writer.
 *
 * The status/trace gate runs twice on purpose. As `enqueue.filter` it stops an
 * unalertable event minting a job at all; as the first thing `handle` does it
 * keeps the subscriber correct for jobs a build without the filter already
 * staged, which a rolling deploy leaves in the queue.
 */
export function createEvaluationAlertTriggerMatchSubscriber(
  deps: EvaluationAlertTriggerMatchDeps,
): EventSubscriberDefinition<EvaluationProcessingEvent> {
  return {
    name: "triggerMatch",
    eventTypes: [
      EVALUATION_COMPLETED_EVENT_TYPE,
      EVALUATION_REPORTED_EVENT_TYPE,
    ],
    options: {
      delay: EVALUATION_ALERT_TRIGGER_MATCH_DELAY_MS,
      deduplication: {
        // Keyed exactly as the fold-bound registration keyed it, so the
        // conversion cannot double-match an evaluation mid-deploy.
        makeId: (event) =>
          `subscriber:triggerMatch:${event.tenantId}:${String(event.aggregateId)}`,
        ttlMs: EVALUATION_ALERT_TRIGGER_MATCH_DEDUP_TTL_MS,
      },
      enqueue: { filter: (event) => readAlertableOutcome(event) !== null },
    },

    async handle(event, context): Promise<void> {
      if (
        event.occurredAt <
        Date.now() - EVALUATION_ALERT_TRIGGER_MATCH_MAX_AGE_MS
      ) {
        return;
      }
      const outcome = readAlertableOutcome(event);
      if (!outcome) return;
      const { traceId } = outcome;

      const traceSummary = await deps.traceSummaryStore.get(traceId, {
        tenantId: createTenantId(context.tenantId),
        aggregateId: traceId,
      });
      if (!traceSummary) {
        logger.debug(
          { tenantId: context.tenantId, traceId },
          "Trace summary not found for evaluation automation match",
        );
        return;
      }
      const triggers = await deps.triggers.getActiveTraceTriggersForProject(
        context.tenantId,
      );
      for (const trigger of triggers.filter(triggerReadsEvaluations)) {
        // Same idempotency contract as traceAlertTriggerMatch.subscriber: all
        // idempotency-key inputs (triggerId, traceId, occurredAt) derive from
        // the committed event or trigger config — never wall-clock at handling
        // time — so redelivery re-sends identical, store-deduped commands.
        await deps.recordTriggerMatch.send({
          tenantId: context.tenantId,
          occurredAt: event.occurredAt,
          triggerId: trigger.id,
          traceId,
          action: trigger.action,
          actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action)
            ? "notify"
            : "persist",
          traceDebounceMs: trigger.traceDebounceMs,
          notificationCadence: trigger.notificationCadence,
        });
      }
    },
  };
}

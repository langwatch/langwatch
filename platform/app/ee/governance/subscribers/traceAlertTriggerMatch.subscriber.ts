// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { NOTIFY_TRIGGER_ACTIONS } from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerContext } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";
import type { RecordTriggerMatchPort } from "~/server/event-sourcing.old/pipelines/automations/subscribers/evaluationAlertTriggerMatch.subscriber";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  STALE_TRACE_THRESHOLD_MS,
} from "~/server/event-sourcing.old/pipelines/trace-processing/schemas/constants";
import type { TraceProcessingEvent } from "~/server/event-sourcing.old/pipelines/trace-processing/schemas/events";
import { passesTraceOriginGuards } from "~/server/event-sourcing.old/pipelines/trace-processing/traceOriginGuards";
import type { EventSubscriberDefinition } from "~/server/event-sourcing.old/subscribers/eventSubscriber.types";
import { classifyTriggerFilters } from "~/server/filters/triggerFilter.matcher";

/** Debounce window before a trace is matched against automations. */
export const TRACE_ALERT_TRIGGER_MATCH_DELAY_MS = 30_000;

/** Dedup window collapsing a burst of spans on one trace into one match run. */
export const TRACE_ALERT_TRIGGER_MATCH_DEDUP_TTL_MS = 30_000;

/**
 * What the match needs from the trace domain.
 *
 * The committed trace summary is read here rather than handed in as fold state:
 * the trace-alert match is a plain event subscriber now (ADR-075 Class B), and
 * a subscriber has no projection bound to it.
 *
 * The debounce window makes a committed summary the overwhelmingly likely case,
 * but it is a timing assumption, not an ordering guarantee — the fold lane is
 * allowed to run behind, and this system is built to tolerate that. So a miss
 * is treated as "we could not find out", not "there is nothing to match": see
 * {@link createTraceAlertTriggerMatchSubscriber}.
 */
export interface TraceAlertTriggerMatchDeps {
  triggers: TriggerService;
  recordTriggerMatch: RecordTriggerMatchPort;
  readTraceSummary: (params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }) => Promise<TraceSummaryData | null>;
}

/**
 * Matches a trace against the project's automations.
 *
 * The origin guards run twice on purpose. Their event-only half is the
 * `enqueue.filter`, so a stale or non-message event never mints a job at all —
 * a 10k-span trace fans this out once per span, and nearly all of it is
 * rejected before the queue pays for it. The full chain then re-runs inside the
 * handler against the committed summary, which keeps the subscriber correct for
 * jobs a build without the filter already staged (a rolling deploy leaves those
 * in the queue).
 *
 * The dedup key is byte-identical to the one the fold-bound registration
 * derived, so the conversion cannot double-match a trace mid-deploy.
 *
 * **A trace whose summary cannot be read throws.** The handler's own lane is
 * the one seam here that retries: unlike the routing/enqueue hooks — where a
 * throw loses the job for good (ADR-069/ADR-075) — a subscriber job that
 * rejects is re-leased by the group queue with backoff, and parks its group
 * once the budget is spent. Parking is per (subscriber, tenant, trace), so a
 * trace that never folds is visible and self-limiting.
 *
 * Returning instead would drop that trace's alerts silently and permanently.
 * "The next event asks again" does not hold: a trace is a burst of spans and
 * then nothing, and the dedup key covers the whole burst, so the staged job is
 * usually the only one that will ever run for it. The declines below are the
 * opposite case — an origin the trace resolved against, or filters that do not
 * match, are answers, and answers do not retry. This mirrors the
 * process-manager sibling (`evaluationTriggerIntentHandlers`), which throws on
 * the same miss for the same reason.
 */
export function createTraceAlertTriggerMatchSubscriber(
  deps: TraceAlertTriggerMatchDeps,
): EventSubscriberDefinition<TraceProcessingEvent> {
  const handler = createTraceAlertTriggerMatchHandler(deps);

  return {
    name: "triggerMatch",
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
    options: {
      delay: TRACE_ALERT_TRIGGER_MATCH_DELAY_MS,
      deduplication: {
        makeId: (event) =>
          `subscriber:triggerMatch:${event.tenantId}:${String(event.aggregateId)}`,
        ttlMs: TRACE_ALERT_TRIGGER_MATCH_DEDUP_TTL_MS,
      },
      // Pure and total: a timestamp comparison. The event-type half is already
      // expressed by `eventTypes`.
      enqueue: {
        filter: (event) =>
          event.occurredAt >= Date.now() - STALE_TRACE_THRESHOLD_MS,
      },
    },

    async handle(event, context): Promise<void> {
      if (!context.aggregateId) return;

      const state = await deps.readTraceSummary({
        tenantId: context.tenantId,
        traceId: context.aggregateId,
        occurredAtMs: event.occurredAt,
      });
      // Not "this trace matches nothing" — "we could not find out". Throwing
      // hands the job back to the queue, which asks again on the next attempt;
      // returning would drop this trace's alerts with nothing recorded.
      if (!state) {
        throw new Error(
          `Trace summary not found for trace-alert trigger match (trace ${context.aggregateId})`,
        );
      }

      await handler(event, {
        tenantId: context.tenantId,
        aggregateId: context.aggregateId,
        state,
      });
    },
  };
}

/** Post-traceSummary, origin-guarded handoff into the automations pipeline. */
export function createTraceAlertTriggerMatchHandler(deps: {
  triggers: TriggerService;
  recordTriggerMatch: RecordTriggerMatchPort;
}) {
  return async (
    event: TraceProcessingEvent,
    context: TriggerContext<TraceSummaryData>,
  ): Promise<void> => {
    if (!passesTraceOriginGuards(event, context.state)) return;
    // Events already committed with an empty aggregateId (see the traceId
    // guard in originGate.process.ts) would fail recordTriggerMatch validation
    // and poison the subscriber job. There is no trace to match a trigger
    // against, so skip rather than throw.
    if (!context.aggregateId) return;
    const triggers = await deps.triggers.getActiveTraceTriggersForProject(
      context.tenantId,
    );
    for (const trigger of triggers) {
      if (classifyTriggerFilters(trigger.filters).hasEvaluationFilters)
        continue;
      // Idempotency contract (at-least-once delivery): every input to the
      // command's idempotency key — triggerId, traceId, and the settle-window
      // bucket derived from occurredAt + traceDebounceMs — comes from the
      // committed event or trigger config, never wall-clock at handling time.
      // A redelivered event therefore re-sends byte-identical commands whose
      // events collapse on idempotencyKey in the store.
      await deps.recordTriggerMatch.send({
        tenantId: context.tenantId,
        occurredAt: event.occurredAt,
        triggerId: trigger.id,
        traceId: context.aggregateId,
        action: trigger.action,
        actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action)
          ? "notify"
          : "persist",
        traceDebounceMs: trigger.traceDebounceMs,
        notificationCadence: trigger.notificationCadence,
      });
    }
  };
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesTriggerFilters,
  triggerFiltersReferenceEvents,
} from "~/server/filters/triggerFilter.matcher";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import type { ReactorDefinition } from "~/server/event-sourcing/reactors/reactor.types";
import { isDispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import {
  dispatchTriggerAction,
  NOTIFY_TRIGGER_ACTIONS,
  type TriggerActionDispatchDeps,
} from "~/server/event-sourcing/pipelines/shared/triggerActionDispatch";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { defineOriginGuardedTraceReactor } from "~/server/event-sourcing/pipelines/trace-processing/reactors/_originGuardedReactor";

const logger = createLogger("langwatch:trace-processing:alert-trigger-reactor");

export type AlertTriggerReactorDeps = TriggerActionDispatchDeps & {
  /**
   * Derives the trace-level events list from stored_spans. Only invoked when a
   * trigger actually filters on event fields (see triggerFiltersReferenceEvents),
   * so the common no-event-filter path pays nothing.
   */
  deriveEvents: (params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    foldVersion?: number;
  }) => Promise<DerivedTraceEvent[]>;
};

/**
 * Persist-class branch of the trace-pipeline alert trigger reactor.
 *
 * Fires on every trace event (via traceSummary fold). For each active
 * trace-only trigger whose action is PERSIST (dataset write, annotation
 * queue add), evaluates filters in-memory against the fold state and
 * — on match — claims `TriggerSent` and dispatches inline.
 *
 * NOTIFY-class actions (email / Slack) are owned by
 * `alertTriggerNotifyOutbox.reactor.ts`, registered via `.withOutbox`.
 * Splitting the two paths means persist work runs synchronously
 * (fire-and-forget into PG) while notify work flows through the
 * outbox's settle/cadence dispatch — the operator's two-knob timing
 * model (`traceDebounceMs`, `notificationCadence`) only applies to the
 * notify path. Triggers with evaluation filters are handled by the
 * evaluation pipeline reactors and skipped here.
 */
export function createAlertTriggerReactor(
  deps: AlertTriggerReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return defineOriginGuardedTraceReactor({
    name: "alertTrigger",
    jobIdPrefix: "alert-trigger",
    async handle(_event, context) {
      const { tenantId, aggregateId: traceId, foldState } = context;

      const triggers = await deps.triggers.getActiveTraceTriggersForProject(
        tenantId,
      );
      if (triggers.length === 0) return;

      // Restrict to persist-class trace-only triggers. NOTIFY-class
      // triggers are handled by the .withOutbox-registered notify
      // reactor; eval-filter triggers are handled by the evaluation
      // pipeline. Pre-filtering here also lets us skip the
      // (potentially expensive) events derivation when the only
      // matching triggers are notify-class.
      const persistTriggers = triggers.filter((t) => {
        const { hasEvaluationFilters } = classifyTriggerFilters(t.filters);
        return !hasEvaluationFilters && !NOTIFY_TRIGGER_ACTIONS.has(t.action);
      });
      if (persistTriggers.length === 0) return;

      const needsEvents = persistTriggers.some((t) => {
        const { traceFilters } = classifyTriggerFilters(t.filters);
        return triggerFiltersReferenceEvents(traceFilters);
      });
      const events = needsEvents
        ? await deps.deriveEvents({
            tenantId,
            traceId,
            occurredAtMs: foldState.occurredAt,
            foldVersion: foldState.spanCount,
          })
        : null;

      const traceData = buildPreconditionTraceDataFromFoldState(
        foldState,
        events,
      );

      for (const trigger of persistTriggers) {
        try {
          const { traceFilters } = classifyTriggerFilters(trigger.filters);

          // Filter check against the current (possibly half-formed)
          // fold state. Persist actions don't pay the settle-stage
          // re-read because the side effect is idempotent at the
          // TriggerSent gate below.
          if (
            Object.keys(traceFilters).length > 0 &&
            !matchesTriggerFilters(traceData, traceFilters)
          ) {
            continue;
          }

          // Atomic claim: insert TriggerSent first, dispatch only on
          // success. Two reactors racing on the same trigger/trace
          // (trace pipeline + eval pipeline) will see exactly one
          // true. A reactor retry after a dispatch failure also sees
          // false here — at-most-once.
          const claimed = await deps.triggers.claimSend({
            triggerId: trigger.id,
            traceId,
            projectId: tenantId,
          });
          if (!claimed) continue;

          await dispatchTriggerAction({
            deps,
            trigger,
            traceId,
            tenantId,
            foldState,
          });
        } catch (error) {
          // A failed dispatch now throws (DispatchError) rather than
          // being swallowed; surface its retryable classification for
          // operators. Persist-class dispatch is inline (no outbox
          // retry), so the claim has already landed by the time the
          // error fires.
          const retryable = isDispatchError(error) ? error.retryable : undefined;
          logger.error(
            {
              tenantId,
              traceId,
              triggerId: trigger.id,
              retryable,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to evaluate trigger",
          );
          captureException(error, {
            extra: {
              tenantId,
              traceId,
              triggerId: trigger.id,
              triggerAction: trigger.action,
              retryable,
            },
          });
        }
      }
    },
  });
}

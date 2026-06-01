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
 * Evaluates user-defined trace-based triggers reactively when traces arrive.
 *
 * Fires on every trace event (via traceSummary fold). For each active trigger
 * on the tenant, evaluates filters in-memory against the fold state. If all
 * filters match and the trace hasn't already been sent for this trigger,
 * dispatches the configured action (email, Slack, dataset, annotation queue).
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

      // Derive the trace-level events list only if a trace-only trigger filters
      // on event fields. Triggers with evaluation filters are skipped below
      // (handled by evaluationAlertTrigger), so they don't need events here.
      const needsEvents = triggers.some((t) => {
        const { hasEvaluationFilters, traceFilters } = classifyTriggerFilters(
          t.filters,
        );
        return !hasEvaluationFilters && triggerFiltersReferenceEvents(traceFilters);
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

      for (const trigger of triggers) {
        try {
          const { traceFilters, hasEvaluationFilters } =
            classifyTriggerFilters(trigger.filters);

          // Skip triggers that require evaluation results (handled by evaluationAlertTrigger)
          if (hasEvaluationFilters) continue;

          // Outbox path: notify-class triggers route through the unified
          // outbox queue (`stage: "settle"`). The settle dispatcher re-reads
          // the now-settled fold after `traceDebounceMs`, re-runs filters
          // against fresh state, claims TriggerSent, and re-enqueues as
          // cadence on match. Skip the inline filter check + claim here so
          // a half-formed early match doesn't shoot first.
          if (
            deps.enqueueSettle &&
            NOTIFY_TRIGGER_ACTIONS.has(trigger.action)
          ) {
            await deps.enqueueSettle({
              projectId: tenantId,
              triggerId: trigger.id,
              traceId,
              foldState,
            });
            continue;
          }

          // Inline path: persist-class actions (dataset, annotation queue)
          // and the legacy unwired notify path. Filter check + claim +
          // dispatch all happen here against the current (possibly
          // half-formed) fold state.
          if (
            Object.keys(traceFilters).length > 0 &&
            !matchesTriggerFilters(traceData, traceFilters)
          ) {
            continue;
          }

          // Atomic claim: insert TriggerSent first, dispatch only on success.
          // Two reactors racing on the same trigger/trace (trace pipeline +
          // eval pipeline) will see exactly one true. A reactor retry after
          // a dispatch failure also sees false here — at-most-once.
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
          // A failed dispatch now throws (DispatchError) rather than being
          // swallowed; surface its retryable classification for operators. The
          // claim already landed, so the in-line path does not retry — the
          // outbox migration is what adds durable retry.
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

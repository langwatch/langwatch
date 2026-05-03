// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesTriggerFilters,
} from "~/server/filters/triggerFilter.matcher";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import type { ReactorDefinition } from "~/server/event-sourcing/reactors/reactor.types";
import {
  dispatchTriggerAction,
  type TriggerActionDispatchDeps,
} from "~/server/event-sourcing/pipelines/shared/triggerActionDispatch";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { defineOriginGuardedTraceReactor } from "~/server/event-sourcing/pipelines/trace-processing/reactors/_originGuardedReactor";

const logger = createLogger("langwatch:trace-processing:alert-trigger-reactor");

export type AlertTriggerReactorDeps = TriggerActionDispatchDeps;

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

      const traceData = buildPreconditionTraceDataFromFoldState(foldState);

      for (const trigger of triggers) {
        try {
          const { traceFilters, hasEvaluationFilters } =
            classifyTriggerFilters(trigger.filters);

          // Skip triggers that require evaluation results (handled by evaluationAlertTrigger)
          if (hasEvaluationFilters) continue;

          // Skip if no trace filters match
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
          logger.error(
            {
              tenantId,
              traceId,
              triggerId: trigger.id,
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
            },
          });
        }
      }
    },
  });
}

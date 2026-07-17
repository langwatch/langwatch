// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { NOTIFY_TRIGGER_ACTIONS } from "~/server/app-layer/triggers/dispatch/triggerActionDispatch";
import type { TriggerSettlementFacts } from "~/server/app-layer/triggers/process-manager/triggerSettlement.process";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import type {
  Fact,
  FeedFn,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { passesTraceOriginGuards } from "~/server/event-sourcing/pipelines/trace-processing/reactors/_originGuardedSubscriber";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { classifyTriggerFilters } from "~/server/filters/triggerFilter.matcher";

/**
 * ADR-052: trace-side alert-trigger match detection — the triggerSettlement
 * process manager's `{ fold: "traceSummary" }` feed. Replaces the
 * `alertTrigger` (persist) and `alertTriggerNotifyOutbox` (notify)
 * `.withOutbox` reactors in one pass over the active triggers.
 *
 * Runs post-fold: `ctx.state` is the committed traceSummary, sequenced
 * ≥ this event, so the origin guards read consistent state exactly as the
 * legacy reactors did. Triggers whose subject reads evaluations fire from
 * the evaluation-pipeline feed instead.
 */
export function createTraceAlertTriggerMatchFeed(deps: {
  triggers: TriggerService;
}): FeedFn<TraceProcessingEvent, TriggerSettlementFacts, TraceSummaryData> {
  return async (event, { tenantId, aggregateId: traceId, state }) => {
    if (!passesTraceOriginGuards(event, state)) return [];

    const triggers =
      await deps.triggers.getActiveTraceTriggersForProject(tenantId);
    if (triggers.length === 0) return [];

    const facts: Array<Fact<TriggerSettlementFacts>> = [];
    for (const trigger of triggers) {
      const { hasEvaluationFilters } = classifyTriggerFilters(trigger.filters);
      // Evaluation-filtered triggers fire from the evaluation pipeline.
      if (hasEvaluationFilters) continue;

      facts.push({
        key: trigger.id,
        fact: "trigger-match",
        data: {
          traceId,
          action: trigger.action,
          actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action)
            ? "notify"
            : "persist",
          traceDebounceMs: trigger.traceDebounceMs,
          notificationCadence: trigger.notificationCadence,
        },
      });
    }
    return facts;
  };
}

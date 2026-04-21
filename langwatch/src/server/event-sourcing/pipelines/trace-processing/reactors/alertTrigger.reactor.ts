import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesTriggerFilters,
} from "~/server/filters/triggerFilter.matcher";
import type { DatasetRecordEntry } from "~/server/datasets/types";
import type { Trace } from "~/server/tracer/types";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../schemas/events";
import {
  dispatchTriggerAction,
  type TriggerActionDispatchDeps,
} from "../../shared/triggerActionDispatch";

const logger = createLogger("langwatch:trace-processing:alert-trigger-reactor");

export interface AlertTriggerReactorDeps extends TriggerActionDispatchDeps {
  triggers: TriggerService;
  projects: ProjectService;
  traceById: (projectId: string, traceId: string) => Promise<Trace | undefined>;
  addToAnnotationQueue: (params: {
    traceIds: string[];
    projectId: string;
    annotators: string[];
    userId: string;
  }) => Promise<void>;
  addToDataset: (params: {
    datasetId: string;
    projectId: string;
    datasetRecords: DatasetRecordEntry[];
  }) => Promise<void>;
}

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
  return {
    name: "alertTrigger",
    options: {
      makeJobId: (payload) =>
        `alert-trigger:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 30_000,
      delay: 30_000,
    },

    async handle(
      event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, aggregateId: traceId, foldState } = context;

      // Guard: skip old traces (resyncing)
      if (event.occurredAt < Date.now() - 60 * 60 * 1000) return;

      // Guard: skip traces blocked by guardrail with no output
      if (foldState.blockedByGuardrail && !foldState.computedOutput) return;

      const attrs = foldState.attributes ?? {};

      // Guard: origin not yet resolved — originGate handles deferred resolution
      if (!attrs["langwatch.origin"]) return;

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

          // Dedup: check if already sent for this trace
          const alreadySent = await deps.triggers.hasSentForTrace({
            triggerId: trigger.id,
            traceId,
            projectId: tenantId,
          });
          if (alreadySent) continue;

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
  };
}

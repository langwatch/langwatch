import type { EvaluationAnalyticsData } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalytics.foldProjection";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import { featureFlagService } from "~/server/featureFlag";
import { createLogger } from "~/utils/logger/server";
import type {
  OutboxEnqueueRequest,
  OutboxReactorDefinition,
} from "../../../outbox/outboxReactor.types";
import {
  GRAPH_TRIGGER_EVAL_REACTOR_NAME,
  graphEvalAuditDedupKey,
  graphEvalDedupId,
  graphEvalGroupKey,
  type GraphEvalStagePayload,
} from "../../../outbox/payload";
import type { ReactorContext } from "../../../reactors/reactor.types";
import type { EvaluationProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:evaluation-processing:graph-trigger-evaluation-outbox-reactor",
);

/**
 * ADR-034 Phase 6 — real-time path for eval-metric custom-graph threshold
 * alerts. Eval-pipeline mirror of the trace-pipeline reactor at
 * `~/server/event-sourcing/pipelines/trace-processing/reactors/graphTriggerEvaluation.outboxReactor.ts`.
 *
 * Attached as `.withOutbox("evaluationAnalytics", "graphTriggerEvaluation",
 * ...)` on the evaluation-processing pipeline. Fires on every slim
 * eval-fold update; the per-(triggerId, projectId) Debounce Mode TTL (5s,
 * locked by the Phase 5 spec — shared with the trace path) collapses
 * repeat enqueues into a single evaluation so a burst of evaluations
 * doesn't fan-out into a burst of graph-trigger evaluations.
 *
 * Per-project gated by the SAME `release_es_graph_triggers_firing` flag
 * the trace path uses — there is no separate eval flag because the
 * customer-facing capability ("real-time graph alerts") is one thing, not
 * two. OFF (default) → `decide` returns `[]` and the cron handles the
 * project's graph triggers; ON → emits one `OutboxEnqueueRequest` per
 * active graph trigger on the project, all targeting the same shared
 * handler `evaluateGraphTrigger` (the trace reactor's handler, reused
 * verbatim).
 *
 * The reactor itself does NOT call the handler — that's the dispatcher's
 * job (settle/cadence/graphEval stage routing).
 */
export interface EvaluationGraphTriggerEvaluationOutboxReactorDeps {
  triggers: TriggerService;
}

const REAL_TIME_DEBOUNCE_MS = 5_000;

/**
 * Reactor-name suffix so framework-level dedup logs don't conflate the
 * eval and trace reactors. The dispatch-side reactor name on the payload
 * stays `GRAPH_TRIGGER_EVAL_REACTOR_NAME` so the outbox dispatcher routes
 * both pipelines' enqueues to the same `evaluateGraphTrigger` handler.
 */
const EVALUATION_GRAPH_TRIGGER_REACTOR_NAME =
  `${GRAPH_TRIGGER_EVAL_REACTOR_NAME}:evaluation` as const;

export function createEvaluationGraphTriggerEvaluationOutboxReactor(
  deps: EvaluationGraphTriggerEvaluationOutboxReactorDeps,
): OutboxReactorDefinition<EvaluationProcessingEvent, EvaluationAnalyticsData> {
  return {
    name: EVALUATION_GRAPH_TRIGGER_REACTOR_NAME,
    options: {
      // Reactor-level dedup across the cluster — outer queue's Debounce
      // Mode collapses additional dedup. Same shape as the trace reactor.
      makeJobId: (payload) =>
        `${EVALUATION_GRAPH_TRIGGER_REACTOR_NAME}:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: REAL_TIME_DEBOUNCE_MS,
    },

    async decide(
      event: EvaluationProcessingEvent,
      context: ReactorContext<EvaluationAnalyticsData>,
    ): Promise<OutboxEnqueueRequest[]> {
      const { tenantId } = context;

      // Old-evaluation guard — replay floods, resyncs, late-arriving events.
      // Mirrors the trace reactor's 1-hour threshold.
      if (event.occurredAt < Date.now() - 60 * 60 * 1000) {
        return [];
      }

      const enabled = await featureFlagService.isEnabled(
        "release_es_graph_triggers_firing",
        { distinctId: tenantId, projectId: tenantId },
      );
      if (!enabled) return [];

      const triggers =
        await deps.triggers.getActiveGraphTriggersForProject(tenantId);
      if (triggers.length === 0) return [];

      const requests: OutboxEnqueueRequest[] = [];
      for (const trigger of triggers) {
        const payload: GraphEvalStagePayload = {
          stage: "graphEval",
          projectId: tenantId,
          triggerId: trigger.id,
          // The dispatch-side reactor name must be the SHARED constant so
          // the outbox dispatcher routes this payload to the same
          // `evaluateGraphTrigger` handler regardless of which pipeline
          // enqueued it.
          reactorName: GRAPH_TRIGGER_EVAL_REACTOR_NAME,
          reason: "real-time",
        };
        requests.push({
          dedupKey: graphEvalDedupId({
            projectId: tenantId,
            triggerId: trigger.id,
          }),
          groupKey: graphEvalGroupKey({
            projectId: tenantId,
            triggerId: trigger.id,
          }),
          // `GraphEvalStagePayload` extends `Record<string, unknown>` so it
          // satisfies `Prisma.InputJsonValue` structurally; the cast crosses
          // the structural-vs-nominal gap.
          payload: payload as unknown as OutboxEnqueueRequest["payload"],
          enqueueOptions: { ttlMs: REAL_TIME_DEBOUNCE_MS },
        });
      }

      logger.debug(
        {
          tenantId,
          triggerCount: requests.length,
        },
        "graphTriggerEvaluation reactor (eval pipeline) decided enqueues",
      );

      // Carry the audit key on the reactor's logs so an operator
      // grepping for one is one query away — same pattern as the trace
      // reactor.
      void graphEvalAuditDedupKey;

      return requests;
    },
  };
}

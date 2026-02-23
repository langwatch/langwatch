import { generate } from "@langwatch/ksuid";
import type { MonitorService } from "~/server/app-layer/monitors/monitor.service";
import type { AppCommands } from "~/server/event-sourcing/pipelineRegistry";
import { KSUID_RESOURCES } from "../../../../../utils/constants";
import { createLogger } from "../../../../../utils/logger/server";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:evaluation-trigger-reactor",
);

export interface EvaluationTriggerReactorDeps {
  monitors: MonitorService;
  evaluation: AppCommands["evaluations"]["executeEvaluation"];
}

export function createEvaluationTriggerReactor(
  deps: EvaluationTriggerReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "evaluationTrigger",
    options: {
      makeJobId: (payload) =>
        `eval-trigger:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 5000, // Wait a bit for more spans to arrive before triggering
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

      // Guard: skip studio development traces TODO: test these are still hoisted
      const attrs = foldState.attributes ?? {};
      if (
        attrs["langwatch.platform"] === "optimization_studio" &&
        attrs["langwatch.environment"] === "development"
      ) {
        return;
      }

      // Read all enabled ON_MESSAGE monitors for this project
      const monitors = await deps.monitors.getEnabledOnMessageMonitors(tenantId);

      if (monitors.length === 0) return;

      // Send executeEvaluation command per monitor (dedup + 30s delay handles the rest)
      const threadId = attrs["gen_ai.conversation.id"];
      const userId = attrs["langwatch.user_id"];
      const customerId = attrs["langwatch.customer_id"];
      const labels = parseLabels(attrs["langwatch.labels"]);

      for (const monitor of monitors) {
        // Early sampling in reactor to avoid dispatching commands that get discarded
        if (Math.random() > monitor.sample) continue;

        const evaluationId = generate(KSUID_RESOURCES.EVALUATION).toString();
        try {
          await deps.evaluation({
            tenantId,
            traceId,
            evaluationId,
            evaluatorId: monitor.id,
            evaluatorType: monitor.checkType,
            evaluatorName: monitor.name,
            isGuardrail: false,
            occurredAt: event.occurredAt,
            threadIdleTimeout: monitor.threadIdleTimeout ?? undefined,
            threadId,
            userId,
            customerId,
            labels,
          });
        } catch (error) {
          logger.error(
            {
              tenantId,
              traceId,
              evaluationId,
              evaluatorId: monitor.id,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to send executeEvaluation command",
          );
        }
      }

      logger.debug(
        { tenantId, traceId, monitorCount: monitors.length },
        "Sent executeEvaluation commands for trace",
      );
    },
  };
}

function parseLabels(labelsJson: string | undefined): string[] | undefined {
  if (!labelsJson) return undefined;
  try {
    const parsed = JSON.parse(labelsJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((l): l is string => typeof l === "string");
    }
  } catch {
    // Not valid JSON, ignore
  }
  return undefined;
}

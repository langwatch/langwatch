import type { AppCommands } from "~/server/event-sourcing/pipelineRegistry";
import { lambdaFetch } from "../../../../../utils/lambdaFetch";
import { createLogger } from "../../../../../utils/logger/server";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:satisfaction-score-reactor",
);

type SatisfactionScoreResult = {
  score_normalized: number;
  score_raw: number;
  score_positive: number;
  score_negative: number;
  label: string;
};

export interface SatisfactionScoreReactorDeps {
  assignSatisfactionScore: AppCommands["traces"]["assignSatisfactionScore"];
  nlpServiceUrl: string | undefined;
}

export function createSatisfactionScoreReactor(
  deps: SatisfactionScoreReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "satisfactionScore",
    options: {
      makeJobId: (payload) =>
        `satisfaction:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 5000, // Wait for spans to arrive before computing
    },

    async handle(
      event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, aggregateId: traceId, foldState } = context;

      // Guard: skip if NLP service is not configured
      if (!deps.nlpServiceUrl) return;

      // Guard: skip if no computed input
      if (!foldState.computedInput) return;

      // Guard: skip old traces (resyncing)
      if (event.occurredAt < Date.now() - 60 * 60 * 1000) return;

      try {
        const response = await lambdaFetch<SatisfactionScoreResult>(
          deps.nlpServiceUrl,
          "/sentiment",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: foldState.computedInput }),
          },
        );

        if (!response.ok) {
          logger.warn(
            {
              tenantId,
              traceId,
              status: response.status,
            },
            "NLP sentiment API returned an error",
          );
          return;
        }

        const result = await response.json();

        await deps.assignSatisfactionScore({
          tenantId,
          traceId,
          satisfactionScore: result.score_normalized,
          occurredAt: Date.now(),
        });

        logger.debug(
          { tenantId, traceId, score: result.score_normalized },
          "Assigned satisfaction score to trace",
        );
      } catch (error) {
        logger.error(
          {
            tenantId,
            traceId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to compute satisfaction score — non-fatal",
        );
      }
    },
  };
}

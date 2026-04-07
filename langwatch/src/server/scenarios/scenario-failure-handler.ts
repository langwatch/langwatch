/**
 * ScenarioFailureHandler service.
 *
 * Ensures failure events are emitted via event-sourcing when scenario jobs
 * fail (child process crash, timeout, prefetch error). This provides
 * visibility into job failures that would otherwise result in runs stuck
 * as IN_PROGRESS forever.
 *
 * @see specs/scenarios/scenario-failure-handler.feature
 */

import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { getApp } from "~/server/app-layer/app";
import { createLogger } from "~/utils/logger/server";

const tracer = getLangWatchTracer("langwatch.scenarios.failure-handler");
const logger = createLogger("langwatch:scenarios:failure-handler");

/** Parameters for ensuring failure events are emitted */
export interface FailureEventParams {
  projectId: string;
  scenarioId: string;
  setId: string;
  batchRunId: string;
  /** Pre-assigned scenario run ID from the job queue. */
  scenarioRunId?: string;
  error?: string;
  /** Scenario name for display in UI */
  name?: string;
  /** Scenario description/situation for display in UI */
  description?: string;
  /** When true, writes CANCELLED status instead of ERROR */
  cancelled?: boolean;
}

function buildFailureResults(params: { cancelled: boolean; error?: string }) {
  return params.cancelled
    ? {
        verdict: Verdict.INCONCLUSIVE,
        reasoning: "Cancelled by user",
        metCriteria: [],
        unmetCriteria: [],
        error: params.error ?? "Cancelled by user",
      }
    : {
        verdict: Verdict.FAILURE,
        reasoning: params.error ?? "Job failed without error message",
        metCriteria: [],
        unmetCriteria: [],
        error: params.error ?? "Job failed",
      };
}

/**
 * Handles emission of failure events when scenario jobs fail.
 *
 * Dispatches startRun + finishRun commands via event-sourcing so ClickHouse
 * gets the terminal status and the UI updates via SSE.
 */
export class ScenarioFailureHandler {
  static create(): ScenarioFailureHandler {
    return new ScenarioFailureHandler();
  }

  /**
   * Ensures failure events are emitted for a failed scenario job.
   *
   * Dispatches startRun (if needed) and finishRun with ERROR/CANCELLED status
   * via event-sourcing. The finishRun command is idempotent.
   */
  async ensureFailureEventsEmitted(params: FailureEventParams): Promise<void> {
    return tracer.withActiveSpan(
      "ScenarioFailureHandler.ensureFailureEventsEmitted",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.scenarioId,
          "scenario.set.id": params.setId,
          "batch.run.id": params.batchRunId,
        },
      },
      async (span) => {
        const { projectId, scenarioId, setId, batchRunId, error, name, description, cancelled } = params;
        const status = cancelled ? ScenarioRunStatus.CANCELLED : ScenarioRunStatus.ERROR;
        const scenarioRunId = params.scenarioRunId;

        if (!scenarioRunId) {
          logger.warn({ projectId, scenarioId, batchRunId }, "No scenarioRunId provided, cannot emit failure events");
          return;
        }

        logger.info(
          { projectId, scenarioId, setId, batchRunId, scenarioRunId, status, error: error?.substring(0, 100) },
          "Emitting failure events via event-sourcing",
        );

        const timestamp = Date.now();
        span.setAttribute("scenario.run.id", scenarioRunId);

        // Dispatch finishRun with ERROR/CANCELLED status
        try {
          await getApp().simulations.finishRun({
            tenantId: projectId,
            scenarioRunId,
            occurredAt: timestamp,
            status,
            results: buildFailureResults({ cancelled: cancelled ?? false, error }),
          });
          span.setAttribute("result.emitted_run_finished", true);
        } catch (err) {
          logger.error({ err, scenarioRunId }, "Failed to dispatch finishRun event");
          throw err;
        }

        logger.info({ projectId, scenarioId, scenarioRunId, batchRunId, status }, "Failure events emitted");
      },
    );
  }
}

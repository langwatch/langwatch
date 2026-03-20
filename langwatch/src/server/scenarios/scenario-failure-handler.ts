/**
 * ScenarioFailureHandler service.
 *
 * Ensures failure events are emitted to Elasticsearch when scenario jobs fail
 * (child process crash, timeout, prefetch error). This provides visibility into
 * job failures that would otherwise result in generic timeout messages.
 *
 * @see specs/scenarios/scenario-failure-handler.feature
 */

import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { generate } from "@langwatch/ksuid";
import {
  ScenarioEventType,
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { getApp } from "~/server/app-layer/app";
import { SimulationFacade } from "~/server/simulations/simulation.facade";
import { KSUID_RESOURCES } from "~/utils/constants";
import { createLogger } from "~/utils/logger/server";

const tracer = getLangWatchTracer("langwatch.scenarios.failure-handler");
const logger = createLogger("langwatch:scenarios:failure-handler");

/** Parameters for ensuring failure events are emitted */
export interface FailureEventParams {
  projectId: string;
  scenarioId: string;
  setId: string;
  batchRunId: string;
  /** Pre-assigned scenario run ID from the job queue. Used to prevent duplicate run entries when ES hasn't indexed the SDK's RUN_STARTED event yet. */
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

/** Terminal statuses that indicate a run has already finished */
const TERMINAL_STATUSES = new Set([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.ERROR,
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.CANCELLED,
  ScenarioRunStatus.STALLED,
]);

/**
 * Handles emission of failure events when scenario jobs fail.
 *
 * Ensures that when a job completes with success=false, appropriate events
 * are emitted to Elasticsearch so the frontend can display the error
 * instead of timing out.
 */
export class ScenarioFailureHandler {
  constructor(private readonly service: SimulationFacade) {}

  /**
   * Creates a new instance with default dependencies.
   */
  static create(): ScenarioFailureHandler {
    return new ScenarioFailureHandler(SimulationFacade.create());
  }

  /**
   * Ensures failure events are emitted for a failed scenario job.
   *
   * - If no events exist: emits both RUN_STARTED and RUN_FINISHED
   * - If RUN_STARTED exists but not RUN_FINISHED: emits RUN_FINISHED with existing scenarioRunId
   * - If RUN_FINISHED already exists: does nothing (idempotent)
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

        logger.info(
          { projectId, scenarioId, setId, batchRunId, error: error?.substring(0, 100) },
          "Ensuring failure events emitted",
        );

        const timestamp = Date.now();

        // Fast path: when we already have a scenarioRunId from the job queue,
        // skip the potentially slow ClickHouse read and write directly.
        // The event-sourcing finishRun command is idempotent, so duplicate
        // writes are safe.
        let existingRun: { scenarioRunId: string; status: string } | undefined;
        if (params.scenarioRunId) {
          existingRun = { scenarioRunId: params.scenarioRunId, status: "" };
        } else {
          // Slow path: query for existing run data (needed when scenarioRunId
          // is unknown, e.g. external SDK runs without pre-assigned IDs)
          const batchRunResult = await this.service.getRunDataForBatchRun({
            projectId,
            scenarioSetId: setId,
            batchRunId,
          });

          const found = batchRunResult.changed
            ? batchRunResult.runs.find((run) => run.scenarioId === scenarioId)
            : undefined;

          if (found && TERMINAL_STATUSES.has(found.status as ScenarioRunStatus)) {
            logger.debug(
              { projectId, scenarioId, batchRunId, status: found.status },
              "Run already in terminal status, skipping",
            );
            span.setAttribute("result.skipped", true);
            span.setAttribute("result.existing_status", found.status);
            return;
          }

          existingRun = found;
        }

        const scenarioRunId = existingRun?.scenarioRunId ?? this.generateScenarioRunId();
        span.setAttribute("scenario.run.id", scenarioRunId);

        // If no RUN_STARTED event exists, emit one
        if (!existingRun || !existingRun.status) {
          logger.debug({ projectId, scenarioId, scenarioRunId }, "Emitting RUN_STARTED event");
          await this.service.saveScenarioEvent({
            projectId,
            type: ScenarioEventType.RUN_STARTED,
            scenarioId,
            scenarioRunId,
            batchRunId,
            scenarioSetId: setId,
            timestamp,
            metadata: {
              name: name ?? "Unknown Scenario",
              description: description ?? undefined,
            },
          });
          span.setAttribute("result.emitted_run_started", true);

          // Dual-write to ClickHouse via event-sourcing (best-effort)
          try {
            await getApp().simulations.startRun({
              tenantId: projectId,
              scenarioRunId,
              scenarioId,
              batchRunId,
              scenarioSetId: setId,
              occurredAt: timestamp,
              name: name ?? "Unknown Scenario",
              description: description ?? undefined,
              metadata: {
                name: name ?? "Unknown Scenario",
                description: description ?? undefined,
              },
            });
          } catch (err) {
            logger.warn({ err, scenarioRunId }, "CH startRun dispatch failed (non-fatal)");
          }
        }

        // Emit RUN_FINISHED with appropriate status
        logger.debug({ projectId, scenarioId, scenarioRunId, status }, "Emitting RUN_FINISHED event");
        await this.service.saveScenarioEvent({
          projectId,
          type: ScenarioEventType.RUN_FINISHED,
          scenarioId,
          scenarioRunId,
          batchRunId,
          scenarioSetId: setId,
          timestamp: timestamp + 1, // Ensure RUN_FINISHED is after RUN_STARTED
          status,
          results: buildFailureResults({ cancelled: cancelled ?? false, error }),
        });
        span.setAttribute("result.emitted_run_finished", true);

        // Dual-write to ClickHouse via event-sourcing (best-effort)
        try {
          await getApp().simulations.finishRun({
            tenantId: projectId,
            scenarioRunId,
            occurredAt: timestamp + 1,
            status,
            results: buildFailureResults({ cancelled: cancelled ?? false, error }),
          });
        } catch (err) {
          logger.warn({ err, scenarioRunId }, "CH finishRun dispatch failed (non-fatal)");
        }

        logger.info({ projectId, scenarioId, scenarioRunId, batchRunId }, "Failure events emitted");
      },
    );
  }

  /**
   * Generates a synthetic scenarioRunId using KSUID with the "scenariorun" resource prefix.
   */
  private generateScenarioRunId(): string {
    return generate(KSUID_RESOURCES.SCENARIO_RUN).toString();
  }
}

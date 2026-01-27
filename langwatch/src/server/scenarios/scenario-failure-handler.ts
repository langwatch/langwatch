/**
 * ScenarioFailureHandler service.
 *
 * Ensures failure events are emitted to Elasticsearch when scenario jobs fail
 * (child process crash, timeout, prefetch error). This provides visibility into
 * job failures that would otherwise result in generic timeout messages.
 *
 * @see specs/scenarios/scenario-failure-handler.feature
 */

import { nanoid } from "nanoid";
import {
  ScenarioEventType,
  ScenarioRunStatus,
  Verdict,
} from "~/app/api/scenario-events/[[...route]]/enums";
import { ScenarioEventService } from "~/app/api/scenario-events/[[...route]]/scenario-event.service";

/** Parameters for ensuring failure events are emitted */
export interface FailureEventParams {
  projectId: string;
  scenarioId: string;
  setId: string;
  batchRunId: string;
  error?: string;
  /** Scenario name for display in UI */
  name?: string;
  /** Scenario description/situation for display in UI */
  description?: string;
}

/** Terminal statuses that indicate a run has already finished */
const TERMINAL_STATUSES = new Set([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.ERROR,
  ScenarioRunStatus.FAILED,
  ScenarioRunStatus.CANCELLED,
]);

/**
 * Handles emission of failure events when scenario jobs fail.
 *
 * Ensures that when a job completes with success=false, appropriate events
 * are emitted to Elasticsearch so the frontend can display the error
 * instead of timing out.
 */
export class ScenarioFailureHandler {
  constructor(private readonly eventService: ScenarioEventService) {}

  /**
   * Creates a new instance with default dependencies.
   */
  static create(): ScenarioFailureHandler {
    return new ScenarioFailureHandler(new ScenarioEventService());
  }

  /**
   * Ensures failure events are emitted for a failed scenario job.
   *
   * - If no events exist: emits both RUN_STARTED and RUN_FINISHED
   * - If RUN_STARTED exists but not RUN_FINISHED: emits RUN_FINISHED with existing scenarioRunId
   * - If RUN_FINISHED already exists: does nothing (idempotent)
   */
  async ensureFailureEventsEmitted(params: FailureEventParams): Promise<void> {
    const { projectId, scenarioId, setId, batchRunId, error, name, description } = params;

    // Check for existing events for this specific scenario
    const allRuns = await this.eventService.getRunDataForBatchRun({
      projectId,
      scenarioSetId: setId,
      batchRunId,
    });

    // Filter by scenarioId to get the correct run for this scenario
    const existingRun = allRuns.find((run) => run.scenarioId === scenarioId);

    // If run already has a terminal status, do nothing (idempotent)
    if (existingRun && TERMINAL_STATUSES.has(existingRun.status as ScenarioRunStatus)) {
      return;
    }

    const timestamp = Date.now();
    const scenarioRunId = existingRun?.scenarioRunId ?? this.generateScenarioRunId();

    // If no RUN_STARTED event exists, emit one
    if (!existingRun) {
      await this.eventService.saveScenarioEvent({
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
    }

    // Emit RUN_FINISHED with ERROR status
    await this.eventService.saveScenarioEvent({
      projectId,
      type: ScenarioEventType.RUN_FINISHED,
      scenarioId,
      scenarioRunId,
      batchRunId,
      scenarioSetId: setId,
      timestamp: timestamp + 1, // Ensure RUN_FINISHED is after RUN_STARTED
      status: ScenarioRunStatus.ERROR,
      results: {
        verdict: Verdict.FAILURE,
        reasoning: error ?? "Job failed without error message",
        metCriteria: [],
        unmetCriteria: [],
        error: error ?? "Job failed",
      },
    });
  }

  /**
   * Generates a synthetic scenarioRunId in the format "scenariorun_{nanoid}".
   */
  private generateScenarioRunId(): string {
    return `scenariorun_${nanoid()}`;
  }
}

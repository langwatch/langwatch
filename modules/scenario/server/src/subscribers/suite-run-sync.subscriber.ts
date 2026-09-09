import type { SubscriberSpec } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { isSuiteSetId } from "@langwatch/suite-contract";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import type {
  SimulationProcessingEvent,
  SimulationRunFinishedEvent,
  SimulationRunStartedEvent,
} from "@langwatch/scenario-contract";
import {
  isSimulationRunFinishedEvent,
  isSimulationRunStartedEvent,
} from "@langwatch/scenario-contract";

const logger = createLogger("langwatch:simulation-processing:suite-run-sync");

export interface SuiteRunSyncSubscriberDeps {
  recordSuiteRunItemStarted: (data: {
    tenantId: string;
    batchRunId: string;
    scenarioRunId: string;
    scenarioId: string;
    occurredAt: number;
  }) => Promise<void>;
  completeSuiteRunItem: (data: {
    tenantId: string;
    batchRunId: string;
    scenarioRunId: string;
    scenarioId: string;
    status: string;
    verdict?: string;
    durationMs?: number;
    reasoning?: string;
    error?: string;
    occurredAt: number;
  }) => Promise<void>;
}

/**
 * Cross-pipeline subscriber that syncs simulation events to the suite run
 * pipeline. Event-carried state (ECST) only — identity fields ride on the
 * event, so this never reads fold state.
 *
 * Lives on the simulation pipeline (consumes simulation events).
 * Dispatches commands to the suite run pipeline.
 * Uses isSuiteSetId() to filter — only processes simulation runs belonging to suites.
 *
 * Dispatch failures THROW so the GroupQueue retries (durable) — the old
 * subscriber's warn-swallow could permanently lose a suite item update.
 */
export function createSuiteRunSyncSubscriber(
  deps: SuiteRunSyncSubscriberDeps,
): SubscriberSpec<SimulationProcessingEvent> & {
  fold?: never;
  map?: never;
} {
  const handleStarted = async (event: SimulationRunStartedEvent): Promise<void> => {
    const tenantId = String(event.tenantId);
    const { scenarioSetId, batchRunId, scenarioRunId, scenarioId } = event.data;

    // Only process simulation runs that belong to suites
    if (!isSuiteSetId(scenarioSetId)) {
      return;
    }

    await deps.recordSuiteRunItemStarted({
      tenantId,
      batchRunId,
      scenarioRunId,
      scenarioId,
      occurredAt: event.occurredAt,
    });

    logger.debug({ tenantId, batchRunId, scenarioRunId }, "Dispatched recordSuiteRunItemStarted");
  };

  const handleFinished = async (event: SimulationRunFinishedEvent): Promise<void> => {
    const tenantId = String(event.tenantId);
    const { data } = event;

    // Only process simulation runs that belong to suites
    if (!data.scenarioSetId || !isSuiteSetId(data.scenarioSetId)) {
      return;
    }

    // Pre-enrichment events lack the ECST identity fields — skip them
    // rather than dispatch a suite command that cannot validate.
    if (!data.batchRunId || !data.scenarioId || !data.status) {
      logger.debug(
        { tenantId, scenarioRunId: data.scenarioRunId },
        "Skipped suiteRunSync for RunFinished without ECST identity fields (pre-enrichment event)",
      );
      return;
    }

    await deps.completeSuiteRunItem({
      tenantId,
      batchRunId: data.batchRunId,
      scenarioRunId: data.scenarioRunId,
      scenarioId: data.scenarioId,
      status: data.status,
      verdict: data.results?.verdict,
      durationMs: data.durationMs,
      reasoning: data.results?.reasoning,
      error: data.results?.error,
      occurredAt: event.occurredAt,
    });

    logger.debug(
      {
        tenantId,
        batchRunId: data.batchRunId,
        scenarioRunId: data.scenarioRunId,
        status: data.status,
      },
      "Dispatched completeSuiteRunItem",
    );
  };

  return {
    events: [SIMULATION_RUN_EVENT_TYPES.STARTED, SIMULATION_RUN_EVENT_TYPES.FINISHED],

    async handler(event: SimulationProcessingEvent): Promise<void> {
      if (isSimulationRunStartedEvent(event)) {
        await handleStarted(event);
        return;
      }

      if (isSimulationRunFinishedEvent(event)) {
        await handleFinished(event);
      }
    },
  };
}

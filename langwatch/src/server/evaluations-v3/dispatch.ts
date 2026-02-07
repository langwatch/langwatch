/**
 * Dispatch functions for dual-writing experiment run events to ClickHouse
 * via the event-sourcing pipeline.
 *
 * Feature flags (on Project model):
 *   - featureEventSourcingEvaluationIngestion — write path: when enabled,
 *     experiment run commands are dispatched to ClickHouse alongside the
 *     existing Elasticsearch writes.
 *   - featureClickHouseDataSourceEvaluations — read path: when enabled,
 *     queries are routed to ClickHouse instead of Elasticsearch.
 */
import { prisma } from "~/server/db";
import { getExperimentRunProcessingPipeline } from "~/server/event-sourcing/runtime/eventSourcing";
import type {
  CompleteExperimentRunCommandData,
  RecordEvaluatorResultCommandData,
  RecordTargetResultCommandData,
  StartExperimentRunCommandData,
} from "~/server/event-sourcing/pipelines/experiment-run-processing/schemas/commands";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("evaluations-v3:dispatch");

/**
 * Checks if ClickHouse dual-write is enabled for batch evaluations.
 * Uses the featureEventSourcingEvaluationIngestion project flag.
 */
export const isClickHouseEvaluationsEnabled = async (
  projectId: string,
): Promise<boolean> => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { featureEventSourcingEvaluationIngestion: true },
  });
  return project?.featureEventSourcingEvaluationIngestion === true;
};

/**
 * Dispatches start experiment run command to ClickHouse via event sourcing.
 * Fire-and-forget - errors are logged but don't affect the main execution.
 */
export const dispatchStartExperimentRun = async (
  payload: StartExperimentRunCommandData,
): Promise<void> => {
  try {
    const pipeline = getExperimentRunProcessingPipeline();
    await pipeline.commands.startExperimentRun.send(payload);
  } catch (error) {
    logger.warn(
      { error, runId: payload.runId },
      "Failed to dispatch start experiment run event to ClickHouse",
    );
  }
};

/**
 * Dispatches record target result command to ClickHouse via event sourcing.
 * Fire-and-forget - errors are logged but don't affect the main execution.
 */
export const dispatchRecordTargetResult = async (
  payload: RecordTargetResultCommandData,
): Promise<void> => {
  try {
    const pipeline = getExperimentRunProcessingPipeline();
    await pipeline.commands.recordTargetResult.send(payload);
  } catch (error) {
    logger.warn(
      { error, runId: payload.runId },
      "Failed to dispatch record target result event to ClickHouse",
    );
  }
};

/**
 * Dispatches record evaluator result command to ClickHouse via event sourcing.
 * Fire-and-forget - errors are logged but don't affect the main execution.
 */
export const dispatchRecordEvaluatorResult = async (
  payload: RecordEvaluatorResultCommandData,
): Promise<void> => {
  try {
    const pipeline = getExperimentRunProcessingPipeline();
    await pipeline.commands.recordEvaluatorResult.send(payload);
  } catch (error) {
    logger.warn(
      { error, runId: payload.runId },
      "Failed to dispatch record evaluator result event to ClickHouse",
    );
  }
};

/**
 * Dispatches complete experiment run command to ClickHouse via event sourcing.
 * Fire-and-forget - errors are logged but don't affect the main execution.
 */
export const dispatchCompleteExperimentRun = async (
  payload: CompleteExperimentRunCommandData,
): Promise<void> => {
  try {
    const pipeline = getExperimentRunProcessingPipeline();
    await pipeline.commands.completeExperimentRun.send(payload);
  } catch (error) {
    logger.warn(
      { error, runId: payload.runId },
      "Failed to dispatch complete experiment run event to ClickHouse",
    );
  }
};

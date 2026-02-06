/**
 * Pure function for building scenario job IDs.
 *
 * Extracted from scenario.queue.ts to enable unit testing without
 * triggering module-level side effects (Redis/DB connections).
 *
 * The job ID must be unique per (project, scenario, target, batch, index)
 * to prevent BullMQ from silently deduplicating jobs when the same scenario
 * runs against multiple targets or with repeats in the same batch.
 *
 * @see https://github.com/langwatch/langwatch/issues/1396
 * @see specs/scenarios/scenario-job-id-uniqueness.feature
 */

/** Parameters needed to build a unique scenario job ID. */
export interface BuildScenarioJobIdParams {
  projectId: string;
  scenarioId: string;
  targetReferenceId: string;
  batchRunId: string;
  /** Zero-based index distinguishing repeated runs within the same batch+target. */
  index: number;
}

/**
 * Build a deterministic, unique job ID for a scenario execution.
 *
 * Formula: `scenario_${projectId}_${scenarioId}_${targetReferenceId}_${batchRunId}_${index}`
 *
 * @param params - All dimensions needed for uniqueness
 * @returns A string suitable for use as a BullMQ job ID
 */
export function buildScenarioJobId({
  projectId,
  scenarioId,
  targetReferenceId,
  batchRunId,
  index,
}: BuildScenarioJobIdParams): string {
  return `scenario_${projectId}_${scenarioId}_${targetReferenceId}_${batchRunId}_${index}`;
}

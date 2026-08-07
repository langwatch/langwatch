/**
 * Shared Zod schemas for suite-run-processing pipeline.
 *
 * Reuses SimulationRunStatus and SimulationVerdict from the simulation pipeline
 * where possible, since suite items track the same status/verdict values.
 */
export {
  SIMULATION_RUN_STATUS,
  SIMULATION_VERDICT,
  type SimulationRunStatus,
  type SimulationVerdict,
} from "../../simulation-processing/schemas/shared";

import type {
  SimulationQueueRun,
  SimulationStartRun,
  SimulationMessageSnapshot,
  SimulationTextMessageStart,
  SimulationTextMessageEnd,
  SimulationFinishRun,
  RecordEvaluationsCommandData,
  SimulationCancelRun,
  SimulationDeleteRun,
  SimulationRecordAgentInstance,
} from "@langwatch/scenario-contract";

/** Eventing is application composition; Simulation dispatches through this repository. */
export abstract class SimulationExecutionRepository {
  abstract queueRun(input: SimulationQueueRun): Promise<void>;
  abstract startRun(input: SimulationStartRun): Promise<void>;
  abstract messageSnapshot(input: SimulationMessageSnapshot): Promise<void>;
  abstract textMessageStart(input: SimulationTextMessageStart): Promise<void>;
  abstract textMessageEnd(input: SimulationTextMessageEnd): Promise<void>;
  abstract finishRun(input: SimulationFinishRun): Promise<void>;
  abstract recordEvaluations(input: RecordEvaluationsCommandData): Promise<void>;
  abstract cancelRun(input: SimulationCancelRun): Promise<void>;
  abstract deleteRun(input: SimulationDeleteRun): Promise<void>;
  abstract recordAgentInstance(input: SimulationRecordAgentInstance): Promise<void>;
}

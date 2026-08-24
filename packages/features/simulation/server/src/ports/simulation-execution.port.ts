import type {
  SimulationCancelRun,
  SimulationDeleteRun,
  SimulationFinishRun,
  SimulationMessageSnapshot,
  SimulationQueueRun,
  SimulationStartRun,
  SimulationTextMessageEnd,
  SimulationTextMessageStart,
} from "@langwatch/simulation-contract";

/** Eventing is application composition; Simulation dispatches through this port. */
export abstract class SimulationExecutionPort {
  abstract queueRun(input: SimulationQueueRun): Promise<void>;
  abstract startRun(input: SimulationStartRun): Promise<void>;
  abstract messageSnapshot(input: SimulationMessageSnapshot): Promise<void>;
  abstract textMessageStart(input: SimulationTextMessageStart): Promise<void>;
  abstract textMessageEnd(input: SimulationTextMessageEnd): Promise<void>;
  abstract finishRun(input: SimulationFinishRun): Promise<void>;
  abstract cancelRun(input: SimulationCancelRun): Promise<void>;
  abstract deleteRun(input: SimulationDeleteRun): Promise<void>;
}

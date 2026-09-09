import type { ScenarioExecutionJob } from "@langwatch/scenario-contract";

/** Complete submission capability used by the Scenario execution service. */
export abstract class ScenarioExecutionPoolPort {
  abstract submit(input: ScenarioExecutionJob): void;
}

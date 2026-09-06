import type { ExecutionJobData } from "../services/scenario-execution-pool.service.ts";

export abstract class ScenarioExecutionRunnerPort {
  abstract execute(jobData: ExecutionJobData): Promise<void>;

  abstract skipCancelled(jobData: ExecutionJobData): void;
}

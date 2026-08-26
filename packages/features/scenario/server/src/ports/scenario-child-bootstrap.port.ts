import type {
  ChildProcessJobData,
  ScenarioExecutionResult,
} from "@langwatch/scenario-contract";
import type { ExecutionJobData } from "../services/scenario-execution-pool.service";

export interface ScenarioChildEnvironment {
  labels: string[];
  telemetry: { endpoint: string; apiKey: string };
}

export abstract class ScenarioChildExecutionSession {
  abstract execute(data: ChildProcessJobData): Promise<ScenarioExecutionResult>;
  abstract abort(): Promise<void>;
}

export abstract class ScenarioChildBootstrapPort {
  abstract start(input: {
    jobData: ExecutionJobData;
    environment: ScenarioChildEnvironment;
  }): ScenarioChildExecutionSession;
}

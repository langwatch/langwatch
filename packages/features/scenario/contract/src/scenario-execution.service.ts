import type { RunParameterValues } from "./scenario.parameters";
import type { ResolvedRunModels } from "./run-models";
import type { RunSecretCiphertext } from "./run-secret-ciphertext";
import type {
  ChildProcessJobData,
  ExecutionContext,
  TargetConfig,
} from "./scenario-execution-data";

export interface ScenarioExecutionJob {
  projectId: string;
  scenarioId: string;
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
  scenarioName?: string;
  target: {
    type: "prompt" | "http" | "code" | "workflow" | "connected";
    referenceId: string;
  };
  parameters?: RunParameterValues;
  secretParameters?: RunSecretCiphertext;
}

export type ScenarioModelParametersFailureReason =
  | "invalid_model_format"
  | "provider_not_found"
  | "provider_not_enabled"
  | "missing_params"
  // A project with no model set for a scenario feature key is the customer's
  // to fix, so the refusal names it rather than leaving the caller unable to
  // tell it from a fault of ours.
  | "model_not_configured"
  | "preparation_error";

export type ScenarioExecutionPrefetchResult =
  | {
      success: true;
      data: ChildProcessJobData;
      telemetry: { endpoint: string; apiKey: string };
      /**
       * The models this run resolved. A sibling of `data` rather than a member
       * of it: the child process builds its models from the prepared params,
       * so it needs no name, while the caller that queues the run records the
       * names on it. Null for a run that resolves no model.
       */
      resolvedModels: ResolvedRunModels | null;
    }
  | {
      success: false;
      error: string;
      reason?: ScenarioModelParametersFailureReason;
    };

export type ScenarioExecutionPrefetchInput = {
  context: ExecutionContext & {
    parameters?: RunParameterValues;
    secretParameters?: RunSecretCiphertext;
  };
  target: TargetConfig;
};

export type ScenarioChildEnvironment = {
  labels: string[];
  telemetry: { endpoint: string; apiKey: string };
};

export type ScenarioExecutionPreparation = {
  childEnvironment: Promise<ScenarioChildEnvironment | null>;
  result: Promise<ScenarioExecutionPrefetchResult>;
};

export type ScenarioUnsuccessfulExecutionInput = {
  projectId: string;
  scenarioId: string;
  setId: string;
  batchRunId: string;
  scenarioRunId: string;
  error?: string;
  cancelled?: boolean;
  target?: { type: string; referenceId: string };
};

/** Worker-lifecycle boundary recorded in Scenario ADR-002. */
export abstract class ScenarioExecutionService {
  abstract submit(input: ScenarioExecutionJob): Promise<void>;
  abstract cancel(input: { projectId: string; scenarioRunId: string }): Promise<void>;
  abstract prefetch(
    input: ScenarioExecutionPrefetchInput,
  ): Promise<ScenarioExecutionPrefetchResult>;
  abstract prepare(input: ScenarioExecutionPrefetchInput): ScenarioExecutionPreparation;
  abstract finishUnsuccessfulRun(input: ScenarioUnsuccessfulExecutionInput): Promise<void>;
}

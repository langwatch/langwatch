import type {
  Scenario,
  ScenarioCreateInput,
  ScenarioIdInput,
  ScenarioReferenceState,
  ScenarioRunConfig,
  ScenarioUpdateInput,
} from "./scenario";
import type { RunParameterValues } from "./scenario.parameters";
import type { RunSecretCiphertext } from "./run-secret-ciphertext";

export interface CancelScenarioRunInput {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
  scenarioRunId: string;
  scenarioId: string;
}

export interface CancelScenarioBatchInput {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
}

export type ResolveScenarioRunParametersInput = {
  projectId: string;
  scenarioId: string;
  values?: RunParameterValues;
};

export type ResolvedScenarioRunParameters = {
  parameters: RunParameterValues;
  secretParameters: RunSecretCiphertext;
};

export type ResolvedScenarioRunParametersForScenario = ResolvedScenarioRunParameters & {
  scenarioId: string;
};

export abstract class ScenarioService {
  abstract create(input: ScenarioCreateInput): Promise<Scenario>;
  abstract getById(input: ScenarioIdInput): Promise<Scenario>;
  abstract tryGetById(input: ScenarioIdInput): Promise<Scenario | null>;
  abstract tryGetByIdIncludingArchived(input: ScenarioIdInput): Promise<Scenario | null>;
  abstract list(input: { projectId: string }): Promise<Scenario[]>;
  abstract count(input: { projectId: string }): Promise<number>;
  abstract update(input: ScenarioUpdateInput): Promise<Scenario>;
  abstract archive(input: ScenarioIdInput): Promise<Scenario>;
  abstract batchArchive(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ archived: string[]; failed: { id: string; error: string }[] }>;
  abstract getRunConfigs(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioRunConfig[]>;
  abstract getReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioReferenceState[]>;
  abstract getNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]>;
  abstract resolveRunParameters(
    input: ResolveScenarioRunParametersInput,
  ): Promise<ResolvedScenarioRunParameters>;
  abstract resolveRunParametersForScenarios(input: {
    scenarios: ScenarioRunConfig[];
    values?: RunParameterValues;
  }): Promise<ResolvedScenarioRunParametersForScenario[]>;
  abstract cancelJob(input: CancelScenarioRunInput): Promise<{ cancelled: boolean }>;
  abstract cancelBatchRun(input: CancelScenarioBatchInput): Promise<{
    cancelledCount: number;
    skippedCount: number;
  }>;
}

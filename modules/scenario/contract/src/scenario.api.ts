import { moduleApi } from "@langwatch/runtime-composition";
import type {
  AgentTestRunResult,
  AgentTestTurnResult,
  AgentWithFields,
} from "@langwatch/agent-contract";
import type { RunActor } from "./run-actor.ts";
import type {
  Scenario,
  ScenarioReferenceState,
  ScenarioTestSuite,
  ScenarioTestSuiteCreateInput,
  ScenarioTestSuiteIdInput,
  ScenarioTestSuiteRenameInput,
  ScenarioTestSuiteRunDefinition,
  ScenarioTestSuiteUpdateInput,
  ScenarioRunConfig,
} from "./scenario.ts";
import type { RunParameterValues } from "./scenario.parameters.ts";
import type { RunSecretCiphertext } from "./run-secret-ciphertext.ts";
import type { SimulationExternalSetSummary } from "./simulation.ts";
import type { SimulationProjectDateRangeInput } from "./simulation.service.ts";

export interface TestAgentRunInput {
  projectId: string;
  agent: AgentWithFields;
  actor: RunActor | undefined;
}

export interface TestAgentTurnInput extends TestAgentRunInput {
  message: string;
  params?: Record<string, string | number | boolean>;
}

/** Folded in from the deleted `scenario.service.ts` contract-service: this capability's own vocabulary. */
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
  scenarioVersion: number;
};

export type ResolvedScenarioRunParametersForScenario = ResolvedScenarioRunParameters & {
  scenarioId: string;
};

/** Callable scenario capability used by peer features such as Suite. */
export interface ScenarioApi {
  testAgentTurn(input: TestAgentTurnInput): Promise<AgentTestTurnResult>;
  testAgentRun(input: TestAgentRunInput): Promise<AgentTestRunResult>;
  list(input: { projectId: string }): Promise<Scenario[]>;
  listTestSuites(input: {
    projectId: string;
    includeArchived?: boolean;
  }): Promise<ScenarioTestSuite[]>;
  getReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioReferenceState[]>;
  getRunConfigs(input: { ids: string[]; projectId: string }): Promise<ScenarioRunConfig[]>;
  getModelChoices(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; simulatorModel: string | null; judgeModel: string | null }[]>;
  resolveRunParameters(
    input: ResolveScenarioRunParametersInput,
  ): Promise<ResolvedScenarioRunParameters>;
  resolveRunParametersForScenarios(input: {
    scenarios: ScenarioRunConfig[];
    values?: RunParameterValues;
  }): Promise<ResolvedScenarioRunParametersForScenario[]>;
  getNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]>;
  tryGetTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite | null>;
  createTestSuite(input: ScenarioTestSuiteCreateInput): Promise<ScenarioTestSuite>;
  updateTestSuite(input: ScenarioTestSuiteUpdateInput): Promise<ScenarioTestSuite>;
  getTestSuiteRunDefinition(
    input: ScenarioTestSuiteIdInput,
  ): Promise<ScenarioTestSuiteRunDefinition>;
  archiveTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite>;
  renameTestSuite(input: ScenarioTestSuiteRenameInput): Promise<ScenarioTestSuite>;
  getInternalSuiteSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]>;
}

export const ScenarioApi = moduleApi<ScenarioApi>("scenario");

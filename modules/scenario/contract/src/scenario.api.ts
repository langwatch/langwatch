import { moduleApi } from "@langwatch/runtime-composition";
import type {
  AgentTestRunResult,
  AgentTestTurnResult,
  AgentWithFields,
} from "@langwatch/agent-contract";
import type { EventEmitter } from "node:events";
import type { RunActor } from "./run-actor.ts";
import type {
  Scenario,
  ScenarioAuthorLabel,
  ScenarioIdInput,
  ScenarioCreateInput,
  ScenarioUpdateInput,
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
import type { ResolvedRunModels } from "./run-models.ts";
import type { SimulationQueueRun } from "./simulation.commands.ts";
import type {
  SimulationAllSuitesRunData,
  SimulationBatchHistory,
  SimulationBatchRunData,
  SimulationExternalSetSummary,
  SimulationLastResultSummary,
  SimulationRunData,
  SimulationSetData,
} from "./simulation.ts";
import type {
  SimulationAllSuitesInput,
  SimulationBatchHistoryInput,
  SimulationBatchRunInput,
  SimulationExternalSetCountInput,
  SimulationLastResultSummariesInput,
  SimulationLastUpdatedInput,
  SimulationProjectDateRangeInput,
  SimulationScenarioRunInput,
  SimulationScenarioSetRunsInput,
} from "./simulation.service.ts";
import type {
  ScenarioExecutionPrefetchInput,
  ScenarioExecutionPrefetchResult,
} from "./scenario-execution.service.ts";
import type {
  ScenarioDuplicateInput,
  ScenarioMoveInput,
  ScenarioVersionDetail,
  ScenarioVersionInput,
  ScenarioVersionListInput,
  ScenarioVersionRestoreInput,
  ScenarioVersionSummary,
} from "./scenario.version.ts";
import type { ScenarioTabPresence, ScenarioTabRegistration } from "./scenario-tab-presence.ts";
import type {
  CodeScenario,
  ResultAtom,
  ResultsFilter,
  ResultsGroupBy,
  ResultsOverview,
  RunTarget,
} from "./result-atoms.ts";
import type { RunConfigurationEntryResponse } from "./scenario.responses.ts";
import type { UserFullProfile, UserProfilesInput } from "@langwatch/user-contract";

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


/** Who a write is attributed to, and the surface they wrote it through. */
export interface ScenarioCaller {
  readonly id: string;
  readonly label: ScenarioAuthorLabel;
}

/** What one queued run needs to know about itself. */
export interface QueueSimulationRunInput {
  projectId: string;
  scenarioId: string;
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
  name: string;
  /** The same union the queued command declares, so a door cannot widen it. */
  target: NonNullable<SimulationQueueRun["target"]>;
  parameters: RunParameterValues;
  secretParameters: RunSecretCiphertext;
  note: string | undefined;
  scenarioVersion: number | undefined;
  /** Who started the run. Absent when the surface names no person. */
  actor?: RunActor | undefined;
  /**
   * The models the validation prefetch resolved. Null when the run resolved
   * none, which reads back the way every run recorded before this field
   * existed reads back.
   */
  resolvedModels?: ResolvedRunModels | null;
}

/** The scenario application: what every scenario door calls, and what peer
 * features such as Suite reach it by. */
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
  findTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite | null>;
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

  // -- the scenarios a project defines ---------------------------------------
  /** How many scenarios the project holds. */
  count(input: { projectId: string }): Promise<number>;
  /** One scenario, or null when the project holds no such live scenario. */
  tryGetById(input: ScenarioIdInput): Promise<Scenario | null>;
  /** The same read, archived rows included. */
  tryGetByIdIncludingArchived(input: ScenarioIdInput): Promise<Scenario | null>;
  create(input: Omit<ScenarioCreateInput, "lastUpdatedById">, by: ScenarioCaller): Promise<Scenario>;
  update(
    input: Omit<ScenarioUpdateInput, "lastUpdatedById" | "actor">,
    by: ScenarioCaller,
  ): Promise<Scenario>;
  archive(input: ScenarioIdInput): Promise<Scenario>;
  batchArchive(input: {
    projectId: string;
    ids: string[];
  }): Promise<{ archived: string[]; failed: { id: string; reason: string }[] }>;
  moveToTestSuite(input: ScenarioMoveInput): Promise<Scenario>;
  duplicate(
    input: Omit<ScenarioDuplicateInput, "lastUpdatedById">,
    by: ScenarioCaller,
  ): Promise<Scenario>;

  // -- version history -------------------------------------------------------
  listVersions(
    input: ScenarioVersionListInput,
  ): Promise<{ versions: ScenarioVersionSummary[]; nextCursor: number | null }>;
  getVersion(input: ScenarioVersionInput): Promise<ScenarioVersionDetail>;
  restoreVersion(
    input: Omit<ScenarioVersionRestoreInput, "actor">,
    by: ScenarioCaller,
  ): Promise<Scenario>;
  /** The people a version history names, for the author column. */
  getUserProfiles(input: UserProfilesInput): Promise<UserFullProfile[]>;

  // -- running one --------------------------------------------------------
  prefetchExecution(
    input: ScenarioExecutionPrefetchInput,
  ): Promise<ScenarioExecutionPrefetchResult>;
  queueSimulationRun(input: QueueSimulationRunInput): Promise<void>;
  cancelJob(input: CancelScenarioRunInput): Promise<{ cancelled: boolean }>;
  cancelBatchRun(
    input: CancelScenarioBatchInput,
  ): Promise<{ cancelledCount: number; skippedCount: number }>;

  // -- reading what ran ------------------------------------------------------
  readSuiteRunData(input: {
    projectId: string;
    scenarioSetId?: string;
    limit: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
    sinceTimestamp?: number;
  }): Promise<SimulationAllSuitesRunData>;
  getScenarioSetsData(input: SimulationProjectDateRangeInput): Promise<SimulationSetData[]>;
  getLastResultSummaries(
    input: SimulationLastResultSummariesInput,
  ): Promise<SimulationLastResultSummary[]>;
  getLastUpdatedAt(input: SimulationLastUpdatedInput): Promise<number>;
  getRunDataForScenarioSet(
    input: SimulationScenarioSetRunsInput,
  ): Promise<{ runs: SimulationRunData[]; nextCursor: string | null }>;
  findScenarioRunData(input: SimulationScenarioRunInput): Promise<SimulationRunData | null>;
  getBatchRunCountForScenarioSet(input: SimulationExternalSetCountInput): Promise<number>;
  getBatchHistoryForScenarioSet(
    input: SimulationBatchHistoryInput,
  ): Promise<SimulationBatchHistory>;
  getRunDataForBatchRun(input: SimulationBatchRunInput): Promise<SimulationBatchRunData>;
  getExternalSetSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]>;
  getRunDataForAllSuites(input: SimulationAllSuitesInput): Promise<SimulationAllSuitesRunData>;

  // -- the live stream -------------------------------------------------------
  /** The project's own fan-out, which the run stream reads its events off. */
  tenantEmitter(projectId: string): EventEmitter;
  /** Registers one open browser tab, and hands back how to retire it. */
  startTabPresence(registration: ScenarioTabRegistration): Promise<ScenarioTabPresence>;

  // -- the results tab -------------------------------------------------------
  getResultsOverview(input: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): Promise<ResultsOverview>;
  getResultAtoms(input: {
    filter: ResultsFilter;
    limit: number;
    cursor?: string;
  }): Promise<{ atoms: ResultAtom[]; nextCursor?: string; hasMore: boolean }>;
  getCodeScenarios(input: {
    projectId: string;
    startDate: number;
    endDate?: number;
  }): Promise<CodeScenario[]>;
  getRunTargets(input: {
    projectId: string;
    startDate: number;
    endDate?: number;
  }): Promise<RunTarget[]>;
  getRunConfigurations(input: {
    projectId: string;
    startDate?: number;
    endDate?: number;
    limit?: number;
  }): Promise<RunConfigurationEntryResponse[]>;
}

export const ScenarioApi = moduleApi<ScenarioApi>("scenario");

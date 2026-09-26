import type {
  AgentTestRunResult,
  AgentTestTurnResult,
  AgentWithFields,
} from "@langwatch/agent-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
import type { UserFullProfile, UserProfilesInput } from "@langwatch/user-contract";
import type { z } from "zod";

import type {
  CodeScenario,
  ResultAtom,
  ResultsFilter,
  ResultsGroupBy,
  ResultsOverview,
  RunTarget,
} from "./result-atoms.ts";
import type { RunActor } from "./run-actor.ts";
import type { ResolvedRunModels } from "./run-models.ts";
import type { RunSecretCiphertext } from "./run-secret-ciphertext.ts";
import type {
  ScenarioExecutionPrefetchInput,
  ScenarioExecutionPrefetchResult,
} from "./scenario-execution.service.ts";
import type {
  ScenarioGenerateRequest,
  ScenarioGenerateResponse,
} from "./scenario-generate.schemas.ts";
import type { ScenarioEvent } from "./scenario-run-data.ts";
import type {
  ScenarioRunExportDownload,
  ScenarioRunExportDownloadInput,
} from "./scenario-run-export.ts";
import type { ScenarioTabPresence, ScenarioTabRegistration } from "./scenario-tab-presence.ts";
import type { RunParameterValues } from "./scenario.parameters.ts";
import type { RunConfigurationEntryResponse, ScenarioRunScheduled } from "./scenario.responses.ts";
import type { scenarioTrpcRunSchema } from "./scenario.trpc.ts";
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
import type {
  ScenarioDuplicateInput,
  ScenarioMoveInput,
  ScenarioVersionDetail,
  ScenarioVersionInput,
  ScenarioVersionListInput,
  ScenarioVersionRestoreInput,
  ScenarioVersionSummary,
} from "./scenario.version.ts";
import type { ComputeRunMetricsCommandData, SimulationQueueRun } from "./simulation.commands.ts";
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
  SimulationAllSuitesRunData,
  SimulationBatchHistory,
  SimulationBatchRunData,
  SimulationBatchSummary,
  SimulationExternalSetSummary,
  SimulationLastResultSummary,
  SimulationRunData,
  SimulationStreamFrame,
  SimulationSetData,
} from "./simulation.ts";
import type {
  VoiceRecordingStream,
  VoiceSessionAudioRequest,
  VoiceSessionFinishRequest,
  VoiceSessionFinishResult,
  VoiceSessionMintRequest,
  VoiceSessionMintResult,
} from "./voice/voice-session.schemas.ts";

export interface TestAgentRunInput {
  projectId: string;
  agent: AgentWithFields;
  actor: RunActor | undefined;
}

export interface TestAgentTurnInput extends TestAgentRunInput {
  message: string;
  params?: Record<string, string | number | boolean>;
}

/** From deleted scenario.service.ts contract-service vocabulary. */
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

/** The project facts a scenario-events transport resolves before calling the app. */
export type ScenarioEventProject = {
  projectId: string;
  projectSlug: string;
};

export type ScenarioEventReportInput = ScenarioEventProject & {
  event: ScenarioEvent;
};

export type ScenarioEventReportResult = {
  success: true;
  url?: string;
};

export type ScenarioEventBrowserTabOfferInput = ScenarioEventProject & {
  tabKey: string;
  batchRunId: string;
  scenarioSetId?: string;
};

export type ScenarioEventBrowserTabOfferResult = {
  delivered: boolean;
  url: string;
};

export type ScenarioEventArchiveInput = {
  projectId: string;
  scenarioSetId?: string;
  scenarioRunId?: string;
};

export type ScenarioEventArchiveResult = {
  archived: number;
  failed: number;
  scenarioSetId?: string;
  hasMore?: boolean;
  scenarioRunId?: string;
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

/**
 * What the install-wide usage report counts here (ADR-156, section 10): the
 * scenario runs started, since `since` (epoch ms) where one is given, each
 * run at its latest version and archived runs left out.
 */
export interface ScenarioUsageCount {
  readonly runs: number;
}

/** One run of one scenario, as the tRPC `run` input names it, started by `actor`. */
export type ScenarioLaunchRunInput = z.infer<typeof scenarioTrpcRunSchema> &
  Readonly<{ actor: RunActor }>;

/** The scenario application: what every scenario door calls, and what peer
 * features such as Suite reach it by. */
export interface ScenarioApi {
  generateScenario(input: ScenarioGenerateRequest): Promise<ScenarioGenerateResponse>;
  reportScenarioEvent(input: ScenarioEventReportInput): Promise<ScenarioEventReportResult>;
  offerScenarioBrowserTab(
    input: ScenarioEventBrowserTabOfferInput,
  ): Promise<ScenarioEventBrowserTabOfferResult>;
  archiveScenarioEvents(input: ScenarioEventArchiveInput): Promise<ScenarioEventArchiveResult>;
  downloadScenarioRunExport(
    input: ScenarioRunExportDownloadInput,
  ): Promise<ScenarioRunExportDownload>;
  mintVoiceSession(input: VoiceSessionMintRequest): Promise<VoiceSessionMintResult>;
  finishVoiceSession(input: VoiceSessionFinishRequest): Promise<VoiceSessionFinishResult>;
  streamVoiceSessionAudio(input: VoiceSessionAudioRequest): Promise<VoiceRecordingStream>;
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
  /** One live scenario. Throws `ScenarioNotFoundError` when the project holds none. */
  getById(input: ScenarioIdInput): Promise<Scenario>;
  /** The same read, archived rows included. */
  tryGetByIdIncludingArchived(input: ScenarioIdInput): Promise<Scenario | null>;
  create(
    input: Omit<ScenarioCreateInput, "lastUpdatedById">,
    by: ScenarioCaller,
  ): Promise<Scenario>;
  update(
    input: Omit<ScenarioUpdateInput, "lastUpdatedById" | "actor">,
    by: ScenarioCaller,
  ): Promise<Scenario>;
  archive(input: ScenarioIdInput): Promise<Scenario>;
  batchArchive(input: {
    projectId: string;
    ids: string[];
  }): Promise<{ archived: string[]; failed: { id: string; error: string }[] }>;
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
  /** Resolves, validates and queues one run: the tRPC `run` and the scenario canary share it. */
  launchRun(input: ScenarioLaunchRunInput): Promise<ScenarioRunScheduled>;
  prefetchExecution(
    input: ScenarioExecutionPrefetchInput,
  ): Promise<ScenarioExecutionPrefetchResult>;
  queueSimulationRun(input: QueueSimulationRunInput): Promise<void>;
  /** Queues a settled simulation trace's run metrics onto simulation_processing. */
  computeRunMetrics(input: ComputeRunMetricsCommandData): Promise<void>;
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
  ): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }>;
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
  /** Frames published for this project's live simulation stream. */
  simulationUpdates(input: {
    projectId: string;
    signal?: AbortSignal;
  }): AsyncIterable<SimulationStreamFrame>;
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

  // -- the platform's own links ----------------------------------------------
  /** The platform's own address for one scenario or run, in the interface the project reads. */
  platformUrl(input: {
    projectId: string;
    projectSlug: string;
    resource: { scenarioId: string } | { scenarioRunId: string };
  }): Promise<string>;
  /** The pass/fail counts of one batch run, or null when the project holds none. */
  findBatchSummary(input: {
    projectId: string;
    batchRunId: string;
  }): Promise<SimulationBatchSummary | null>;
  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<ScenarioUsageCount>;
}

export const ScenarioApi = moduleApi<ScenarioApi>()("scenario");

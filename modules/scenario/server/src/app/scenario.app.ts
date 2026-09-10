/**
 * The scenario feature's application: what all of its doors call.
 */
import {
  startScenarioTabPresence,
  ScenarioApi,
  type CancelScenarioBatchInput,
  type CancelScenarioRunInput,
  type CodeScenario,
  type ResolveScenarioRunParametersInput,
  type ResolvedScenarioRunParameters,
  type ResultAtom,
  type ResultsFilter,
  type ResultsGroupBy,
  type ResultsOverview,
  type RunParameterValues,
  type RunSecretCiphertext,
  type RunTarget,
  type Scenario,
  type ScenarioCreateInput,
  type ScenarioDuplicateInput,
  type ScenarioExecutionPrefetchInput,
  type ScenarioExecutionPrefetchResult,
  type ScenarioExecutionService,
  type ScenarioIdInput,
  type ScenarioMoveInput,
  type ScenarioRunConfig,
  type ScenarioTestSuite,
  type ScenarioTestSuiteCreateInput,
  type ScenarioTestSuiteIdInput,
  type ScenarioTestSuiteRenameInput,
  type ScenarioTestSuiteRunDefinition,
  type ScenarioTestSuiteUpdateInput,
  type ScenarioTabPresence,
  type ScenarioTabRegistration,
  type ScenarioTabRegistry,
  type ScenarioUpdateInput,
  type ScenarioVersionDetail,
  type ScenarioVersionInput,
  type ScenarioVersionListInput,
  type ScenarioVersionRestoreInput,
  type ScenarioVersionSummary,
  type SimulationAllSuitesInput,
  type SimulationAllSuitesRunData,
  type SimulationBatchHistory,
  type SimulationBatchHistoryInput,
  type SimulationBatchRunData,
  type SimulationBatchRunInput,
  type SimulationExternalSetCountInput,
  type SimulationExternalSetSummary,
  type SimulationLastResultSummariesInput,
  type SimulationLastResultSummary,
  type SimulationLastUpdatedInput,
  type SimulationProjectDateRangeInput,
  type SimulationQueueRun,
  type SimulationRunData,
  type SimulationScenarioRunInput,
  type SimulationScenarioSetRunsInput,
  type SimulationService,
  type SimulationSetData,
  type ResolvedRunModels,
  type RunActor,
  withActor,
  withNote,
  withResolvedModels,
} from "@langwatch/scenario-contract";
import { UserApi, type UserFullProfile, type UserProfilesInput } from "@langwatch/user-contract";
import type { EventEmitter } from "node:events";
import type { TestAgentRunInput, TestAgentTurnInput } from "@langwatch/scenario-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { AgentTestService } from "../services/agent-test.service.ts";
import type {
  RunConfigurationEntry,
  RunConfigurationsService,
} from "../services/run-configurations.service.ts";
import type { ResultAtomsService } from "../services/result-atoms.service.ts";
import { ScenarioService } from "../services/scenario.service.ts";
import type { ScenarioRepositories } from "../repositories/scenario.repositories.ts";
import type { ScenarioIdPort, ScenarioTestSuiteIdPort } from "../ports/scenario-id.port.ts";
import type { ScenarioClockPort } from "../ports/scenario-clock.port.ts";
import type { ScenarioSecretCipherPort } from "../ports/scenario-secret-cipher.port.ts";

/**
 * The process's per-tenant fan-out, as this feature uses it: one emitter per project that relays
 * the events another pod published. Structural rather than the concrete broadcast service, because
 * the subscription needs nothing else from it.
 */
export type ScenarioBroadcast = Readonly<{
  getTenantEmitter(projectId: string): EventEmitter;
}>;

/** Who a write is attributed to. */
export interface ScenarioCaller {
  readonly id: string;
}

/** What the process composes this feature's application from. */
export interface ScenarioAppDependencies {
  agentTesting: AgentTestService;
  scenarios: ScenarioService;
  simulations: SimulationService;
  scenarioExecution: ScenarioExecutionService;
  scenarioTabs: ScenarioTabRegistry;
  users: UserApi;
  broadcast: ScenarioBroadcast;
  /** Reads results as atoms and folds them into the Results tab's views. */
  resultAtoms: ResultAtomsService;
  /** The run dialog's configuration history. */
  runConfigurations: RunConfigurationsService;
}

/**
 * The technical collaborators `installApiScenario` still assembles outside the
 * repository seam: the private services this feature builds over several
 * other verticals (agent testing, the run executor, the live buffer, the
 * ClickHouse-backed reads) and the four small ports the scenario CRUD service
 * itself is built over. None of these are peer APIs - moving their
 * construction fully inside this factory (agent testing over Suite/Prompt/
 * model providers, the executor over Suite's prefetch) is unfinished; see the
 * scenario module handover.
 */
export interface ScenarioAppInfrastructure {
  agentTesting: AgentTestService;
  simulations: SimulationService;
  scenarioExecution: ScenarioExecutionService;
  scenarioTabs: ScenarioTabRegistry;
  broadcast: ScenarioBroadcast;
  resultAtoms: ResultAtomsService;
  runConfigurations: RunConfigurationsService;
  ids: ScenarioIdPort;
  testSuiteIds: ScenarioTestSuiteIdPort;
  clock: ScenarioClockPort;
  secretCipher: ScenarioSecretCipherPort;
}

/** The one peer API this feature reads directly. */
export const scenarioAppDependencyTokens = { users: UserApi };

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

export class ScenarioApp implements ScenarioApi {
  static readonly contract = ScenarioApi;
  static readonly dependencies = scenarioAppDependencyTokens;

  static create(
    setup: FeatureSetup<
      typeof scenarioAppDependencyTokens,
      ScenarioAppInfrastructure,
      undefined,
      ScenarioRepositories
    >,
  ): ScenarioApp {
    const scenarios = ScenarioService.create({
      repository: setup.repositories.scenarios,
      simulations: setup.infrastructure.simulations,
      ids: setup.infrastructure.ids,
      testSuiteIds: setup.infrastructure.testSuiteIds,
      clock: setup.infrastructure.clock,
      secretCipher: setup.infrastructure.secretCipher,
    });

    return new ScenarioApp({
      agentTesting: setup.infrastructure.agentTesting,
      scenarios,
      simulations: setup.infrastructure.simulations,
      scenarioExecution: setup.infrastructure.scenarioExecution,
      scenarioTabs: setup.infrastructure.scenarioTabs,
      users: setup.dependencies.users,
      broadcast: setup.infrastructure.broadcast,
      resultAtoms: setup.infrastructure.resultAtoms,
      runConfigurations: setup.infrastructure.runConfigurations,
    });
  }

  #dependencies: ScenarioAppDependencies;

  private constructor(dependencies: ScenarioAppDependencies) {
    this.#dependencies = dependencies;
  }

  testAgentTurn(input: TestAgentTurnInput) {
    return this.#dependencies.agentTesting.sendTurn(input);
  }

  testAgentRun(input: TestAgentRunInput) {
    return this.#dependencies.agentTesting.scheduleRun(input);
  }

  /**
   * The author a versioned write is recorded under. One spelling, in one place. Two doors built
   * this literal for themselves — the CRUD update and the version restore — which is two chances
   * for a saved version to name the wrong author or none.
   */
  private authorFor(by: ScenarioCaller): { userId: string; label: "user" } {
    return { userId: by.id, label: "user" };
  }

  // -- the test case itself --------------------------------------------------

  /** Every non-archived scenario in the project. */
  list(input: { projectId: string }): Promise<Scenario[]> {
    return this.#dependencies.scenarios.list(input);
  }

  listTestSuites(input: {
    projectId: string;
    includeArchived?: boolean;
  }): Promise<ScenarioTestSuite[]> {
    return this.#dependencies.scenarios.listTestSuites(input);
  }

  getReferenceStates(input: { ids: string[]; projectId: string }) {
    return this.#dependencies.scenarios.getReferenceStates(input);
  }

  getRunConfigs(input: { ids: string[]; projectId: string }) {
    return this.#dependencies.scenarios.getRunConfigs(input);
  }

  getModelChoices(input: { ids: string[]; projectId: string }) {
    return this.#dependencies.scenarios.getModelChoices(input);
  }

  resolveRunParametersForScenarios(input: {
    scenarios: ScenarioRunConfig[];
    values?: RunParameterValues;
  }) {
    return this.#dependencies.scenarios.resolveRunParametersForScenarios(input);
  }

  getNamesByIds(input: { ids: string[]; projectId: string }) {
    return this.#dependencies.scenarios.getNamesByIds(input);
  }

  tryGetTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite | null> {
    return this.#dependencies.scenarios.tryGetTestSuite(input);
  }

  createTestSuite(input: ScenarioTestSuiteCreateInput): Promise<ScenarioTestSuite> {
    return this.#dependencies.scenarios.createTestSuite(input);
  }

  updateTestSuite(input: ScenarioTestSuiteUpdateInput): Promise<ScenarioTestSuite> {
    return this.#dependencies.scenarios.updateTestSuite(input);
  }

  getTestSuiteRunDefinition(
    input: ScenarioTestSuiteIdInput,
  ): Promise<ScenarioTestSuiteRunDefinition> {
    return this.#dependencies.scenarios.getTestSuiteRunDefinition(input);
  }

  archiveTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite> {
    return this.#dependencies.scenarios.archiveTestSuite(input);
  }

  renameTestSuite(input: ScenarioTestSuiteRenameInput): Promise<ScenarioTestSuite> {
    return this.#dependencies.scenarios.renameTestSuite(input);
  }

  getInternalSuiteSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]> {
    return this.#dependencies.simulations.getInternalSuiteSummaries(input);
  }

  /** How many scenarios the project holds. */
  count(input: { projectId: string }): Promise<number> {
    return this.#dependencies.scenarios.count(input);
  }

  /** One scenario, or null when it does not exist or is archived. */
  tryGetById(input: ScenarioIdInput): Promise<Scenario | null> {
    return this.#dependencies.scenarios.tryGetById(input);
  }

  /** One scenario, archived ones included. */
  tryGetByIdIncludingArchived(input: ScenarioIdInput): Promise<Scenario | null> {
    return this.#dependencies.scenarios.tryGetByIdIncludingArchived(input);
  }

  /**
   * Creates a scenario, attributed to the caller who asked for it. The attribution is here rather
   * than in each door because "who last touched this" is a property of the act, not of the
   * transport it arrived over.
   */
  create(
    input: Omit<ScenarioCreateInput, "lastUpdatedById">,
    by: ScenarioCaller,
  ): Promise<Scenario> {
    return this.#dependencies.scenarios.create({ ...input, lastUpdatedById: by.id });
  }

  /**
   * Saves a scenario, attributed to the caller who asked for it. Both fields are stamped:
   * `lastUpdatedById` is who the row says last touched it, and `actor` is who the saved VERSION
   * names as its author.
   */
  update(
    input: Omit<ScenarioUpdateInput, "lastUpdatedById" | "actor">,
    by: ScenarioCaller,
  ): Promise<Scenario> {
    return this.#dependencies.scenarios.update({
      ...input,
      lastUpdatedById: by.id,
      actor: this.authorFor(by),
    });
  }

  /** Archives one scenario. */
  archive(input: ScenarioIdInput): Promise<Scenario> {
    return this.#dependencies.scenarios.archive(input);
  }

  /** Archives several scenarios, reporting each failure rather than stopping. */
  batchArchive(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ archived: string[]; failed: { id: string; error: string }[] }> {
    return this.#dependencies.scenarios.batchArchive(input);
  }

  /** Files one scenario in a test suite, or unfiles it when `testSuiteId` is null. */
  moveToTestSuite(input: ScenarioMoveInput): Promise<Scenario> {
    return this.#dependencies.scenarios.moveToTestSuite(input);
  }

  /** Copies a scenario, attributed to the caller who asked for it. */
  duplicate(
    input: Omit<ScenarioDuplicateInput, "lastUpdatedById">,
    by: ScenarioCaller,
  ): Promise<Scenario> {
    return this.#dependencies.scenarios.duplicate({ ...input, lastUpdatedById: by.id });
  }

  // -- version history -------------------------------------------------------

  /** One page of a scenario's saved versions. */
  listVersions(input: ScenarioVersionListInput): Promise<{
    versions: ScenarioVersionSummary[];
    nextCursor: number | null;
  }> {
    return this.#dependencies.scenarios.listVersions(input);
  }

  /** One saved version in full. */
  getVersion(input: ScenarioVersionInput): Promise<ScenarioVersionDetail> {
    return this.#dependencies.scenarios.getVersion(input);
  }

  /** Makes a saved version current again, attributed to its caller. */
  restoreVersion(
    input: Omit<ScenarioVersionRestoreInput, "actor">,
    by: ScenarioCaller,
  ): Promise<Scenario> {
    return this.#dependencies.scenarios.restoreVersion({
      ...input,
      actor: this.authorFor(by),
    });
  }

  /**
   * The profiles behind a set of author ids. The version history stores only the id of whoever
   * saved each version; the name a person reads is resolved from it.
   */
  getUserProfiles(input: UserProfilesInput): Promise<UserFullProfile[]> {
    return this.#dependencies.users.getProfiles(input);
  }

  // -- running a scenario ----------------------------------------------------

  /**
   * What the run reads as `params.NAME` and what it reads as `secrets.NAME`:
   * the scenario's declared defaults, with the supplied values over the top,
   * and the secret values split out and encrypted.
   */
  resolveRunParameters(
    input: ResolveScenarioRunParametersInput,
  ): Promise<ResolvedScenarioRunParameters> {
    return this.#dependencies.scenarios.resolveRunParameters(input);
  }

  /** Validates a run against its target before anything is queued. */
  prefetchExecution(
    input: ScenarioExecutionPrefetchInput,
  ): Promise<ScenarioExecutionPrefetchResult> {
    return this.#dependencies.scenarioExecution.prefetch(input);
  }

  /**
   * Dispatches the queued command, which is what writes QUEUED state before the execution job is
   * scheduled — the same order the suite execution port uses. The resolved parameters travel on the
   * metadata, which is the only channel that carries them into execution.
   */
  queueSimulationRun(input: QueueSimulationRunInput): Promise<void> {
    const secretParameterNames = Object.keys(input.secretParameters);
    const metadata = {
      // The reserved namespace records the target this run was pointed at, the
      // scenario version it was queued from, who started it and the models it
      // resolved, the same way a suite run does.
      langwatch: {
        targetReferenceId: input.target.referenceId,
        targetType: input.target.type,
        ...(input.scenarioVersion !== undefined ? { scenarioVersion: input.scenarioVersion } : {}),
        ...withActor(input.actor),
        ...withResolvedModels(input.resolvedModels),
      },
      ...withNote(input.note),
      ...(Object.keys(input.parameters).length > 0 ? { parameters: input.parameters } : {}),
      ...(secretParameterNames.length > 0 ? { secretParameterNames } : {}),
    };

    return this.#dependencies.simulations.queueRun({
      tenantId: input.projectId,
      scenarioRunId: input.scenarioRunId,
      scenarioId: input.scenarioId,
      batchRunId: input.batchRunId,
      scenarioSetId: input.setId,
      name: input.name,
      metadata,
      ...(secretParameterNames.length > 0 ? { secretParameters: input.secretParameters } : {}),
      target: { type: input.target.type, referenceId: input.target.referenceId },
      occurredAt: Date.now(),
    });
  }

  /** Cancels one queued or running job. */
  cancelJob(input: CancelScenarioRunInput): Promise<{ cancelled: boolean }> {
    return this.#dependencies.scenarios.cancelJob(input);
  }

  /** Cancels every job in one batch run. */
  cancelBatchRun(
    input: CancelScenarioBatchInput,
  ): Promise<{ cancelledCount: number; skippedCount: number }> {
    return this.#dependencies.scenarios.cancelBatchRun(input);
  }

  // -- reading what ran ------------------------------------------------------

  /**
   * The runs of one suite, or of every suite when no set is named. Which read answers is a domain
   * question, not a paging one: a named set reads that set and files each batch under it, and an
   * absent one reads across every suite and honours a conditional fetch.
   */
  async readSuiteRunData(input: {
    projectId: string;
    scenarioSetId?: string;
    limit: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
    sinceTimestamp?: number;
  }): Promise<SimulationAllSuitesRunData> {
    const { projectId, scenarioSetId, limit, cursor, startDate, endDate, sinceTimestamp } = input;

    if (scenarioSetId) {
      // Single suite/set view — no conditional fetch support yet.
      const data = await this.#dependencies.simulations.getRunDataForScenarioSet({
        projectId,
        scenarioSetId,
        limit,
        cursor,
        startDate,
        endDate,
      });

      const scenarioSetIds: Record<string, string> = {};
      for (const run of data.runs) {
        if (run.batchRunId) {
          scenarioSetIds[run.batchRunId] = scenarioSetId;
        }
      }

      return {
        changed: true,
        lastUpdatedAt: 0,
        runs: data.runs,
        scenarioSetIds,
        hasMore: data.hasMore,
        nextCursor: data.nextCursor,
      };
    }

    // Cross-suite view — supports conditional fetch via sinceTimestamp.
    return this.#dependencies.simulations.getRunDataForAllSuites({
      projectId,
      limit,
      cursor,
      startDate,
      endDate,
      sinceTimestamp,
    });
  }

  /** The project's suites, summarised. */
  getScenarioSetsData(input: SimulationProjectDateRangeInput): Promise<SimulationSetData[]> {
    return this.#dependencies.simulations.getScenarioSetsData(input);
  }

  /** The latest run result per test case inside the window. */
  getLastResultSummaries(
    input: SimulationLastResultSummariesInput,
  ): Promise<SimulationLastResultSummary[]> {
    return this.#dependencies.simulations.getLastResultSummaries(input);
  }

  /** The latest update across the project's runs — a cheap freshness probe. */
  getLastUpdatedAt(input: SimulationLastUpdatedInput): Promise<number> {
    return this.#dependencies.simulations.getLastUpdatedAt(input);
  }

  /** One page of one suite's runs. */
  getRunDataForScenarioSet(
    input: SimulationScenarioSetRunsInput,
  ): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }> {
    return this.#dependencies.simulations.getRunDataForScenarioSet(input);
  }

  /** One run by its id. No date window, so old runs stay reachable. */
  tryGetScenarioRunData(input: SimulationScenarioRunInput): Promise<SimulationRunData | null> {
    return this.#dependencies.simulations.tryGetScenarioRunData(input);
  }

  /** How many batch runs one suite has, for its pagination. */
  getBatchRunCountForScenarioSet(input: SimulationExternalSetCountInput): Promise<number> {
    return this.#dependencies.simulations.getBatchRunCountForScenarioSet(input);
  }

  /** The pre-aggregated batch history one suite's sidebar renders. */
  getBatchHistoryForScenarioSet(
    input: SimulationBatchHistoryInput,
  ): Promise<SimulationBatchHistory> {
    return this.#dependencies.simulations.getBatchHistoryForScenarioSet(input);
  }

  /** One batch run's runs. No date window, so old batches open directly. */
  getRunDataForBatchRun(input: SimulationBatchRunInput): Promise<SimulationBatchRunData> {
    return this.#dependencies.simulations.getRunDataForBatchRun(input);
  }

  /** Summaries for the suites the SDK and CI report into. */
  getExternalSetSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]> {
    return this.#dependencies.simulations.getExternalSetSummaries(input);
  }

  /** Runs across every suite, one page at a time. */
  getRunDataForAllSuites(input: SimulationAllSuitesInput): Promise<SimulationAllSuitesRunData> {
    return this.#dependencies.simulations.getRunDataForAllSuites(input);
  }

  // -- the live stream -------------------------------------------------------

  /** The project's fan-out emitter, relaying what another pod published. */
  tenantEmitter(projectId: string): EventEmitter {
    return this.#dependencies.broadcast.getTenantEmitter(projectId);
  }

  /**
   * Registers a browser tab as present, and claims any navigate parked for it.
   */
  startTabPresence(registration: ScenarioTabRegistration): Promise<ScenarioTabPresence> {
    return startScenarioTabPresence({
      registration,
      registry: this.#dependencies.scenarioTabs,
    });
  }

  // -- the results tab --------------------------------------------------------

  /** The stat strip and the group rows for one grouping, aggregated in the database. */
  getResultsOverview(input: {
    filter: ResultsFilter;
    groupBy: ResultsGroupBy;
  }): Promise<ResultsOverview> {
    return this.#dependencies.resultAtoms.getOverview(input);
  }

  /** One page of atoms, newest first. A drill-down, never a total. */
  getResultAtoms(input: {
    filter: ResultsFilter;
    limit: number;
    cursor?: string;
  }): Promise<{ atoms: ResultAtom[]; nextCursor?: string; hasMore: boolean }> {
    return this.#dependencies.resultAtoms.getAtoms(input);
  }

  /** The scenarios that ran from code inside the window, for the scenario filter. */
  getCodeScenarios(input: {
    projectId: string;
    startDate: number;
    endDate?: number;
  }): Promise<CodeScenario[]> {
    return this.#dependencies.resultAtoms.getCodeScenarios(input);
  }

  /** The targets the window names that the stored agent and prompt lists cannot. */
  getRunTargets(input: {
    projectId: string;
    startDate: number;
    endDate?: number;
  }): Promise<RunTarget[]> {
    return this.#dependencies.resultAtoms.getRunTargets(input);
  }

  /** Every configuration this project's run plans already ran with, newest first. */
  getRunConfigurations(input: {
    projectId: string;
    startDate?: number;
    endDate?: number;
    limit?: number;
  }): Promise<RunConfigurationEntry[]> {
    return this.#dependencies.runConfigurations.getEntries(input);
  }
}

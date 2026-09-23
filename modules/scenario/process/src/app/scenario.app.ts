import { on, type EventEmitter } from "node:events";

import {
  AgentApi,
  type AgentTestRunResult,
  type AgentTestTurnResult,
} from "@langwatch/agent-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { BillingApi } from "@langwatch/enterprise-billing-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type { FeatureSetup } from "@langwatch/kernel";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { PresenceApi } from "@langwatch/presence-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { AgentAdapter } from "@langwatch/scenario";
import {
  DEFAULT_SET_ID,
  type RunConfigurationEntryResponse,
  startScenarioTabPresence,
  ScenarioApi,
  type CancelScenarioBatchInput,
  type CancelScenarioRunInput,
  type CodeScenario,
  type ResolveScenarioRunParametersInput,
  type ResolvedScenarioRunParameters,
  type ResolvedScenarioRunParametersForScenario,
  type ScenarioReferenceState,
  type ResultAtom,
  type ResultsFilter,
  type ResultsGroupBy,
  type ResultsOverview,
  type RunParameterValues,
  type RunTarget,
  type Scenario,
  type ScenarioAuthorLabel,
  type ScenarioCaller,
  type ScenarioCreateInput,
  type ScenarioDuplicateInput,
  type ScenarioExecutionPrefetchInput,
  type ScenarioExecutionPrefetchResult,
  type ScenarioEventArchiveInput,
  type ScenarioEventArchiveResult,
  type ScenarioEventBrowserTabOfferInput,
  type ScenarioEventBrowserTabOfferResult,
  type ScenarioEventReportInput,
  type ScenarioEventReportResult,
  type ScenarioExecutionService,
  type ScenarioIdInput,
  type ScenarioMoveInput,
  type ScenarioRunConfig,
  type ScenarioGenerateRequest,
  type ScenarioGenerateResponse,
  type ScenarioRunExportDownload,
  type ScenarioRunExportDownloadInput,
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
  type SimulationBatchSummary,
  type QueueSimulationRunInput,
  type SimulationRunData,
  type SimulationScenarioRunInput,
  type SimulationScenarioSetRunsInput,
  type ScenarioUsageCount,
  type SimulationService,
  type SimulationSetData,
  ScenarioSimulationsUnavailableError,
  withActor,
  withNote,
  withResolvedModels,
  type SimulationStreamFrame,
  type ChildProcessJobData,
  type ScenarioExecutionJob,
  type ScenarioExecutionResult,
  type TestAgentRunInput,
  type TestAgentTurnInput,
  type TargetAdapterData,
  type LiteLLMParams,
} from "@langwatch/scenario-contract";
/**
 * The scenario feature's application: what all of its doors call.
 */
import { nowInstant, toDate, type Instant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";
import { UserApi, type UserFullProfile, type UserProfilesInput } from "@langwatch/user-contract";

import type { ScenarioEventBroadcast } from "../channels/scenario-event-broadcast.channel.ts";
import {
  buildScenarioLifecyclePipeline,
  type ScenarioLifecyclePipeline,
} from "../eventing/scenario-lifecycle.pipeline.ts";
import type { ScenarioRepositories } from "../repositories/scenario.repositories.ts";
import { scenarioPlatformUrl } from "../rules/scenario-platform-url.rules.ts";
import type { AgentTestService } from "../services/agent-test.service.ts";
import { ConnectedTargetService } from "../services/connected-target.service.ts";
import type { ResultAtomsService } from "../services/result-atoms.service.ts";
import type { RunConfigurationsService } from "../services/run-configurations.service.ts";
import { ScenarioEventService } from "../services/scenario-event.service.ts";
import type { ExecutionJobData } from "../services/scenario-execution-pool.service.ts";
import { ScenarioGenerateBoundsService } from "../services/scenario-generate-bounds.service.ts";
import { ScenarioGenerationService } from "../services/scenario-generation.service.ts";
import { ScenarioRunExportDownloadService } from "../services/scenario-run-export-download.service.ts";
import { ScenarioRunExportService } from "../services/scenario-run-export.service.ts";
import { ScenarioService } from "../services/scenario.service.ts";
import { buildScenarioComposition } from "./scenario-composition.build.ts";

const lifecycleLogger = createLogger("langwatch:scenario:lifecycle");

/**
 * The process's per-tenant fan-out, as this feature uses it: one emitter per project that relays
 * the events another pod published. Structural rather than the concrete broadcast service, because
 * the subscription needs nothing else from it.
 */
export type ScenarioBroadcast = ScenarioEventBroadcast &
  Readonly<{
    getTenantEmitter(projectId: string): EventEmitter;
  }>;

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
  /** The author-assist door's tier-effective generation window. */
  generateBounds: ScenarioGenerateBoundsService;
  generation: ScenarioGenerationService;
  runExportDownloads: ScenarioRunExportDownloadService;
  events: ScenarioEventService;
  connectedTargets: ConnectedTargetService;
}

/**
 * Technical collaborators assembled outside the repository seam: private
 * services (agent testing, executor, buffer, reads) and four small ports.
 */
export interface ScenarioAppInfrastructure {
  agentTesting: AgentTestService;
  simulations: SimulationService;
  scenarioExecution: ScenarioExecutionService;
  scenarioTabs: ScenarioTabRegistry;
  broadcast: ScenarioBroadcast;
  resultAtoms: ResultAtomsService;
  runConfigurations: RunConfigurationsService;
  ids: ScenarioId;
  testSuiteIds: ScenarioTestSuiteId;
  clock: ScenarioClock;
  secretCipher: ScenarioSecretCipher;
}

/** The peer APIs this feature reads directly. */
export const scenarioAppDependencyTokens = {
  agents: AgentApi,
  users: UserApi,
  /** The project→organization hop the author-assist's window resolves through. */
  projects: ProjectApi,
  /** The plan the author-assist's generation window resolves through. */
  plans: EntitlementApi,
  modelProviders: ModelProviderApi,
  presence: PresenceApi,
  auditLog: AuditLogApi,
  traces: TraceApi,
  /** Where a created scenario is announced, for product analytics and nurturing. */
  billing: BillingApi,
};

/**
 * Shapes restated rather than imported from `@langwatch/process-stores`: a
 * module depends on contracts. `publicBaseUrl` is the process's own fact,
 * absent where the deployment named no `BASE_HOST`.
 */
export type ScenarioReadOnlyClickHouse = Readonly<{
  query<Row>(input: {
    tenantId: string;
    sql: string;
    params?: Record<string, unknown>;
  }): Promise<{ rows: Row[] }>;
}>;

type ScenarioProcessMembers = Readonly<{
  clickhouse: ScenarioReadOnlyClickHouse;
  encryption: Readonly<{ encrypt(plaintext: string): string; decrypt(ciphertext: string): string }>;
  rateLimiter: Readonly<{
    check(
      key: string,
      limit?: { requests: number; seconds: number },
    ): Promise<Readonly<{ allowed: boolean; retryAfterSeconds?: number }>>;
  }>;
  idempotency: Readonly<{ claim(key: string, ttlSeconds: number): Promise<boolean> }>;
  publicBaseUrl: string | undefined;
}>;

/**
 * What `ScenarioApp.create` is handed as `setup.members`: the platform
 * members read directly, plus the collaborators still handed over whole from
 * the deleted `scenario.composition.ts` (scenario-composition-green handover).
 */
type ScenarioAppMembers = ScenarioProcessMembers &
  Omit<ScenarioAppInfrastructure, "ids" | "testSuiteIds" | "clock" | "secretCipher">;

export class ScenarioApp implements ScenarioApi {
  static readonly contract = ScenarioApi;
  static readonly dependencies = scenarioAppDependencyTokens;
  /** Every name is from the process's vocabulary; boot refuses by name. */
  static readonly reads = [
    "clickhouse",
    "encryption",
    "rateLimiter",
    "idempotency",
    "publicBaseUrl",
  ] as const;

  static create(
    setup: FeatureSetup<
      typeof scenarioAppDependencyTokens,
      ScenarioAppMembers,
      undefined,
      ScenarioRepositories
    >,
  ): ScenarioApp {
    const composed = buildScenarioComposition({
      encryption: setup.members.encryption,
      clickhouse: setup.members.clickhouse,
    });
    const { ids, testSuiteIds, clock, secretCipher } = composed;
    // A process that composes its own whole simulation service still wins;
    // otherwise the module builds the reads its own ClickHouse member derives.
    const simulations = setup.members.simulations ?? composed.simulations;
    const scenarios = ScenarioService.create({
      repository: setup.repositories.scenarios,
      simulations,
      ids,
      testSuiteIds,
      clock,
      secretCipher,
    });
    const generateBounds = ScenarioGenerateBoundsService.create({
      entitlement: setup.dependencies.plans,
      projects: setup.dependencies.projects,
      rateLimiter: setup.members.rateLimiter,
    });
    const exports = ScenarioRunExportService.create(simulations);

    return new ScenarioApp({
      agentTesting: setup.members.agentTesting,
      connectedTargets: ConnectedTargetService.create(setup.dependencies.agents),
      scenarios,
      simulations,
      scenarioExecution: setup.members.scenarioExecution,
      scenarioTabs: setup.members.scenarioTabs,
      users: setup.dependencies.users,
      broadcast: setup.members.broadcast,
      resultAtoms: setup.members.resultAtoms,
      runConfigurations: setup.members.runConfigurations,
      generateBounds,
      generation: ScenarioGenerationService.create({
        bounds: generateBounds,
        modelProviders: setup.dependencies.modelProviders,
      }),
      runExportDownloads: ScenarioRunExportDownloadService.create({
        auditLog: setup.dependencies.auditLog,
        exports,
        presence: setup.dependencies.presence,
      }),
      events: ScenarioEventService.create({
        simulations,
        scenarioTabs: setup.members.scenarioTabs,
        broadcast: setup.members.broadcast,
        traces: setup.dependencies.traces,
      }),
      publicBaseUrl: setup.members.publicBaseUrl,
      lifecycle: buildScenarioLifecyclePipeline({
        announce: (signal) => setup.dependencies.billing.recordScenarioCreated(signal),
        claim: (key, ttlSeconds) => setup.members.idempotency.claim(key, ttlSeconds),
      }),
    });
  }

  #dependencies: ScenarioAppDependencies;
  readonly #publicBaseUrl: string | undefined;
  readonly #lifecycle: ScenarioLifecyclePipeline;
  #lifecycleCommands: EventingCommands<ScenarioLifecyclePipeline> | undefined;

  private constructor(
    dependencies: ScenarioAppDependencies & {
      publicBaseUrl: string | undefined;
      lifecycle: ScenarioLifecyclePipeline;
    },
  ) {
    const { publicBaseUrl, lifecycle, ...rest } = dependencies;
    this.#publicBaseUrl = publicBaseUrl;
    this.#lifecycle = lifecycle;
    this.#dependencies = rest;
  }

  testAgentTurn(input: TestAgentTurnInput): Promise<AgentTestTurnResult> {
    return this.#dependencies.agentTesting.sendTurn(input);
  }

  generateScenario(input: ScenarioGenerateRequest): Promise<ScenarioGenerateResponse> {
    return this.#dependencies.generation.generate(input);
  }

  downloadScenarioRunExport(
    input: ScenarioRunExportDownloadInput,
  ): Promise<ScenarioRunExportDownload> {
    return this.#dependencies.runExportDownloads.download(input);
  }

  async reportScenarioEvent(input: ScenarioEventReportInput): Promise<ScenarioEventReportResult> {
    const reported = await this.#dependencies.events.report(input);
    if (reported.scenarioSetId === null) return { success: true };

    return {
      success: true,
      url: this.platformUrl({
        projectSlug: input.projectSlug,
        path: `/simulations/${reported.scenarioSetId}`,
      }),
    };
  }

  offerScenarioBrowserTab(
    input: ScenarioEventBrowserTabOfferInput,
  ): Promise<ScenarioEventBrowserTabOfferResult> {
    return this.#dependencies.events.offerBrowserTab({
      ...input,
      url: this.platformUrl({
        projectSlug: input.projectSlug,
        path: `/simulations/${encodeURIComponent(
          input.scenarioSetId || DEFAULT_SET_ID,
        )}/${encodeURIComponent(input.batchRunId)}`,
      }),
    });
  }

  archiveScenarioEvents(input: ScenarioEventArchiveInput): Promise<ScenarioEventArchiveResult> {
    return this.#dependencies.events.archive(input);
  }

  testAgentRun(input: TestAgentRunInput): Promise<AgentTestRunResult> {
    return this.#dependencies.agentTesting.scheduleRun(input);
  }

  /**
   * The author a versioned write is recorded under, in one place: two doors
   * used to build this literal themselves, letting a version name the wrong
   * author. tRPC always names "user"; REST reads "cli" or "api" from the header.
   */
  private authorFor(by: ScenarioCaller): { userId: string; label: ScenarioAuthorLabel } {
    return { userId: by.id, label: by.label };
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

  getReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioReferenceState[]> {
    return this.#dependencies.scenarios.getReferenceStates(input);
  }

  getRunConfigs(input: { ids: string[]; projectId: string }): Promise<ScenarioRunConfig[]> {
    return this.#dependencies.scenarios.getRunConfigs(input);
  }

  getModelChoices(input: { ids: string[]; projectId: string }) {
    return this.#dependencies.scenarios.getModelChoices(input);
  }

  resolveRunParametersForScenarios(input: {
    scenarios: ScenarioRunConfig[];
    values?: RunParameterValues;
  }): Promise<ResolvedScenarioRunParametersForScenario[]> {
    return this.#dependencies.scenarios.resolveRunParametersForScenarios(input);
  }

  getNamesByIds(input: { ids: string[]; projectId: string }) {
    return this.#dependencies.scenarios.getNamesByIds(input);
  }

  findTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite | null> {
    return this.#dependencies.scenarios.findTestSuite(input);
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
  async create(
    input: Omit<ScenarioCreateInput, "lastUpdatedById">,
    by: ScenarioCaller,
  ): Promise<Scenario> {
    const scenario = await this.#dependencies.scenarios.create({
      ...input,
      // REST can name an explicit actor when its credential names no person;
      // `by.id` alone would answer "the key" or "the project", neither a
      // `User` row. tRPC, always a signed-in person, keeps the old behavior.
      lastUpdatedById: input.actor ? input.actor.userId : by.id,
    });

    this.reportScenarioCreated({ scenario, projectId: input.projectId, userId: by.id });

    return scenario;
  }

  /**
   * Records the write on the scenario's own pipeline, without making the caller
   * wait for it and without letting the report fail the create.
   */
  private reportScenarioCreated(input: {
    scenario: Scenario;
    projectId: string;
    userId: string;
  }): void {
    const { scenario, projectId, userId } = input;
    void this.#dependencies.scenarios
      .count({ projectId })
      .then((scenarioCount) => {
        if (!this.#lifecycleCommands) {
          throw new Error("scenario_lifecycle pipeline senders are not connected yet");
        }
        return this.#lifecycleCommands.recordScenarioCreated.send({
          tenantId: projectId,
          occurredAt: nowInstant().epochMilliseconds,
          scenarioId: scenario.id,
          projectId,
          userId,
          scenarioCount,
        });
      })
      .catch((error: unknown) => {
        lifecycleLogger.error({ error, projectId }, "failed to record a created scenario");
      });
  }

  /** The scenario lifecycle pipeline this module registers, built once by {@link create}. */
  lifecyclePipeline(): ScenarioLifecyclePipeline {
    return this.#lifecycle;
  }

  /** Binds the built lifecycle pipeline's own senders. */
  connectLifecycleCommands(commands: EventingCommands<ScenarioLifecyclePipeline>): void {
    this.#lifecycleCommands = commands;
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
   * The author-assist door's one budget question, answered before its model
   * is resolved: counts the generation against the project's tier-effective
   * window and refuses the overage.
   */
  assertScenarioGenerateWithinBounds(input: { projectId: string }): Promise<void> {
    return this.#dependencies.generateBounds.assertGenerateWithinBounds(input);
  }

  /**
   * Dispatches the queued command, which is what writes QUEUED state before the execution job is
   * scheduled — the same order the suite execution port uses. The resolved parameters travel on the
   * metadata, which is the only channel that carries them into execution.
   */
  async queueSimulationRun(input: QueueSimulationRunInput): Promise<void> {
    const target = await this.#dependencies.connectedTargets.resolve({
      projectId: input.projectId,
      target: input.target,
      actorId: input.actor?.id,
    });
    const secretParameterNames = Object.keys(input.secretParameters);
    const metadata = {
      // The reserved namespace records the target this run was pointed at, the
      // scenario version it was queued from, who started it and the models it
      // resolved, the same way a suite run does.
      langwatch: {
        targetReferenceId: target.referenceId,
        targetType: target.type,
        ...(input.scenarioVersion !== undefined ? { scenarioVersion: input.scenarioVersion } : {}),
        ...withActor(input.actor),
        ...withResolvedModels(input.resolvedModels),
      },
      ...withNote(input.note),
      ...(Object.keys(input.parameters).length > 0 ? { parameters: input.parameters } : {}),
      ...(secretParameterNames.length > 0 ? { secretParameterNames } : {}),
    };

    await this.#dependencies.simulations.queueRun({
      tenantId: input.projectId,
      scenarioRunId: input.scenarioRunId,
      scenarioId: input.scenarioId,
      batchRunId: input.batchRunId,
      scenarioSetId: input.setId,
      name: input.name,
      metadata,
      ...(secretParameterNames.length > 0 ? { secretParameters: input.secretParameters } : {}),
      target: { type: target.type, referenceId: target.referenceId },
      occurredAt: nowInstant().epochMilliseconds,
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
  findScenarioRunData(input: SimulationScenarioRunInput): Promise<SimulationRunData | null> {
    return this.#dependencies.simulations.findScenarioRunData(input);
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
  async getRunDataForAllSuites(
    input: SimulationAllSuitesInput,
  ): Promise<SimulationAllSuitesRunData> {
    const simulations = this.#dependencies.simulations;
    if (!simulations) throw new ScenarioSimulationsUnavailableError();

    return simulations.getRunDataForAllSuites(input);
  }

  // -- the live stream -------------------------------------------------------

  /** Relays frames from the project's fan-out until its subscriber disconnects. */
  async *simulationUpdates({
    projectId,
    signal,
  }: {
    projectId: string;
    signal?: AbortSignal;
  }): AsyncIterable<SimulationStreamFrame> {
    const emitter = this.#dependencies.broadcast.getTenantEmitter(projectId);
    for await (const [frame] of on(emitter, "simulation_updated", { signal })) {
      yield frame;
    }
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
  async getRunConfigurations(input: {
    projectId: string;
    startDate?: number;
    endDate?: number;
    limit?: number;
  }): Promise<RunConfigurationEntryResponse[]> {
    const entries = await this.#dependencies.runConfigurations.getEntries(input);
    return entries.map((entry) => ({ ...entry, lastRunAt: toDate(entry.lastRunAt) }));
  }

  // -- the platform's own links ------------------------------------------

  /**
   * The platform's own address for one scenario resource. A deployment that
   * serves these families but named no public origin refuses by name.
   */
  platformUrl(input: { projectSlug: string; path: string }): string {
    if (this.#publicBaseUrl === undefined) {
      throw new Error(
        "The scenario REST families were asked for a platform link, but this deployment named no public base URL",
      );
    }

    return scenarioPlatformUrl({ publicBaseUrl: this.#publicBaseUrl, ...input });
  }

  /** The pass/fail counts of one batch run, or null when the project holds none. */
  findBatchSummary(input: {
    projectId: string;
    batchRunId: string;
  }): Promise<SimulationBatchSummary | null> {
    return this.#dependencies.simulations.findBatchSummary(input);
  }

  /** The usage report's figures (ADR-156, section 10). */
  async countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<ScenarioUsageCount> {
    return { runs: await this.#dependencies.simulations.countUsage(input) };
  }
}

/** The serialized description one agent adapter is built from. */
export type AgentAdapterBuildInput = {
  adapterData: TargetAdapterData;
  modelParams?: LiteLLMParams;
  nlpServiceUrl: string;
  projectApiKey?: string;
  parameters?: RunParameterValues;
  httpPort?: ScenarioHttp;
  logger?: Logger;
};

/**
 * Builds the adapter that speaks to one agent. A port rather than a direct import of the
 * serialized-adapter registry: a service may not reach into its package's concrete adapters, so the
 * process that holds both supplies the registry.
 */
export interface AgentAdapterFactory {
  build(input: AgentAdapterBuildInput): AgentAdapter;
}

/** Payload broadcast when a queued or running scenario must be cancelled. */
export type CancellationMessage = {
  projectId: string;
  scenarioRunId: string;
  batchRunId?: string;
};

/** Publishes a cancellation signal to the worker fleet. */
export interface CancellationPublisher {
  publish(message: CancellationMessage): Promise<void>;
}

/** Receives cancellation signals sent to the worker fleet. */
export interface CancellationSubscriber {
  subscribe(onCancellation: (message: CancellationMessage) => void): Promise<() => Promise<void>>;
}

export interface ScenarioChildEnvironment {
  labels: string[];
  telemetry: { endpoint: string; apiKey: string };
}

export interface ScenarioChildExecutionSession {
  execute(data: ChildProcessJobData): Promise<ScenarioExecutionResult>;
  abort(): Promise<void>;
}

export interface ScenarioChildBootstrap {
  start(input: {
    jobData: ExecutionJobData;
    environment: ScenarioChildEnvironment;
  }): ScenarioChildExecutionSession;
}

export interface ScenarioClock {
  now(): Instant;
}

/** Complete submission capability used by the Scenario execution service. */
export interface ScenarioExecutionPool {
  submit(input: ScenarioExecutionJob): void;
}

export interface ScenarioExecutionRunner {
  execute(jobData: ExecutionJobData): Promise<void>;

  skipCancelled(jobData: ExecutionJobData): void;
}

/** Response boundary required by serialized HTTP scenario targets. */
export interface ScenarioHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/**
 * Named egress boundary for an HTTP scenario target. The application
 * composition supplies the SSRF-safe implementation; the scenario server
 * never imports an application fetch helper or a native-fetch fallback.
 */
export interface ScenarioHttp {
  fetch(input: {
    url: string;
    init: { method: string; headers: Record<string, string>; body?: string };
  }): Promise<ScenarioHttpResponse>;
}

export interface ScenarioId {
  next(): string;
}

export interface ScenarioTestSuiteId {
  next(): string;
}

export interface ScenarioProcessorServiceMetrics {
  started(): void;

  completed(durationMs: number): void;

  failed(): void;
}

/** Encrypts the opaque secret values that travel with a queued scenario run. */
export interface ScenarioSecretCipher {
  encrypt(plaintext: string): string;

  decrypt(ciphertext: string): string;
}

export interface ScenarioTabStore {
  refresh(input: { key: string; member: string; score: number; ttlSeconds: number }): Promise<void>;

  retire(input: { key: string; member: string; score: number }): Promise<void>;

  countAfter(input: { key: string; cutoff: number }): Promise<number>;

  setPending(input: { key: string; url: string; ttlSeconds: number }): Promise<void>;

  takePending(key: string): Promise<string | null>;
}

/**
 * The scenario feature's application: what all of its doors call.
 *
 * Five tRPC sub-surfaces answer for this feature — CRUD, run reads and the
 * live stream, the simulation runner, cancellation and version history — and
 * they shared a `ScenarioApplication` bag of six services declared in the
 * transport's own context module. That bag was a description of the
 * composition living inside one transport: nothing but a tRPC context could be
 * handed it, so a REST family for the same feature would have had to restate
 * it.
 *
 * Most operations are the services' own, reached through {@link scenarios},
 * {@link simulations}, {@link scenarioExecution}, {@link scenarioTabs},
 * {@link users} and {@link broadcast}. What lives here as a method is what a
 * door would otherwise have to know:
 *
 *   - attributing a write to its caller — four handlers across two doors
 *     stamped it for themselves, under two field names: `lastUpdatedById` on a
 *     create, an update and a duplicate, and `actor: { userId, label: "user" }`
 *     on an update and a version restore;
 *   - which read answers "the runs of a suite" — a single set id reads one
 *     set and files each batch under it, an absent one reads across every
 *     suite and supports a conditional fetch. Two handlers asked that
 *     question;
 *   - the metadata envelope a queued run carries, which decides what the fold
 *     projection may copy into the runs store and, deliberately, what it may
 *     not: the secret VALUES travel beside it, never inside it.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import {
  startScenarioTabPresence,
  type CancelScenarioBatchInput,
  type CancelScenarioRunInput,
  type ResolveScenarioRunParametersInput,
  type ResolvedScenarioRunParameters,
  type RunParameterValues,
  type RunSecretCiphertext,
  type Scenario,
  type ScenarioCreateInput,
  type ScenarioDuplicateInput,
  type ScenarioExecutionPrefetchInput,
  type ScenarioExecutionPrefetchResult,
  type ScenarioExecutionService,
  type ScenarioIdInput,
  type ScenarioMoveInput,
  type ScenarioService,
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
  withNote,
} from "@langwatch/scenario-contract";
import type { UserFullProfile, UserProfilesInput, UserService } from "@langwatch/user-contract";
import type { EventEmitter } from "node:events";

/**
 * The process's per-tenant fan-out, as this feature uses it: one emitter per
 * project that relays the events another pod published. Structural rather than
 * the concrete broadcast service, because the subscription needs nothing else
 * from it.
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
  scenarios: ScenarioService;
  simulations: SimulationService;
  scenarioExecution: ScenarioExecutionService;
  scenarioTabs: ScenarioTabRegistry;
  users: UserService;
  broadcast: ScenarioBroadcast;
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
}

export class ScenarioApp {
  static create(dependencies: ScenarioAppDependencies): ScenarioApp {
    return new ScenarioApp(dependencies);
  }

  private constructor(private readonly dependencies: ScenarioAppDependencies) {}

  /**
   * The author a versioned write is recorded under.
   *
   * One spelling, in one place. Two doors built this literal for themselves —
   * the CRUD update and the version restore — which is two chances for a saved
   * version to name the wrong author or none.
   */
  private authorFor(by: ScenarioCaller): { userId: string; label: "user" } {
    return { userId: by.id, label: "user" };
  }

  // -- the test case itself --------------------------------------------------

  /** Every non-archived scenario in the project. */
  list(input: { projectId: string }): Promise<Scenario[]> {
    return this.dependencies.scenarios.list(input);
  }

  /** How many scenarios the project holds. */
  count(input: { projectId: string }): Promise<number> {
    return this.dependencies.scenarios.count(input);
  }

  /** One scenario, or null when it does not exist or is archived. */
  tryGetById(input: ScenarioIdInput): Promise<Scenario | null> {
    return this.dependencies.scenarios.tryGetById(input);
  }

  /** One scenario, archived ones included. */
  tryGetByIdIncludingArchived(input: ScenarioIdInput): Promise<Scenario | null> {
    return this.dependencies.scenarios.tryGetByIdIncludingArchived(input);
  }

  /**
   * Creates a scenario, attributed to the caller who asked for it.
   *
   * The attribution is here rather than in each door because "who last touched
   * this" is a property of the act, not of the transport it arrived over.
   */
  create(
    input: Omit<ScenarioCreateInput, "lastUpdatedById">,
    by: ScenarioCaller,
  ): Promise<Scenario> {
    return this.dependencies.scenarios.create({ ...input, lastUpdatedById: by.id });
  }

  /**
   * Saves a scenario, attributed to the caller who asked for it.
   *
   * Both fields are stamped: `lastUpdatedById` is who the row says last
   * touched it, and `actor` is who the saved VERSION names as its author.
   */
  update(
    input: Omit<ScenarioUpdateInput, "lastUpdatedById" | "actor">,
    by: ScenarioCaller,
  ): Promise<Scenario> {
    return this.dependencies.scenarios.update({
      ...input,
      lastUpdatedById: by.id,
      actor: this.authorFor(by),
    });
  }

  /** Archives one scenario. */
  archive(input: ScenarioIdInput): Promise<Scenario> {
    return this.dependencies.scenarios.archive(input);
  }

  /** Archives several scenarios, reporting each failure rather than stopping. */
  batchArchive(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ archived: string[]; failed: { id: string; error: string }[] }> {
    return this.dependencies.scenarios.batchArchive(input);
  }

  /** Files one scenario in a folder, or unfiles it when `folderId` is null. */
  moveToFolder(input: ScenarioMoveInput): Promise<Scenario> {
    return this.dependencies.scenarios.moveToFolder(input);
  }

  /** Copies a scenario, attributed to the caller who asked for it. */
  duplicate(
    input: Omit<ScenarioDuplicateInput, "lastUpdatedById">,
    by: ScenarioCaller,
  ): Promise<Scenario> {
    return this.dependencies.scenarios.duplicate({ ...input, lastUpdatedById: by.id });
  }

  // -- version history -------------------------------------------------------

  /** One page of a scenario's saved versions. */
  listVersions(input: ScenarioVersionListInput): Promise<{
    versions: ScenarioVersionSummary[];
    nextCursor: number | null;
  }> {
    return this.dependencies.scenarios.listVersions(input);
  }

  /** One saved version in full. */
  getVersion(input: ScenarioVersionInput): Promise<ScenarioVersionDetail> {
    return this.dependencies.scenarios.getVersion(input);
  }

  /** Makes a saved version current again, attributed to its caller. */
  restoreVersion(
    input: Omit<ScenarioVersionRestoreInput, "actor">,
    by: ScenarioCaller,
  ): Promise<Scenario> {
    return this.dependencies.scenarios.restoreVersion({
      ...input,
      actor: this.authorFor(by),
    });
  }

  /**
   * The profiles behind a set of author ids.
   *
   * The version history stores only the id of whoever saved each version; the
   * name a person reads is resolved from it.
   */
  getUserProfiles(input: UserProfilesInput): Promise<UserFullProfile[]> {
    return this.dependencies.users.getProfiles(input);
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
    return this.dependencies.scenarios.resolveRunParameters(input);
  }

  /** Validates a run against its target before anything is queued. */
  prefetchExecution(
    input: ScenarioExecutionPrefetchInput,
  ): Promise<ScenarioExecutionPrefetchResult> {
    return this.dependencies.scenarioExecution.prefetch(input);
  }

  /**
   * Dispatches the queued command, which is what writes QUEUED state before
   * the execution job is scheduled — the same order the suite execution port
   * uses. The resolved parameters travel on the metadata, which is the only
   * channel that carries them into execution.
   *
   * The secret VALUES travel beside the metadata rather than inside it, so the
   * fold projection cannot copy them into the runs store. Only their names go
   * on the metadata. That is the rule this method exists to hold: it is a fact
   * about what a stored run may contain, and a transport that assembled the
   * envelope itself would be the thing deciding it.
   */
  queueSimulationRun(input: QueueSimulationRunInput): Promise<void> {
    const secretParameterNames = Object.keys(input.secretParameters);
    const metadata = {
      // The reserved namespace records the target this run was pointed at and
      // the scenario version it was queued from, the same way a suite run does.
      langwatch: {
        targetReferenceId: input.target.referenceId,
        targetType: input.target.type,
        ...(input.scenarioVersion !== undefined
          ? { scenarioVersion: input.scenarioVersion }
          : {}),
      },
      ...withNote(input.note),
      ...(Object.keys(input.parameters).length > 0 ? { parameters: input.parameters } : {}),
      ...(secretParameterNames.length > 0 ? { secretParameterNames } : {}),
    };

    return this.dependencies.simulations.queueRun({
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
    return this.dependencies.scenarios.cancelJob(input);
  }

  /** Cancels every job in one batch run. */
  cancelBatchRun(
    input: CancelScenarioBatchInput,
  ): Promise<{ cancelledCount: number; skippedCount: number }> {
    return this.dependencies.scenarios.cancelBatchRun(input);
  }

  // -- reading what ran ------------------------------------------------------

  /**
   * The runs of one suite, or of every suite when no set is named.
   *
   * Which read answers is a domain question, not a paging one: a named set
   * reads that set and files each batch under it, and an absent one reads
   * across every suite and honours a conditional fetch. Two handlers asked it,
   * so it is answered once.
   *
   * The answer keeps the cross-suite read's own discriminated shape, so a
   * caller still has to look at `changed` before reaching for `runs`. Widening
   * it to one flat object here would hand every client an unconditional `runs`
   * that is absent whenever nothing moved.
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
      const data = await this.dependencies.simulations.getRunDataForScenarioSet({
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
    return this.dependencies.simulations.getRunDataForAllSuites({
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
    return this.dependencies.simulations.getScenarioSetsData(input);
  }

  /** The latest run result per test case inside the window. */
  getLastResultSummaries(
    input: SimulationLastResultSummariesInput,
  ): Promise<SimulationLastResultSummary[]> {
    return this.dependencies.simulations.getLastResultSummaries(input);
  }

  /** The latest update across the project's runs — a cheap freshness probe. */
  getLastUpdatedAt(input: SimulationLastUpdatedInput): Promise<number> {
    return this.dependencies.simulations.getLastUpdatedAt(input);
  }

  /** One page of one suite's runs. */
  getRunDataForScenarioSet(
    input: SimulationScenarioSetRunsInput,
  ): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }> {
    return this.dependencies.simulations.getRunDataForScenarioSet(input);
  }

  /** One run by its id. No date window, so old runs stay reachable. */
  tryGetScenarioRunData(input: SimulationScenarioRunInput): Promise<SimulationRunData | null> {
    return this.dependencies.simulations.tryGetScenarioRunData(input);
  }

  /** How many batch runs one suite has, for its pagination. */
  getBatchRunCountForScenarioSet(input: SimulationExternalSetCountInput): Promise<number> {
    return this.dependencies.simulations.getBatchRunCountForScenarioSet(input);
  }

  /** The pre-aggregated batch history one suite's sidebar renders. */
  getBatchHistoryForScenarioSet(
    input: SimulationBatchHistoryInput,
  ): Promise<SimulationBatchHistory> {
    return this.dependencies.simulations.getBatchHistoryForScenarioSet(input);
  }

  /** One batch run's runs. No date window, so old batches open directly. */
  getRunDataForBatchRun(input: SimulationBatchRunInput): Promise<SimulationBatchRunData> {
    return this.dependencies.simulations.getRunDataForBatchRun(input);
  }

  /** Summaries for the suites the SDK and CI report into. */
  getExternalSetSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]> {
    return this.dependencies.simulations.getExternalSetSummaries(input);
  }

  /** Runs across every suite, one page at a time. */
  getRunDataForAllSuites(input: SimulationAllSuitesInput): Promise<SimulationAllSuitesRunData> {
    return this.dependencies.simulations.getRunDataForAllSuites(input);
  }

  // -- the live stream -------------------------------------------------------

  /** The project's fan-out emitter, relaying what another pod published. */
  tenantEmitter(projectId: string): EventEmitter {
    return this.dependencies.broadcast.getTenantEmitter(projectId);
  }

  /**
   * Registers a browser tab as present, and claims any navigate parked for it.
   *
   * Presence is refreshed from the server rather than the browser, so the
   * registry is the application's rather than a transport's: a background
   * tab's timers get throttled to once a minute, which would expire presence
   * on exactly the tab this exists to reuse.
   */
  startTabPresence(registration: ScenarioTabRegistration): Promise<ScenarioTabPresence> {
    return startScenarioTabPresence({
      registration,
      registry: this.dependencies.scenarioTabs,
    });
  }
}

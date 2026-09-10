import { moduleApi } from "@langwatch/runtime-composition";
import type { Dataset } from "@langwatch/dataset-contract";
import type { ModelCostRate } from "@langwatch/model-provider-contract";
import type { StudioWorkflow, WorkflowWithVersion } from "@langwatch/workflow-contract";
import type {
  ExperimentPublishedMonitor,
  ExperimentUpdateFrame,
} from "./experiment.responses.ts";
import type { ExperimentRunLookupInput } from "./experiment.rest.ts";
import type { DSPyRunsSummary } from "./experiment-legacy.ts";
import type {
  Experiment,
  ExperimentLookup,
  ExperimentPage,
  ExperimentPageInput,
  ExperimentSlugLookup,
  ExperimentType,
  FindOrCreateWorkflowExperimentInput,
  SaveExperimentInput,
} from "./experiment.ts";
import type {
  CompleteExperimentRunInput,
  ExperimentRun,
  ExperimentRunAggregate,
  ExperimentRunListInput,
  ExperimentRunLookup,
  ExperimentRunPageInput,
  ExperimentRunSlugPageInput,
  ExperimentRunWithItems,
  RecordEvaluatorResultInput,
  RecordTargetResultInput,
  StartExperimentRunInput,
} from "./experiment-run.ts";
import type {
  ExperimentDspyStep,
  ExperimentDspyStepLookup,
  ExperimentDspyStepSummary,
  ExperimentDspyStepsLookup,
} from "./experiment-dspy.ts";
import type {
  CommitWorkbenchVersionInput,
  CreateEvaluationsV3Input,
  GetWorkbenchStateInput,
  ListWorkbenchVersionsInput,
  RecordWorkbenchRunResultsInput,
  RestoreWorkbenchVersionInput,
  SaveWorkbenchStateInput,
  WorkbenchSaveResult,
  WorkbenchStateView,
  WorkbenchVersionsPage,
} from "./experiment-workbench-version.ts";

/**
 * The credential a workbench write arrived on, as the attribution rule reads
 * it: its class, the member it acts as, and whether it is an agent's session
 * key. Named structurally so the rule stays free of the door it came through.
 */
export type WorkbenchCredential =
  | Readonly<{ kind: "apiKey"; userId: string | null; isLangySessionKey?: boolean }>
  | Readonly<{ kind: "legacyProjectKey" }>;

/**
 * Who a workbench write is attributed to, in the one vocabulary both doors
 * speak: a signed-in person at the browser, or the credential itself.
 */
export type ExperimentCaller =
  | Readonly<{ kind: "user"; id: string }>
  | Readonly<{ kind: "credential"; credential: WorkbenchCredential | null | undefined }>;

/** One experiment with the run history the list and read surfaces show beside it. */
export type ExperimentWithRuns = Readonly<{
  experiment: Experiment;
  runsCount: number;
  lastRunAt: number | null;
}>;

/** One workflow version, as the wizard's save and its copy write one. */
export type ExperimentWorkflowVersionInput = Readonly<{
  projectId: string;
  workflowId: string;
  dsl: StudioWorkflow;
  autoSaved: boolean;
  commitMessage: string;
  setAsLatestVersion?: boolean;
}>;

/** A workflow copied into another project, with the graph that landed there. */
export type ExperimentWorkflowCopyInput = Readonly<{
  workflow: Readonly<{
    id: string;
    name: string;
    icon: string | null;
    description: string | null;
    isEvaluator?: boolean;
    isComponent?: boolean;
    latestVersion: Readonly<{ dsl: unknown }> | null;
  }>;
  targetProjectId: string;
  sourceProjectId: string;
  copyDatasets?: boolean;
  copiedFromWorkflowId?: string;
}>;

/**
 * Callable capability exposed by the composed Experiment application.
 *
 * This is the former `ExperimentService` contract-service, folded in here per
 * ADR-133: a contract package names only its callable API, never a standalone
 * abstract service class. Four workbench writes stay App-only
 * (`saveWorkbenchState`, `createEvaluationsV3`, `commitWorkbenchVersion`,
 * `restoreWorkbenchVersion`) because the App reshapes their input to take the
 * caller as a separate argument rather than an `actor` field; that reshaping
 * is server-private, not part of the portable token.
 */
export interface ExperimentApi {
  getById(input: ExperimentLookup): Promise<Experiment>;
  getBySlug(input: ExperimentSlugLookup): Promise<Experiment>;
  getBySlugOrId(input: { projectId: string; slugOrId: string }): Promise<Experiment>;
  findById(input: ExperimentLookup): Promise<Experiment | null>;
  findBySlug(input: ExperimentSlugLookup): Promise<Experiment | null>;
  findBySlugAndType(
    input: ExperimentSlugLookup & { type: ExperimentType },
  ): Promise<Experiment | null>;
  list(input: { projectId: string }): Promise<Experiment[]>;
  getPage(input: ExperimentPageInput): Promise<ExperimentPage>;
  findLatest(input: { projectId: string }): Promise<Experiment | null>;
  findIdBySlug(input: ExperimentSlugLookup): Promise<{ id: string; slug: string } | null>;
  isActive(input: ExperimentLookup): Promise<boolean>;
  save(input: SaveExperimentInput): Promise<Experiment>;
  findOrCreateForWorkflow(
    input: FindOrCreateWorkflowExperimentInput,
  ): Promise<{ id: string; slug: string }>;
  findNextDraftName(input: { projectId: string }): Promise<string>;
  /**
   * The experiment an SDK's own identifier names, created if it is free. The
   * one rule the create-or-take door and the batch result log both resolve a
   * slug through, so repeated runs under one slug group together.
   */
  findOrCreateForRun(input: ExperimentRunLookupInput): Promise<Experiment>;
  archive(input: ExperimentLookup): Promise<{ success: true }>;
  listRuns(input: ExperimentRunListInput): Promise<Record<string, ExperimentRun[]>>;
  getRunAggregates(input: ExperimentRunListInput): Promise<Record<string, ExperimentRunAggregate>>;
  getRunsPage(input: ExperimentRunPageInput): Promise<{ runs: ExperimentRun[]; totalHits: number }>;
  /** A polling read: absent rows and disabled ClickHouse both read as null. */
  findRun(input: ExperimentRunLookup): Promise<ExperimentRunWithItems | null>;
  getRunsPageBySlug(input: ExperimentRunSlugPageInput): Promise<{
    experiment: { id: string; slug: string };
    runs: ExperimentRun[];
    totalHits: number;
  }>;
  startExperimentRun(input: StartExperimentRunInput): Promise<void>;
  recordTargetResult(input: RecordTargetResultInput): Promise<void>;
  recordEvaluatorResult(input: RecordEvaluatorResultInput): Promise<void>;
  completeExperimentRun(input: CompleteExperimentRunInput): Promise<void>;
  upsertDspyStep(input: ExperimentDspyStep): Promise<void>;
  listDspySteps(input: ExperimentDspyStepsLookup): Promise<ExperimentDspyStepSummary[]>;
  listDspyRuns(input: ExperimentDspyStepsLookup): Promise<DSPyRunsSummary[]>;
  getDspyStep(input: ExperimentDspyStepLookup): Promise<ExperimentDspyStep>;
  getWorkbenchState(input: GetWorkbenchStateInput): Promise<WorkbenchStateView>;
  listWorkbenchVersions(input: ListWorkbenchVersionsInput): Promise<WorkbenchVersionsPage>;
  recordWorkbenchRunResults(input: RecordWorkbenchRunResultsInput): Promise<WorkbenchSaveResult>;

  // ── Workbench writes, attributed to the caller who asked for them ──
  // Each takes the caller as a separate argument rather than an `actor` field,
  // so no door decides how a credential becomes an attribution.

  saveWorkbenchState(
    input: Omit<SaveWorkbenchStateInput, "actor">,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult>;
  createEvaluationsV3(
    input: Omit<CreateEvaluationsV3Input, "actor" | "state"> &
      Readonly<{ state?: CreateEvaluationsV3Input["state"] }>,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult>;
  commitWorkbenchVersion(
    input: Omit<CommitWorkbenchVersionInput, "actor">,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult>;
  restoreWorkbenchVersion(
    input: Omit<RestoreWorkbenchVersionInput, "actor">,
    by: ExperimentCaller,
  ): Promise<WorkbenchSaveResult>;

  // ── What a listing shows beside each experiment ───────────────────

  withRunAggregates(
    input: Readonly<{ projectId: string; experiments: readonly Experiment[] }>,
  ): Promise<ExperimentWithRuns[]>;

  // ── The other verticals an experiment reaches through this api ─────

  /** The workflow behind an experiment, or null when it is gone. */
  findWorkflow(
    input: Readonly<{ id: string; projectId: string; includeVersion?: boolean }>,
  ): Promise<WorkflowWithVersion | null>;
  /** Creates the workflow a new wizard experiment writes its versions into. */
  createWorkflow(
    input: Readonly<{
      projectId: string;
      name: string;
      icon?: string | null;
      description?: string | null;
    }>,
  ): Promise<Readonly<{ id: string }>>;
  saveWorkflowVersion(input: ExperimentWorkflowVersionInput): Promise<void>;
  copyWorkflowWithDatasets(
    input: ExperimentWorkflowCopyInput,
  ): Promise<Readonly<{ workflowId: string; dsl: StudioWorkflow }>>;
  /** Creates or replaces the monitor an experiment is published as. */
  publishAsMonitor(
    input: Readonly<{
      projectId: string;
      experimentId: string;
      monitor: Readonly<{
        name: string;
        checkType: string;
        slug: string;
        preconditions: unknown;
        parameters: Record<string, unknown>;
        /** The wizard's stored mappings, canonicalised by the monitor side. */
        mappings: unknown;
        sample: number;
        enabled: boolean;
        executionMode: string;
      }>;
    }>,
  ): Promise<ExperimentPublishedMonitor>;
  getDatasets(input: Readonly<{ projectId: string; datasetIds: string[] }>): Promise<Dataset[]>;
  renameDataset(
    input: Readonly<{ datasetId: string; projectId: string; name: string }>,
  ): Promise<Dataset>;
  copyDataset(
    input: Readonly<{
      sourceDatasetId: string;
      sourceProjectId: string;
      targetProjectId: string;
    }>,
  ): Promise<Dataset>;

  // ── What the doors ask about the caller and the deployment ─────────

  /** The slug this deployment derives from a name, shared with every resource. */
  slugFor(value: string): string;
  /**
   * Whether the caller may manage evaluations in a project the declared check
   * never covered. `copy` reads a SECOND project - the source - so it is
   * probed before anything is read from it.
   */
  mayManageEvaluations(
    input: Readonly<{ actorId: string; projectId: string }>,
  ): Promise<boolean>;
  /**
   * The project's own model cost rules, in the shape the pricing cascade
   * reads. The optimizer log prices every call it stores against them.
   */
  listModelCosts(input: Readonly<{ projectId: string }>): Promise<readonly ModelCostRate[]>;
  /** The display names behind the author ids on a version history. */
  resolveAuthorNames(
    authorIds: readonly string[],
  ): Promise<ReadonlyArray<Readonly<{ id: string; name: string | null }>>>;

  // ── The project's live-update channel ──────────────────────────────

  /**
   * The freshness signals a workbench save lands on, for as long as the caller
   * listens. A stream rather than the fan-out itself: pairing the subscribe
   * with the release is the application's, and a door that held the emitter
   * could forget the release and leak one per abandoned tab.
   */
  watchUpdates(
    input: Readonly<{ projectId: string; signal?: AbortSignal | undefined }>,
  ): AsyncIterable<ExperimentUpdateFrame>;
}

export const ExperimentApi = moduleApi<ExperimentApi>("experiment");

import { featureApi } from "@langwatch/runtime-composition";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { Evaluator } from "@langwatch/evaluator-contract";
import type {
  ArchiveWorkflowCommand,
  CopyWorkflowCommand,
  CreateWorkflowCommand,
  PublishWorkflowCommand,
  RunWorkflowCommand,
  UpdateWorkflowCommand,
} from "./workflow.commands.ts";
import type { StudioClientEvent, StudioServerEvent } from "./studio-events.ts";
import type { ExecutionState, Field, StudioWorkflow } from "./studio-workflow.ts";
import type { ExecuteWorkflowComponentInput } from "./workflow-component.commands.ts";
import type {
  Workflow,
  WorkflowRunAnswer,
  WorkflowVersion,
  WorkflowVersionHistoryEntry,
  WorkflowVersionHistoryMode,
  WorkflowWithVersion,
} from "./workflow.ts";
import type {
  WorkflowCascadeArchive,
  WorkflowListRow,
  WorkflowProjectPath,
  WorkflowRelatedEntities,
} from "./workflow.trpc-schemas.ts";

export type WorkflowMappingFields = {
  inputFields: Field[];
  outputFields: Field[];
  fieldsResolved: boolean;
};

export type WorkflowReference = { workflowId: string; projectId: string };

/** Who a write is attributed to. */
export type WorkflowCaller = Readonly<{ id: string }>;

/** The workflow being copied, as the row its caller already read carries it. */
export type WorkflowStudioCopySource = {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  isEvaluator?: boolean;
  isComponent?: boolean;
  latestVersion: { dsl: unknown } | null;
};

/** Copying a Studio graph into another project, without its first version. */
export type CopyStudioWorkflowCommand = {
  workflow: WorkflowStudioCopySource;
  sourceProjectId: string;
  targetProjectId: string;
  copyDatasets?: boolean;
  copiedFromWorkflowId?: string;
};

/**
 * One stored version, as the copy-lineage reads carry it. `dsl` is `unknown`:
 * it comes out of a JSON column and is re-parsed before it is touched, so
 * typing it as a graph here would assert a shape nothing has checked.
 */
export type WorkflowVersionRow = Readonly<{ version: string; dsl: unknown }>;

/** A workflow row plus the latest-version pointer the copy flows read off it. */
export type WorkflowRowWithLatestVersion = Workflow & {
  latestVersion: WorkflowVersionRow | null;
};

/** The row a sync reads: the copy, and the workflow it was copied from. */
export type WorkflowSourceRow = WorkflowRowWithLatestVersion & {
  copiedFrom: WorkflowRowWithLatestVersion | null;
};

/** The row a push reads: the source, and every non-archived copy of it. */
export type WorkflowCopiesRow = WorkflowRowWithLatestVersion & {
  copiedWorkflows: readonly (Workflow & { latestVersion: WorkflowVersionRow | null })[];
};

/** One copy of a workflow, with enough lineage to render where it lives. */
export type WorkflowCopyWithPath = Readonly<{
  id: string;
  name: string;
  projectId: string;
  project: WorkflowProjectPath;
}>;

/** A listed workflow with its copy lineage in both directions, unredacted. */
export type WorkflowLineageRow = Readonly<{
  id: string;
  projectId: string;
  name: string;
  icon: string | null;
  description: string | null;
  createdAt: Workflow["createdAt"];
  updatedAt: Workflow["updatedAt"];
  latestVersionId: string | null;
  currentVersionId: string | null;
  publishedId: string | null;
  publishedById: string | null;
  archivedAt: Workflow["archivedAt"];
  isEvaluator: boolean;
  isComponent: boolean;
  copiedFromWorkflowId: string | null;
  copiedFrom: WorkflowCopyWithPath | null;
  copiedWorkflows: readonly Readonly<{ projectId: string }>[];
}>;

/** The publication flags the Optimization Studio reads and writes. */
export type WorkflowPublicationFlags = Readonly<{
  id: string;
  name: string;
  publishedId: string | null;
  isComponent: boolean;
  isEvaluator: boolean;
}>;

/** What one started evaluation run answers with. */
export type WorkflowEvaluationStarted = Readonly<{
  runId: string;
  runUrl: string;
  workflowVersionId: string;
  version: string;
}>;

/** What starting one evaluation run of a committed version is asked for. */
export type WorkflowEvaluationRequest = Readonly<{
  projectId: string;
  projectSlug: string;
  workflowId: string;
  versionId?: string | undefined;
  data?: Record<string, unknown>[] | undefined;
  datasetId?: string | undefined;
  parameters?: Record<string, string | number | boolean> | undefined;
  rowIndices?: number[] | undefined;
}>;

/** Callable capability exposed by the composed Workflow application. */
export interface WorkflowApi {
  // -- the workflow itself ---------------------------------------------------

  executeComponent(input: ExecuteWorkflowComponentInput): Promise<ExecutionState>;
  list(input: { projectId: string }): Promise<Workflow[]>;
  getById(input: {
    id: string;
    projectId: string;
    includeVersion?: boolean;
  }): Promise<WorkflowWithVersion>;
  assertInProject(input: { workflowId: string; projectId: string }): Promise<void>;
  listFields(input: {
    projectId: string;
    workflowIds: string[];
  }): Promise<Record<string, WorkflowMappingFields>>;
  listSummaries(input: {
    projectId: string;
    workflowIds: string[];
  }): Promise<{ id: string; name: string }[]>;
  archiveLinked(input: WorkflowReference): Promise<{ id: string }>;
  deleteUncommitted(input: WorkflowReference): Promise<void>;
  create(
    input: Omit<CreateWorkflowCommand, "authorId">,
    by: WorkflowCaller,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }>;
  copy(
    input: Omit<CopyWorkflowCommand, "authorId">,
    by: WorkflowCaller,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }>;
  update(input: UpdateWorkflowCommand): Promise<Workflow>;
  getVersionHistory(input: {
    workflowId: string;
    projectId: string;
    mode: WorkflowVersionHistoryMode;
  }): Promise<WorkflowVersionHistoryEntry[]>;
  restoreVersion(input: { versionId: string; projectId: string }): Promise<WorkflowVersion>;
  publish(input: Omit<PublishWorkflowCommand, "actorId">, by: WorkflowCaller): Promise<Workflow>;
  unpublish(input: { id: string; projectId: string }): Promise<Workflow>;
  archive(input: ArchiveWorkflowCommand): Promise<Workflow>;
  /** Runs a workflow synchronously, on the published version unless one is named. */
  run(input: RunWorkflowCommand): Promise<WorkflowRunAnswer>;
  /** Starts one evaluation run of a committed version through the evaluations pipeline. */
  triggerEvaluation(input: WorkflowEvaluationRequest): Promise<WorkflowEvaluationStarted>;

  // -- the Studio's own graph ------------------------------------------------

  prepareStudioEvent(input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent>;
  prepareStudioDsl(input: { projectId: string; dsl: StudioWorkflow }): Promise<StudioWorkflow>;
  saveStudioVersion(
    input: {
      projectId: string;
      workflowId: string;
      dsl: StudioWorkflow;
      autoSaved: boolean;
      commitMessage: string;
      setAsLatestVersion?: boolean;
    },
    by: WorkflowCaller,
  ): Promise<WorkflowVersion>;
  copyStudioWorkflow(
    input: CopyStudioWorkflowCommand,
  ): Promise<{ workflowId: string; dsl: StudioWorkflow }>;
  /** One Monaco completion for the editor, over whichever model answers it. */
  completeCode(input: { projectId: string; body: unknown }): Promise<unknown>;
  /** Opens one studio run and streams the engine's events back through `onEvent`. */
  postStudioEvent(input: {
    projectId: string;
    event: StudioClientEvent;
    onEvent: (event: StudioServerEvent) => void;
  }): Promise<void>;
  /** Where an unexpected studio failure is reported. Best effort. */
  reportStudioFailure(error: unknown, context: { projectId: string }): void;
  /** A short commit message for the change between two graphs. */
  generateCommitMessage(input: {
    projectId: string;
    prevDsl: StudioWorkflow;
    newDsl: StudioWorkflow;
  }): Promise<string>;

  // -- the evaluator a published workflow is wrapped in ----------------------

  listEvaluators(input: { projectId: string }): Promise<Evaluator[]>;
  linkEvaluatorToWorkflow(input: {
    workflowId: string;
    projectId: string;
    name: string;
  }): Promise<Evaluator>;
  unlinkEvaluatorFromWorkflow(input: {
    workflowId: string;
    projectId: string;
  }): Promise<void>;

  // -- what the caller may see in a project other than the scoped one -------

  hasProjectPermission(input: {
    userId: string;
    projectId: string;
    permission: AuthzPermission;
  }): Promise<boolean>;

  // -- copy lineage, related entities and the archive cascade ---------------

  /** The project's workflows, lineage redacted to what this caller may see. */
  listWithCopyLineage(input: {
    projectId: string;
    viewerUserId: string;
  }): Promise<WorkflowListRow[]>;
  findWorkflowOwner(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Readonly<{ projectId: string }> | null>;
  findCopiesWithPath(input: {
    workflowId: string;
    projectId: string;
  }): Promise<readonly WorkflowCopyWithPath[] | null>;
  findWorkflowWithSource(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowSourceRow | null>;
  findWorkflowWithCopies(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowCopiesRow | null>;
  findLatestVersionNumber(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Readonly<{ version: string | null }> | null>;
  /** What archiving this workflow would take with it. */
  getRelatedEntities(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowRelatedEntities>;
  cascadeArchive(input: {
    projectId: string;
    workflowId: string;
    unarchive?: boolean;
  }): Promise<WorkflowCascadeArchive>;

  // -- the Optimization Studio's publication flags --------------------------

  runPublished(input: {
    workflowId: string;
    projectId: string;
    body: Readonly<Record<string, unknown>>;
  }): Promise<WorkflowRunAnswer>;
  findWorkflowFlags(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowPublicationFlags | null>;
  /** One stored version by id, as the process's own read carries it. */
  findWorkflowVersionById(input: {
    versionId: string;
    projectId: string;
  }): Promise<Readonly<Record<string, unknown>> | null>;
  setWorkflowFlags(input: {
    workflowId: string;
    projectId: string;
    isComponent?: boolean;
    isEvaluator?: boolean;
  }): Promise<void>;
  listPublishedComponents(input: { projectId: string }): Promise<unknown>;
}

export const WorkflowApi = featureApi<WorkflowApi>("workflow");

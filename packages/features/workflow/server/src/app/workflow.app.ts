/**
 * The workflow feature's application: what both of its doors call.
 *
 * Two tRPC doors answer for this feature — `workflow.*` and the optimization
 * studio's `optimization.*` — and before this each declared its own private
 * bag: `Readonly<{ workflows: WorkflowService; evaluators: EvaluatorService }>`
 * in one, `Readonly<{ evaluators: EvaluatorService }>` in the other. Two
 * descriptions of the same composition, agreeing by attention rather than by
 * construction, and neither reachable from the other.
 *
 * Most operations are the services' own, reached through {@link workflows} and
 * {@link evaluators}. What lives here as a method is what a door would
 * otherwise have to know:
 *
 *   - attributing a write to its caller — three handlers stamped it for
 *     themselves, under two different field names;
 *   - the evaluator that wraps a workflow published as one, which both
 *     `toggleSaveAsEvaluator` and `disableAsEvaluator` decided for themselves.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import type { DatasetService } from "@langwatch/dataset-contract";
import type { Evaluator, EvaluatorService } from "@langwatch/evaluator-contract";
import type {
  ArchiveWorkflowCommand,
  CopyWorkflowCommand,
  CreateWorkflowCommand,
  PublishWorkflowCommand,
  StudioClientEvent,
  StudioWorkflow,
  Workflow,
  WorkflowService,
  WorkflowVersion,
  WorkflowVersionHistoryEntry,
  WorkflowVersionHistoryMode,
  WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import { nanoid } from "nanoid";
import type {
  WorkflowAgentMappingPort,
  WorkflowRowPort,
  WorkflowStudioDslPort,
} from "../ports/workflow.port";
import {
  WorkflowStudioCopyService,
  type CopyStudioWorkflowInput,
} from "../services/workflow-studio-copy.service";
import { WorkflowStudioVersionService } from "../services/workflow-studio-version.service";

/** Who a write is attributed to. */
export interface WorkflowCaller {
  readonly id: string;
}

/** What the process composes this feature's application from. */
export interface WorkflowAppDependencies {
  workflows: WorkflowService;
  evaluators: EvaluatorService;
  /** The dataset copies a Studio graph carries with it into another project. */
  datasets: DatasetService;
  /** How a Studio graph is prepared before any version of it is written. */
  studioDsl: WorkflowStudioDslPort;
  /** The agent mappings a saved Studio graph refreshes, best effort. */
  agentMappings: WorkflowAgentMappingPort;
  /** The bare row a Studio copy lands in, before its first version exists. */
  workflowRows: WorkflowRowPort;
}

export class WorkflowApp {
  static create(dependencies: WorkflowAppDependencies): WorkflowApp {
    return new WorkflowApp(dependencies);
  }

  private constructor(private readonly dependencies: WorkflowAppDependencies) {
    this.studioVersions = WorkflowStudioVersionService.create({
      workflows: dependencies.workflows,
      studioDsl: dependencies.studioDsl,
      agentMappings: dependencies.agentMappings,
    });
    this.studioCopies = WorkflowStudioCopyService.create({
      datasets: dependencies.datasets,
      rows: dependencies.workflowRows,
    });
  }

  private readonly studioVersions: WorkflowStudioVersionService;
  private readonly studioCopies: WorkflowStudioCopyService;

  // -- the workflow itself ---------------------------------------------------

  /** Every non-archived workflow in the project. */
  list(input: { projectId: string }): Promise<Workflow[]> {
    return this.dependencies.workflows.list(input);
  }

  /** One workflow, optionally with its current version. */
  getById(input: {
    id: string;
    projectId: string;
    includeVersion?: boolean;
  }): Promise<WorkflowWithVersion> {
    return this.dependencies.workflows.getById(input);
  }

  /**
   * One studio event, resolved against the project it will run in: its
   * environment, its LiteLLM parameters and the datasets it names.
   *
   * Every studio execution goes through this — the studio's own HTTP route,
   * the prompt playground's CopilotKit adapter and the experiment
   * orchestrator — and each of them holds this application rather than the
   * service. Resolving a run's credentials and data is the workflow feature's
   * own decision, not something a transport should assemble for itself.
   */
  prepareStudioEvent(input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent> {
    return this.dependencies.workflows.prepareStudioEvent(input);
  }

  /**
   * Creates a workflow and its first version, attributed to the caller who
   * asked for it.
   *
   * The attribution is here rather than in each door because "who wrote this
   * version" is a property of the act, not of the transport it arrived over,
   * and the two field names the service takes for it — `authorId` on a create
   * or a copy, `actorId` on a publish — are exactly the kind of detail a
   * second copy of the rule gets wrong.
   */
  create(
    input: Omit<CreateWorkflowCommand, "authorId">,
    by: WorkflowCaller,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }> {
    return this.dependencies.workflows.create({ ...input, authorId: by.id });
  }

  /** Copies a workflow into another project, attributed to its caller. */
  copy(
    input: Omit<CopyWorkflowCommand, "authorId">,
    by: WorkflowCaller,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }> {
    return this.dependencies.workflows.copy({ ...input, authorId: by.id });
  }

  /** The version history of one workflow. */
  getVersionHistory(input: {
    workflowId: string;
    projectId: string;
    mode: WorkflowVersionHistoryMode;
  }): Promise<WorkflowVersionHistoryEntry[]> {
    return this.dependencies.workflows.getVersionHistory(input);
  }

  /** Makes a stored version current again. */
  restoreVersion(input: { versionId: string; projectId: string }): Promise<WorkflowVersion> {
    return this.dependencies.workflows.restoreVersion(input);
  }

  /** Publishes one version, attributed to the caller who asked for it. */
  publish(input: Omit<PublishWorkflowCommand, "actorId">, by: WorkflowCaller): Promise<Workflow> {
    return this.dependencies.workflows.publish({ ...input, actorId: by.id });
  }

  /** Withdraws the published version. */
  unpublish(input: { id: string; projectId: string }): Promise<Workflow> {
    return this.dependencies.workflows.unpublish(input);
  }

  /** Archives one workflow, or restores it when `unarchive` is set. */
  archive(input: ArchiveWorkflowCommand): Promise<Workflow> {
    return this.dependencies.workflows.archive(input);
  }

  // -- the Studio's own save and copy ----------------------------------------

  /**
   * Prepares a Studio graph the way saving one does, without writing anything.
   *
   * The studio asks for this before it dispatches a run, so what executes is
   * the same graph a save would have persisted.
   */
  prepareStudioDsl(input: { projectId: string; dsl: StudioWorkflow }): Promise<StudioWorkflow> {
    return this.studioVersions.prepareDsl(input);
  }

  /**
   * Writes a Studio graph as a version, attributed to the caller who asked for
   * it, and refreshes the agent mappings the new graph implies.
   */
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
  ): Promise<WorkflowVersion> {
    return this.studioVersions.saveOrCommit({ ...input, authorId: by.id });
  }

  /**
   * Copies a workflow into another project and answers the new row's id with
   * the graph rewritten to belong to it. The caller commits its first version.
   */
  copyStudioWorkflow(
    input: CopyStudioWorkflowInput,
  ): Promise<{ workflowId: string; dsl: StudioWorkflow }> {
    return this.studioCopies.copyWithDatasets(input);
  }

  /**
   * The service itself, for the process functions that still take it directly.
   *
   * One does, and it is not a workflow door: the trace evaluation runner
   * (`server/evaluations/runEvaluation.ts`) takes a `WorkflowService` as one of
   * six collaborators. It lives beside the transports in the application being
   * retired; until it moves, this getter is the seam that remains — the same one
   * `EvaluatorApp.evaluatorService` keeps.
   */
  get workflowService(): WorkflowService {
    return this.dependencies.workflows;
  }

  // -- the evaluator a published workflow is wrapped in -----------------------

  /** Every evaluator in the project. */
  listEvaluators(input: { projectId: string }): Promise<Evaluator[]> {
    return this.dependencies.evaluators.getAll(input);
  }

  /**
   * Makes the project's evaluator for this workflow exist and carry its name.
   *
   * Create-or-rename rather than create: a workflow republished after a rename
   * must not leave the evaluator picker showing the old name, and a second
   * evaluator for the same workflow would be two rows the picker cannot tell
   * apart.
   */
  async linkEvaluatorToWorkflow(input: {
    workflowId: string;
    projectId: string;
    name: string;
  }): Promise<Evaluator> {
    const { workflowId, projectId, name } = input;
    const existing = await this.dependencies.evaluators.tryGetByWorkflow({
      workflowId,
      projectId,
    });

    if (existing) {
      return this.dependencies.evaluators.update({
        id: existing.id,
        projectId,
        data: { name },
      });
    }

    return this.dependencies.evaluators.create({
      id: `evaluator_${nanoid()}`,
      projectId,
      name,
      type: "workflow",
      config: {},
      workflowId,
    });
  }

  /**
   * Archives the evaluator this workflow was published as, if there is one.
   *
   * Nothing may keep an evaluator pointing at a workflow that no longer offers
   * itself as one. A workflow that was never published as an evaluator has
   * nothing to archive, which is a no-op rather than a refusal.
   */
  async unlinkEvaluatorFromWorkflow(input: {
    workflowId: string;
    projectId: string;
  }): Promise<void> {
    const linked = await this.dependencies.evaluators.tryGetByWorkflow(input);
    if (!linked) return;

    await this.dependencies.evaluators.archive({
      id: linked.id,
      projectId: input.projectId,
    });
  }
}

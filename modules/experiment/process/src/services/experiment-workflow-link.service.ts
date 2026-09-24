/**
 * The legacy wizard's experiment and the workflow it writes versions into.
 * Spec: modules/experiment/specs/experiment-service.feature.
 */
import type { DatasetApi } from "@langwatch/dataset-contract";
import {
  ExperimentNotReadyForMonitorError,
  ExperimentWorkflowNotFoundError,
  type Experiment,
  type ExperimentPublishedMonitor,
  type ExperimentWizardSaveInput,
  type SaveExperimentInput,
} from "@langwatch/experiment-contract";
import { generate } from "@langwatch/ksuid";
import {
  WorkflowNotFoundError,
  type StudioWorkflow,
  type WorkflowApi,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";

import type {
  ExperimentMonitorCascade,
  ExperimentWorkflowAuthoring,
} from "../app/experiment.app.ts";
import type { ExperimentService } from "./experiment.service.ts";

/** The workbench state the legacy wizard stored, as this service reads it. */
type LegacyWorkbenchState = Readonly<{
  name?: string | null;
  realTimeExecution?: { preconditions?: unknown; sample?: number };
  realTimeTraceMappings?: unknown;
}>;

export type ExperimentWorkflowLinkServiceOptions = {
  experiments: Pick<ExperimentService, "getById" | "findNextDraftName" | "save">;
  workflows: Pick<WorkflowApi, "getById">;
  workflowAuthoring: Pick<ExperimentWorkflowAuthoring, "create" | "saveVersion">;
  dataset: Pick<DatasetApi, "getByIds" | "renameDataset">;
  monitors: Pick<ExperimentMonitorCascade, "upsertForExperiment">;
  slugify(value: string): string;
};

export class ExperimentWorkflowLinkService {
  static create(options: ExperimentWorkflowLinkServiceOptions): ExperimentWorkflowLinkService {
    return new ExperimentWorkflowLinkService(options);
  }

  private constructor(private readonly options: ExperimentWorkflowLinkServiceOptions) {}

  /** The workflow behind an experiment, or null when it is gone. */
  async findWorkflow(
    input: Readonly<{ id: string; projectId: string; includeVersion?: boolean }>,
  ): Promise<WorkflowWithVersion | null> {
    try {
      return await this.options.workflows.getById(input);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return null;
      throw error;
    }
  }

  async saveWithWorkflow(input: ExperimentWizardSaveInput): Promise<Experiment> {
    const state = input.workbenchState as LegacyWorkbenchState;

    let workflowId = input.dsl.workflow_id;
    const name =
      state.name ??
      (await this.options.experiments.findNextDraftName({ projectId: input.projectId }));

    if (input.experimentId) {
      workflowId = await this.renameWithExistingWorkflow({
        projectId: input.projectId,
        experimentId: input.experimentId,
        dsl: input.dsl,
        name,
        workflowId,
      });
    }

    const workflowName = `${name} - Workflow`;
    if (!workflowId) {
      const workflow = await this.options.workflowAuthoring.create({
        projectId: input.projectId,
        name: workflowName,
        icon: input.dsl.icon,
        description: input.dsl.description,
      });

      workflowId = workflow.id;
    }

    await this.options.workflowAuthoring.saveVersion({
      projectId: input.projectId,
      workflowId,
      dsl: { ...input.dsl, workflow_id: workflowId, name: workflowName },
      autoSaved: !input.commitMessage,
      commitMessage: input.commitMessage ?? "Autosaved",
      setAsLatestVersion: true,
    });

    const experimentId = input.experimentId ?? generate("experiment").toString();

    return this.options.experiments.save({
      id: experimentId,
      projectId: input.projectId,
      name,
      type: "BATCH_EVALUATION_V2",
      requestedSlug: this.options.slugify(name),
      slugMode: input.experimentId ? "preserve-existing" : "deduplicate",
      workflowId,
      // The stored state is whatever the declaration admitted, which is JSON
      // by construction; the service stores it verbatim.
      workbenchState: input.workbenchState as SaveExperimentInput["workbenchState"],
    });
  }

  async saveAsMonitor(
    input: Readonly<{ projectId: string; experimentId: string }>,
  ): Promise<ExperimentPublishedMonitor> {
    const experiment = await this.options.experiments.getById({
      projectId: input.projectId,
      id: input.experimentId,
    });
    const workflow = experiment.workflowId
      ? await this.findWorkflow({
          id: experiment.workflowId,
          projectId: input.projectId,
          includeVersion: true,
        })
      : null;

    const workbenchState = experiment.workbenchState as LegacyWorkbenchState | undefined;
    const dsl = workflow?.currentVersion?.dsl as StudioWorkflow | undefined;
    const evaluator = dsl?.nodes.find((node) => node.type === "evaluator");
    const evaluatorData = evaluator?.data as
      | { evaluator?: string; parameters?: readonly { identifier: string; value: unknown }[] }
      | undefined;

    if (!workbenchState || !dsl || !evaluatorData?.evaluator) {
      throw new ExperimentNotReadyForMonitorError(input.experimentId);
    }

    return this.options.monitors.upsertForExperiment({
      projectId: input.projectId,
      experimentId: input.experimentId,
      monitor: {
        name: experiment.name ?? "Unknown",
        checkType: evaluatorData.evaluator,
        slug: experiment.slug,
        preconditions: workbenchState.realTimeExecution?.preconditions ?? [],
        parameters: Object.fromEntries(
          (evaluatorData.parameters ?? []).map((param) => [param.identifier, param.value]),
        ),
        mappings: workbenchState.realTimeTraceMappings,
        sample: workbenchState.realTimeExecution?.sample ?? 1,
        enabled: true,
        executionMode: "ON_MESSAGE",
      },
    });
  }

  /**
   * An existing experiment keeps its workflow, and its datasets follow a
   * rename so they do not keep pointing at the old name.
   */
  private async renameWithExistingWorkflow({
    projectId,
    experimentId,
    dsl,
    name,
    workflowId,
  }: {
    projectId: string;
    experimentId: string;
    dsl: StudioWorkflow;
    name: string;
    workflowId: string | undefined;
  }): Promise<string | undefined> {
    const currentExperiment = await this.options.experiments.getById({
      projectId,
      id: experimentId,
    });

    let resolvedWorkflowId = workflowId;
    if (currentExperiment.workflowId) {
      const workflow = await this.findWorkflow({ id: currentExperiment.workflowId, projectId });

      if (!workflow) {
        throw new ExperimentWorkflowNotFoundError(experimentId);
      }

      resolvedWorkflowId = workflow.id;
    }

    if (currentExperiment.name && currentExperiment.name !== name) {
      const datasetIds = dsl.nodes
        .filter((node) => node.type === "dataset")
        .map((node) => (node.data as { dataset?: { id?: string } }).dataset?.id)
        .filter((id): id is string => !!id);

      const datasets = await this.options.dataset.getByIds({ datasetIds, projectId });

      for (const dataset of datasets) {
        if (dataset.name.startsWith(currentExperiment.name)) {
          await this.options.dataset.renameDataset({
            datasetId: dataset.id,
            projectId,
            name: dataset.name.replace(currentExperiment.name, name),
          });
        }
      }
    }

    return resolvedWorkflowId;
  }
}

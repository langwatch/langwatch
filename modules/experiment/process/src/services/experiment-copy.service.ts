/**
 * Copying an experiment into another project, with its workflow or its
 * workbench state. Spec: modules/experiment/specs/experiment-service.feature.
 */
import type { DatasetApi } from "@langwatch/dataset-contract";
import {
  ExperimentPermissionDeniedError,
  ExperimentWorkflowNotFoundError,
  type Experiment,
  type ExperimentCopied,
  type ExperimentCopyInput,
} from "@langwatch/experiment-contract";
import { generate } from "@langwatch/ksuid";
import { z } from "zod";

import type { ExperimentPermissions, ExperimentWorkflowAuthoring } from "../app/experiment.app.ts";
import type { ExperimentWorkflowLinkService } from "./experiment-workflow-link.service.ts";
import type { ExperimentService } from "./experiment.service.ts";

export type ExperimentCopyServiceOptions = {
  experiments: Pick<ExperimentService, "getById" | "save">;
  links: Pick<ExperimentWorkflowLinkService, "findWorkflow">;
  workflowAuthoring: Pick<ExperimentWorkflowAuthoring, "saveVersion" | "copyWithDatasets">;
  dataset: Pick<DatasetApi, "copyDataset">;
  permissions: ExperimentPermissions;
  slugify(value: string): string;
};

type SavedDatasetEntry = { id: string; type: string; datasetId?: string };

export class ExperimentCopyService {
  static create(options: ExperimentCopyServiceOptions): ExperimentCopyService {
    return new ExperimentCopyService(options);
  }

  private constructor(private readonly options: ExperimentCopyServiceOptions) {}

  async copyToProject(
    input: ExperimentCopyInput,
    by: Readonly<{ id: string }>,
  ): Promise<ExperimentCopied> {
    // The declared check covers the TARGET project. The source is a second
    // project it never saw, so it is probed before anything is read.
    const mayReadSource = await this.options.permissions.mayManageEvaluations({
      actorId: by.id,
      projectId: input.sourceProjectId,
    });

    if (!mayReadSource) {
      throw new ExperimentPermissionDeniedError({
        permission: "evaluations:manage",
        message: "You do not have permission to manage evaluations in the source project",
      });
    }

    const experiment = await this.options.experiments.getById({
      projectId: input.sourceProjectId,
      id: input.experimentId,
    });

    // V3 experiments have no workflow; their state lives in workbenchState.
    if (experiment.type === "EVALUATIONS_V3") {
      return this.copyEvaluationsV3Experiment({
        experiment,
        targetProjectId: input.projectId,
        sourceProjectId: input.sourceProjectId,
        ...(input.copyDatasets === undefined ? {} : { copyDatasets: input.copyDatasets }),
      });
    }

    return this.copyWorkflowExperiment({ experiment, input });
  }

  private async copyWorkflowExperiment({
    experiment,
    input,
  }: {
    experiment: Experiment;
    input: ExperimentCopyInput;
  }): Promise<ExperimentCopied> {
    if (!experiment.workflowId) {
      throw new ExperimentWorkflowNotFoundError(experiment.id);
    }
    const sourceWorkflow = await this.options.links.findWorkflow({
      id: experiment.workflowId,
      projectId: input.sourceProjectId,
      includeVersion: true,
    });
    if (!sourceWorkflow?.latestVersion?.dsl) {
      throw new ExperimentWorkflowNotFoundError(experiment.id);
    }

    const { workflowId, dsl } = await this.options.workflowAuthoring.copyWithDatasets({
      workflow: {
        id: sourceWorkflow.id,
        name: sourceWorkflow.name,
        icon: sourceWorkflow.icon,
        description: sourceWorkflow.description,
        ...(sourceWorkflow.isEvaluator === undefined
          ? {}
          : { isEvaluator: sourceWorkflow.isEvaluator }),
        ...(sourceWorkflow.isComponent === undefined
          ? {}
          : { isComponent: sourceWorkflow.isComponent }),
        latestVersion: {
          ...sourceWorkflow.latestVersion,
          dsl: z.json().parse(sourceWorkflow.latestVersion.dsl),
        },
      },
      targetProjectId: input.projectId,
      sourceProjectId: input.sourceProjectId,
      ...(input.copyDatasets === undefined ? {} : { copyDatasets: input.copyDatasets }),
      copiedFromWorkflowId: experiment.workflowId,
    });

    const newWorkflow = await this.options.links.findWorkflow({
      id: workflowId,
      projectId: input.projectId,
    });

    if (!newWorkflow) {
      throw new Error("Failed to create workflow");
    }

    await this.options.workflowAuthoring.saveVersion({
      projectId: input.projectId,
      workflowId,
      dsl,
      autoSaved: false,
      commitMessage: `Copied from ${sourceWorkflow.name}`,
    });

    const experimentName = experiment.name ?? experiment.slug;
    const newExperiment = await this.options.experiments.save({
      id: generate("experiment").toString(),
      name: experimentName,
      requestedSlug: this.options.slugify(experimentName),
      slugMode: "deduplicate",
      projectId: input.projectId,
      type: experiment.type,
      workflowId,
      workbenchState: experiment.workbenchState,
    });

    return { experiment: newExperiment, workflow: { id: newWorkflow.id } };
  }

  /**
   * Copies an EVALUATIONS_V3 experiment: the state in `workbenchState` plus,
   * optionally, the saved datasets it references.
   */
  private async copyEvaluationsV3Experiment({
    experiment,
    targetProjectId,
    sourceProjectId,
    copyDatasets,
  }: {
    experiment: Readonly<{
      id: string;
      name: string | null;
      slug: string;
      workbenchState: unknown;
    }>;
    targetProjectId: string;
    sourceProjectId: string;
    copyDatasets?: boolean;
  }): Promise<ExperimentCopied> {
    const workbenchState = JSON.parse(JSON.stringify(experiment.workbenchState ?? {})) as Record<
      string,
      unknown
    >;

    // Execution results are not copied into the new project.
    delete workbenchState.results;

    if (copyDatasets && Array.isArray(workbenchState.datasets)) {
      const datasets = workbenchState.datasets as SavedDatasetEntry[];
      const datasetIdMap = await this.copySavedDatasets({
        datasets,
        sourceProjectId,
        targetProjectId,
      });

      for (const entry of datasets) {
        const mapped = entry.datasetId ? datasetIdMap[entry.datasetId] : undefined;
        if (entry.type === "saved" && mapped) {
          entry.datasetId = mapped;
        }
      }
    }

    const experimentName = experiment.name ?? experiment.slug;
    const newExperiment = await this.options.experiments.save({
      id: generate("eval").toString(),
      name: experimentName,
      requestedSlug: this.options.slugify(experimentName),
      slugMode: "deduplicate",
      projectId: targetProjectId,
      type: "EVALUATIONS_V3",
      workflowId: null,
      workbenchState: z.json().parse(workbenchState),
    });

    return { experiment: newExperiment, workflow: null };
  }

  private async copySavedDatasets({
    datasets,
    sourceProjectId,
    targetProjectId,
  }: {
    datasets: readonly SavedDatasetEntry[];
    sourceProjectId: string;
    targetProjectId: string;
  }): Promise<Record<string, string>> {
    const datasetIdMap: Record<string, string> = {};

    for (const entry of datasets) {
      if (entry.type === "saved" && entry.datasetId) {
        try {
          const newDataset = await this.options.dataset.copyDataset({
            sourceDatasetId: entry.datasetId,
            sourceProjectId,
            targetProjectId,
          });
          datasetIdMap[entry.datasetId] = newDataset.id;
        } catch {
          // A dataset that cannot be copied (for example one already removed)
          // keeps its original reference rather than failing the whole copy.
          continue;
        }
      }
    }

    return datasetIdMap;
  }
}

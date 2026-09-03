/**
 * Copying a Studio graph into another project, as the two flows that replicate
 * one perform it: the experiment workbench's workflow copy, and the
 * replication behind a workflow evaluator.
 *
 * The row and the version are written in two steps with the caller's own work
 * between them, which is why this is not `WorkflowService.copy`: the caller
 * decides what the first version says and commits it itself. What happens here
 * is the row, and the graph rewritten to belong to it.
 *
 * The dataset traversal is deliberately its own rather than
 * `WorkflowDatasetCopyService`'s. That one copies any parameter whose value
 * merely looks like a dataset reference; this one copies a parameter only
 * where the node declares its type as `dataset`, which is the narrowing the
 * Studio copy has always applied. Widening it here would copy datasets a
 * replicated evaluator never asked for.
 *
 * Spec: packages/features/workflow/specs/workflow-service.feature.
 */
import type { DatasetService } from "@langwatch/dataset-contract";
import {
  parseStudioWorkflow,
  WorkflowVersionRequiredError,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";
import { nanoid } from "nanoid";
import type { WorkflowRowPort } from "../ports/workflow.port";

export type WorkflowStudioCopyServiceOptions = {
  datasets: DatasetService;
  rows: WorkflowRowPort;
};

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

export type CopyStudioWorkflowInput = {
  workflow: WorkflowStudioCopySource;
  sourceProjectId: string;
  targetProjectId: string;
  copyDatasets?: boolean;
  copiedFromWorkflowId?: string;
};

/** A dataset reference as a Studio node or parameter carries one. */
type DatasetReference = { id?: string; name?: string };

const isDatasetReference = (value: unknown): value is DatasetReference => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.id === undefined || typeof candidate.id === "string") &&
    (candidate.name === undefined || typeof candidate.name === "string")
  );
};

export class WorkflowStudioCopyService {
  static create(options: WorkflowStudioCopyServiceOptions): WorkflowStudioCopyService {
    return new WorkflowStudioCopyService(options);
  }

  private constructor(private readonly options: WorkflowStudioCopyServiceOptions) {}

  async copyWithDatasets(
    input: CopyStudioWorkflowInput,
  ): Promise<{ workflowId: string; dsl: StudioWorkflow }> {
    const sourceDsl = input.workflow.latestVersion?.dsl;
    if (!sourceDsl) {
      throw new WorkflowVersionRequiredError();
    }

    // Deep clone so the graph this returns is the caller's to mutate.
    const dsl = parseStudioWorkflow(JSON.parse(JSON.stringify(sourceDsl)));

    if (input.copyDatasets) {
      await this.copyDatasetReferences({
        dsl,
        sourceProjectId: input.sourceProjectId,
        targetProjectId: input.targetProjectId,
      });
    }

    const workflowId = `workflow_${nanoid()}`;
    await this.options.rows.create({
      id: workflowId,
      projectId: input.targetProjectId,
      name: input.workflow.name,
      icon: input.workflow.icon ?? "",
      description: input.workflow.description ?? "",
      isEvaluator: input.workflow.isEvaluator ?? false,
      isComponent: input.workflow.isComponent ?? false,
      copiedFromWorkflowId: input.copiedFromWorkflowId ?? input.workflow.id,
    });

    dsl.workflow_id = workflowId;
    dsl.version = "1";
    dsl.experiment_id = "";
    dsl.state = {};

    return { workflowId, dsl };
  }

  /** Rewrites every dataset the copied graph names to the target project's own. */
  private async copyDatasetReferences(input: {
    dsl: StudioWorkflow;
    sourceProjectId: string;
    targetProjectId: string;
  }): Promise<void> {
    const copied = new Map<string, { id: string; name: string }>();

    for (const node of input.dsl.nodes) {
      const data = node.data as
        | (Record<string, unknown> & { parameters?: { type?: string; value?: unknown }[] })
        | undefined;
      if (!data) continue;

      if ("dataset" in data && data.dataset) {
        await this.rewriteReference({
          reference: data.dataset as DatasetReference,
          copied,
          sourceProjectId: input.sourceProjectId,
          targetProjectId: input.targetProjectId,
        });
      }

      for (const parameter of data.parameters ?? []) {
        if (parameter.type !== "dataset") continue;
        if (parameter.value == null || !isDatasetReference(parameter.value)) continue;
        await this.rewriteReference({
          reference: parameter.value,
          copied,
          sourceProjectId: input.sourceProjectId,
          targetProjectId: input.targetProjectId,
        });
      }
    }
  }

  /** Copies one referenced dataset once, and points the reference at the copy. */
  private async rewriteReference(input: {
    reference: DatasetReference;
    copied: Map<string, { id: string; name: string }>;
    sourceProjectId: string;
    targetProjectId: string;
  }): Promise<void> {
    const sourceDatasetId = input.reference.id;
    if (!sourceDatasetId) return;

    const already = input.copied.get(sourceDatasetId);
    if (already) {
      input.reference.id = already.id;
      input.reference.name = already.name;
      return;
    }

    const created = await this.options.datasets.copyDataset({
      sourceDatasetId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.targetProjectId,
    });

    input.copied.set(sourceDatasetId, { id: created.id, name: created.name });
    input.reference.id = created.id;
    input.reference.name = created.name;
  }
}

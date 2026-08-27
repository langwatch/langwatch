import type { Dataset, DatasetService } from "@langwatch/dataset-contract";
import type { WorkflowDsl } from "@langwatch/workflow-contract";
import { z } from "zod";

const datasetReferenceSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().optional(),
});

const datasetParameterSchema = z.looseObject({
  value: z.unknown().optional(),
});

const datasetNodeSchema = z.looseObject({
  data: z.looseObject({
    dataset: z.unknown().optional(),
    parameters: z.array(z.unknown()).optional(),
  }),
});

export class WorkflowDatasetCopyService {
  static create(datasets: DatasetService): WorkflowDatasetCopyService {
    return new WorkflowDatasetCopyService(datasets);
  }

  private constructor(private readonly datasets: DatasetService) {}

  async copy(input: {
    dsl: WorkflowDsl;
    sourceProjectId: string;
    targetProjectId: string;
  }): Promise<WorkflowDsl> {
    const seen = new Map<string, Dataset>();
    const nodes: unknown[] = [];

    for (const node of input.dsl.nodes) {
      const parsedNode = datasetNodeSchema.safeParse(node);
      if (!parsedNode.success) {
        nodes.push(node);
        continue;
      }

      const data = { ...parsedNode.data.data };
      if ("dataset" in data) {
        data.dataset = await this.copyReference({
          value: data.dataset,
          seen,
          sourceProjectId: input.sourceProjectId,
          targetProjectId: input.targetProjectId,
        });
      }

      const parameters: unknown[] = [];
      for (const parameter of data.parameters ?? []) {
        const parsedParameter = datasetParameterSchema.safeParse(parameter);
        if (!parsedParameter.success) {
          parameters.push(parameter);
          continue;
        }

        parameters.push({
          ...parsedParameter.data,
          value: await this.copyReference({
            value: parsedParameter.data.value,
            seen,
            sourceProjectId: input.sourceProjectId,
            targetProjectId: input.targetProjectId,
          }),
        });
      }

      nodes.push({
        ...parsedNode.data,
        data: {
          ...data,
          ...(data.parameters === void 0 ? {} : { parameters }),
        },
      });
    }

    return { ...input.dsl, nodes };
  }

  private async copyReference(input: {
    value: unknown;
    seen: Map<string, Dataset>;
    sourceProjectId: string;
    targetProjectId: string;
  }): Promise<unknown> {
    const reference = datasetReferenceSchema.safeParse(input.value);
    if (!reference.success) {
      return input.value;
    }

    const id = reference.data.id;
    let copied = input.seen.get(id);
    if (!copied) {
      copied = await this.datasets.copyDataset({
        sourceDatasetId: id,
        sourceProjectId: input.sourceProjectId,
        targetProjectId: input.targetProjectId,
      });
      input.seen.set(id, copied);
    }

    return { ...reference.data, id: copied.id, name: copied.name };
  }
}

import type { Dataset } from "@langwatch/dataset-contract";
import { WorkflowVersionRequiredError } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";
import { WorkflowRowPort, type WorkflowRowDraft } from "../../ports/workflow.port";
import {
  WorkflowStudioCopyService,
  type WorkflowStudioCopySource,
} from "../workflow-studio-copy.service";
import { TestDatasetService } from "./dataset.service.fake";

class RecordingRowPort extends WorkflowRowPort {
  readonly created: WorkflowRowDraft[] = [];

  create(input: WorkflowRowDraft): Promise<void> {
    this.created.push(input);
    return Promise.resolve();
  }
}

const copiedDataset = { id: "dataset-copy", name: "Copied set" } as Dataset;

/** A graph whose entry node names a dataset, twice, plus a non-dataset parameter. */
const graphWithDatasets = () => ({
  workflow_id: "wf-source",
  spec_version: "1.4",
  name: "Source",
  icon: "x",
  description: "x",
  version: "3",
  nodes: [
    {
      id: "entry",
      type: "entry",
      position: { x: 0, y: 0 },
      data: {
        name: "Entry",
        dataset: { id: "dataset-1", name: "Original set" },
        outputs: [{ identifier: "question", type: "str" }],
      },
    },
    {
      id: "llm",
      type: "signature",
      position: { x: 1, y: 0 },
      data: {
        name: "Prompt",
        parameters: [
          { identifier: "demonstrations", type: "dataset", value: { id: "dataset-1" } },
          { identifier: "prompt", type: "str", value: { id: "not-a-dataset" } },
        ],
      },
    },
  ],
  edges: [],
  state: {},
});

/** The node at `index`, as the assertions below read it. */
const nodeData = <T>(dsl: { nodes: readonly unknown[] }, index: number): T => {
  const node = dsl.nodes[index];
  if (!node || typeof node !== "object" || !("data" in node)) {
    throw new Error(`The copied graph has no node at ${index}.`);
  }
  return (node as { data: T }).data;
};

const source = (dsl: unknown): WorkflowStudioCopySource => ({
  id: "wf-source",
  name: "Source",
  icon: "🧪",
  description: "the original",
  isEvaluator: true,
  isComponent: false,
  latestVersion: dsl === undefined ? null : { dsl },
});

function build() {
  const datasets = new TestDatasetService(undefined, copiedDataset);
  const rows = new RecordingRowPort();
  return { datasets, rows, service: WorkflowStudioCopyService.create({ datasets, rows }) };
}

describe("WorkflowStudioCopyService", () => {
  describe("given a workflow with no committed version", () => {
    describe("when it is copied", () => {
      it("refuses rather than creating an empty replica", async () => {
        const { service } = build();

        await expect(
          service.copyWithDatasets({
            workflow: source(undefined),
            sourceProjectId: "project-source",
            targetProjectId: "project-target",
          }),
        ).rejects.toBeInstanceOf(WorkflowVersionRequiredError);
      });
    });
  });

  describe("given a workflow with a saved version", () => {
    describe("when it is copied without its datasets", () => {
      it("creates the row in the target project, carrying the source's flags and lineage", async () => {
        const { service, rows } = build();

        const { workflowId } = await service.copyWithDatasets({
          workflow: source(graphWithDatasets()),
          sourceProjectId: "project-source",
          targetProjectId: "project-target",
        });

        expect(rows.created[0]).toEqual({
          id: workflowId,
          projectId: "project-target",
          name: "Source",
          icon: "🧪",
          description: "the original",
          isEvaluator: true,
          isComponent: false,
          copiedFromWorkflowId: "wf-source",
        });
      });

      it("rewrites the graph's identity so it belongs to the new workflow", async () => {
        const { service } = build();

        const { workflowId, dsl } = await service.copyWithDatasets({
          workflow: source(graphWithDatasets()),
          sourceProjectId: "project-source",
          targetProjectId: "project-target",
        });

        expect({
          workflow_id: dsl.workflow_id,
          version: dsl.version,
          experiment_id: dsl.experiment_id,
          state: dsl.state,
        }).toEqual({ workflow_id: workflowId, version: "1", experiment_id: "", state: {} });
      });

      it("leaves every dataset reference pointing at the source project's own", async () => {
        const { service, datasets } = build();

        const { dsl } = await service.copyWithDatasets({
          workflow: source(graphWithDatasets()),
          sourceProjectId: "project-source",
          targetProjectId: "project-target",
        });

        expect({
          copies: datasets.datasetCopies.length,
          entryDataset: nodeData<{ dataset: { id: string } }>(dsl, 0).dataset.id,
        }).toEqual({ copies: 0, entryDataset: "dataset-1" });
      });
    });

    describe("when it is copied with its datasets", () => {
      /** @scenario "Copying referenced datasets uses the Dataset service" */
      it("copies each referenced dataset once, however many nodes name it", async () => {
        const { service, datasets } = build();

        await service.copyWithDatasets({
          workflow: source(graphWithDatasets()),
          sourceProjectId: "project-source",
          targetProjectId: "project-target",
          copyDatasets: true,
        });

        expect(datasets.datasetCopies).toEqual([
          {
            sourceDatasetId: "dataset-1",
            sourceProjectId: "project-source",
            targetProjectId: "project-target",
          },
        ]);
      });

      /** @scenario "Copying referenced datasets uses the Dataset service" */
      it("points every reference to that dataset at the copy, name included", async () => {
        const { service } = build();

        const { dsl } = await service.copyWithDatasets({
          workflow: source(graphWithDatasets()),
          sourceProjectId: "project-source",
          targetProjectId: "project-target",
          copyDatasets: true,
        });

        const entry = nodeData<{ dataset: unknown }>(dsl, 0).dataset;
        const parameters = nodeData<{
          parameters: { identifier: string; value: unknown }[];
        }>(dsl, 1).parameters;

        expect({ entry, demonstrations: parameters[0]?.value }).toEqual({
          entry: { id: "dataset-copy", name: "Copied set" },
          demonstrations: { id: "dataset-copy", name: "Copied set" },
        });
      });

      /** @scenario "Copying referenced datasets uses the Dataset service" */
      it("leaves a parameter the node does not declare as a dataset alone", async () => {
        const { service } = build();

        const { dsl } = await service.copyWithDatasets({
          workflow: source(graphWithDatasets()),
          sourceProjectId: "project-source",
          targetProjectId: "project-target",
          copyDatasets: true,
        });

        const parameters = nodeData<{
          parameters: { identifier: string; value: unknown }[];
        }>(dsl, 1).parameters;

        expect(parameters[1]?.value).toEqual({ id: "not-a-dataset" });
      });
    });

    describe("when the copy names the workflow it was made from", () => {
      it("records that lineage rather than the row it read", async () => {
        const { service, rows } = build();

        await service.copyWithDatasets({
          workflow: source(graphWithDatasets()),
          sourceProjectId: "project-source",
          targetProjectId: "project-target",
          copiedFromWorkflowId: "wf-original",
        });

        expect(rows.created[0]?.copiedFromWorkflowId).toBe("wf-original");
      });
    });
  });
});

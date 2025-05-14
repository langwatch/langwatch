import { type StateCreator } from "zustand";
import type { WorkflowStore } from "~/optimization_studio/hooks/useWorkflowStore";
import type { DatasetColumns } from "~/server/datasets/types";
import { datasetColumnsToFields } from "~/optimization_studio/utils/datasetUtils";
import { entryNode } from "~/optimization_studio/templates/blank";
import type { Entry } from "~/optimization_studio/types/dsl";
import type { Node } from "@xyflow/react";
import { buildEntryToTargetEdges } from "./utils/edge.util";
import type { RefObject } from "react";
import type { AgGridReact } from "@ag-grid-community/react";

export interface DatasetSlice {
  /**
   * Set the dataset ID and column types for the workflow
   * @param datasetId The ID of the dataset
   * @param columnTypes The column types of the dataset
   */
  setDatasetId: (datasetId: string, columnTypes: DatasetColumns) => void;

  /**
   * Get the current dataset ID from the workflow
   * @returns The dataset ID or undefined if not set
   */
  getDatasetId: () => string | undefined;

  /**
   * Clear the dataset ID from the workflow
   */
  clearDatasetId: () => void;

  /**
   * Set the dataset grid reference
   * @param gridRef Reference to the AG Grid component
   */
  setDatasetGridRef: (gridRef: RefObject<AgGridReact<any> | null>) => void;
}

export const createDatasetSlice: StateCreator<
  {
    workflowStore: WorkflowStore;
    datasetGridRef?: RefObject<AgGridReact<any> | null>;
  },
  [],
  [],
  DatasetSlice
> = (set, get) => {
  return {
    setDatasetId: (datasetId, columnTypes) => {
      get().workflowStore.setWorkflow((current) => {
        const previousEntryNode = current.nodes.find(
          (node) => node.type === "entry"
        );

        // Upsert the entry node into the workflow
        let newNodes = current.nodes;
        const outputs = datasetColumnsToFields(columnTypes);
        if (previousEntryNode) {
          newNodes = current.nodes.map((node) => {
            if (node.type !== "entry") {
              return node;
            }

            return {
              ...node,
              data: {
                ...node.data,
                dataset: { id: datasetId },
                outputs,
              },
            };
          });
        } else {
          const newEntryNode = entryNode();

          newNodes = [
            ...current.nodes,
            {
              ...newEntryNode,
              data: {
                ...newEntryNode.data,
                dataset: { id: datasetId },
                outputs,
              },
            },
          ];
        }

        // Logic to disconnect the current no longer existing edges from the entry node
        const entryFields = outputs.map(
          (output) => `outputs.${output.identifier}`
        );
        let newEdges = current.edges.filter(
          (edge) =>
            edge.source !== "entry" ||
            entryFields.includes(edge.sourceHandle ?? "")
        );

        // And then connecting it again using defaults with the other existing components
        const newEntryNode = newNodes.find((node) => node.type === "entry") as
          | Node<Entry>
          | undefined;
        const otherNodes = newNodes.filter((node) => node.type !== "entry");

        const newEdgesTargetHandles = newEdges.map(
          (edge) => `${edge.target}-${edge.targetHandle}`
        );
        for (const node of otherNodes) {
          const otherNodeEdges = buildEntryToTargetEdges(
            newEntryNode,
            node
          ).filter(
            (edge) =>
              !newEdgesTargetHandles.includes(
                `${edge.target}-${edge.targetHandle}`
              )
          );
          newEdges = [...newEdges, ...otherNodeEdges];
        }

        return {
          ...current,
          nodes: newNodes,
          edges: newEdges,
        };
      });
    },

    getDatasetId: () => {
      const entryNodeData = get()
        .workflowStore.getWorkflow()
        .nodes.find((node) => node.type === "entry")?.data;
      if (entryNodeData && "dataset" in entryNodeData) {
        return entryNodeData.dataset?.id;
      }
      return undefined;
    },

    clearDatasetId: () => {
      get().workflowStore.setWorkflow((current) => {
        const nodes = current.nodes.map((node) => {
          if (node.type !== "entry") {
            return node;
          }
          return {
            ...node,
            data: {
              ...node.data,
              dataset: undefined,
            },
          };
        });

        return {
          ...current,
          nodes,
        };
      });
    },

    setDatasetGridRef: (gridRef) => {
      set({ datasetGridRef: gridRef });
    },
  };
};

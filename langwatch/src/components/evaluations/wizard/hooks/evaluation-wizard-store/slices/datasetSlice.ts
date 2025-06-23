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
   * The ID of the dataset that is currently being used in the workflow
   * for the first entry node.
   */
  entryNodeDatasetId: string | undefined;

  /**
   * Set the dataset ID and column types for the workflow
   * @param datasetId The ID of the dataset
   * @param columnTypes The column types of the dataset
   */
  setDatasetId: (datasetId: string, columnTypes: DatasetColumns) => void;

  /**
   * Handle dataset updates from the DatasetTable component
   * @param updatedDataset The updated dataset information
   */
  handleDatasetUpdate: (updatedDataset: {
    datasetId?: string;
    columnTypes?: DatasetColumns;
  }) => void;

  /**
   * Get the current dataset ID from the workflow
   * @deprecated Use `getEntryNodeDatasetId` instead
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

/**
 * Create a dataset slice
 * @param set The set function from the store
 * @param get The get function from the store
 * @returns The dataset slice
 */
export const createDatasetSlice: StateCreator<
  {
    workflowStore: WorkflowStore;
    datasetGridRef?: RefObject<AgGridReact<any> | null>;
  } & DatasetSlice,
  [],
  [],
  DatasetSlice
> = (set, get, store) => {
  // Add a listener for state changes to make sure that the
  // entry node dataset id is always up to date
  store.subscribe((state) => {
    const { nodes } = state.workflowStore;
    const entryNode = nodes.find((node) => node.type === "entry") as
      | Node<Entry>
      | undefined;

    const entryNodeDatasetId = entryNode?.data?.dataset?.id;
    if (get().entryNodeDatasetId !== entryNodeDatasetId) {
      set({ entryNodeDatasetId });
    }
  });

  return {
    entryNodeDatasetId: undefined,
    setDatasetId: (datasetId, columnTypes) => {
      get().workflowStore.setWorkflow((current) => {
        const previousEntryNode = current.nodes.find(
          (node) => node.type === "entry"
        );

        // Upsert the entry node into the workflow
        let newNodes = current.nodes;
        const outputs = datasetColumnsToFields(columnTypes);
        let updatedEntryNode: Node<Entry> | undefined;

        if (previousEntryNode) {
          newNodes = current.nodes.map((node) => {
            if (node.type !== "entry") {
              return node;
            }

            const updated = {
              ...node,
              data: {
                ...node.data,
                dataset: { id: datasetId },
                outputs,
              },
            };

            updatedEntryNode = updated as Node<Entry>;
            return updated;
          });
        } else {
          const baseEntryNode = entryNode();
          updatedEntryNode = {
            ...baseEntryNode,
            data: {
              ...baseEntryNode.data,
              dataset: { id: datasetId },
              outputs,
            },
          } as Node<Entry>;

          newNodes = [...current.nodes, updatedEntryNode];
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
        const otherNodes = newNodes.filter((node) => node.type !== "entry");

        // Only proceed with edge creation if we have a valid entry node
        if (updatedEntryNode) {
          const newEdgesTargetHandles = newEdges.map(
            (edge) => `${edge.target}-${edge.targetHandle}`
          );

          for (const node of otherNodes) {
            const otherNodeEdges = buildEntryToTargetEdges(
              updatedEntryNode,
              node
            ).filter(
              (edge) =>
                !newEdgesTargetHandles.includes(
                  `${edge.target}-${edge.targetHandle}`
                )
            );
            newEdges = [...newEdges, ...otherNodeEdges];
          }
        }

        return {
          ...current,
          nodes: newNodes,
          edges: newEdges,
        };
      });
    },

    handleDatasetUpdate: (updatedDataset) => {
      // Update the wizard state when dataset is modified
      if (updatedDataset.datasetId && updatedDataset.columnTypes) {
        get().setDatasetId(
          updatedDataset.datasetId,
          updatedDataset.columnTypes
        );
      }
    },

    getDatasetId: () => {
      return get().entryNodeDatasetId;
    },

    clearDatasetId: () => {
      get().workflowStore.setWorkflow((current) => {
        // Update entry node to remove dataset and outputs
        const nodes = current.nodes.map((node) => {
          if (node.type !== "entry") {
            return node;
          }
          return {
            ...node,
            data: {
              ...node.data,
              dataset: undefined,
              outputs: [], // Clear outputs as they're no longer valid
            },
          };
        });

        // Remove any edges connected to entry node outputs
        const edges = current.edges.filter(
          (edge) =>
            edge.source !== "entry" ||
            !edge.sourceHandle?.startsWith("outputs.")
        );

        return {
          ...current,
          nodes,
          edges,
        };
      });
    },

    setDatasetGridRef: (gridRef) => {
      set({ datasetGridRef: gridRef });
    },
  };
};

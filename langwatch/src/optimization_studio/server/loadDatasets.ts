import { getFullDataset } from "../../server/api/routers/datasetRecord";
import type { Component, Workflow } from "../types/dsl";
import type { StudioClientEvent } from "../types/events";
import {
  datasetDatabaseRecordsToInMemoryDataset,
  inMemoryDatasetToNodeDataset,
  transposeColumnsFirstToRowsFirstWithId,
  transpostRowsFirstToColumnsFirstWithoutId,
} from "../utils/datasetUtils";
import { type Node } from "@xyflow/react";

export const loadDatasets = async (
  event: StudioClientEvent,
  projectId: string
): Promise<StudioClientEvent> => {
  if (!("workflow" in event.payload)) {
    return event;
  }

  const nodes = await Promise.all(
    event.payload.workflow.nodes.map(async (node) => {
      if (!("dataset" in node.data && node.data.dataset)) {
        return node;
      }
      // Avoid fetching the dataset for single component execution where it's not needed
      if (event.type == "execute_component") {
        return {
          ...node,
          data: {
            ...node.data,
            dataset: undefined,
          },
        };
      }

      const entrySelection =
        event.type == "execute_flow" ? node.data.entry_selection : "all";

      // Select from inline dataset
      if (node.data.dataset.inline) {
        if (entrySelection == "all") {
          return node;
        }

        const records = transposeColumnsFirstToRowsFirstWithId(
          node.data.dataset.inline.records
        );
        const selectedRecords = (
          typeof entrySelection === "number"
            ? entrySelection >= 0 && entrySelection < records.length
              ? [records[entrySelection]!]
              : [records[0]!]
            : entrySelection == "random"
            ? [records[Math.floor(Math.random() * records.length)]!]
            : entrySelection === "last"
            ? [records[records.length - 1]!]
            : [records[0]!]
        ).filter((record) => record);

        return {
          ...node,
          data: {
            ...node.data,
            dataset: {
              ...node.data.dataset,
              inline: {
                ...node.data.dataset.inline,
                records:
                  transpostRowsFirstToColumnsFirstWithoutId(selectedRecords),
              },
            },
          },
        };
      }

      // Select from database dataset
      if (!node.data.dataset.id) {
        throw new Error("Dataset ID is required");
      }

      const dataset = await getFullDataset({
        datasetId: node.data.dataset.id,
        projectId,
        entrySelection,
      });
      if (!dataset) {
        throw new Error("Dataset not found");
      }
      const inMemoryDataset = datasetDatabaseRecordsToInMemoryDataset(dataset);
      delete inMemoryDataset.datasetId;
      const inlineDataset = inMemoryDatasetToNodeDataset(inMemoryDataset);

      return {
        ...node,
        data: {
          ...node.data,
          dataset: inlineDataset,
        },
      } as Node<Component>;
    })
  );

  const workflow: Workflow = {
    ...(event.payload.workflow as Workflow),
    nodes,
  };

  return {
    ...event,
    payload: {
      ...event.payload,
      workflow,
    } as any,
  };
};

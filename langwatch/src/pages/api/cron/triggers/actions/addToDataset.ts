import { TriggerAction } from "@prisma/client";
import { createManyDatasetRecords } from "~/server/api/routers/datasetRecord";
import type { DatasetRecordEntry } from "~/server/datasets/types";
import {
  mapTraceToDatasetEntry,
  type TraceMapping,
} from "~/server/tracer/tracesMapping";
import { captureException } from "~/utils/posthogErrorCapture";
import type { ActionParams, TriggerContext } from "../types";

export const handleAddToDataset = async (context: TriggerContext) => {
  const { trigger, triggerData } = context;

  try {
    const actionParams = trigger.actionParams as unknown as ActionParams;

    if (!actionParams) {
      throw new Error("ActionParams is missing from trigger");
    }

    const { datasetId, datasetMapping } = actionParams;

    const { mapping, expansions: expansionsArray } = datasetMapping;
    const expansions = new Set(expansionsArray);

    const rowsToAdd = triggerData.map((trace) => trace.fullTrace);
    const now = Date.now();

    let index = 0;
    const entries: DatasetRecordEntry[] = [];

    for (const trace of rowsToAdd) {
      const mappedEntries = mapTraceToDatasetEntry(
        trace,
        mapping as TraceMapping,
        expansions,
        undefined,
        undefined,
      );

      for (const entry of mappedEntries) {
        const sanitizedEntry = Object.fromEntries(
          Object.entries(entry).map(([key, value]) => [
            key,
            typeof value === "string" ? value.replace(/\u0000/g, "") : value,
          ]),
        );
        entries.push({
          id: `${now}-${index}`,
          selected: true,
          ...sanitizedEntry,
        });
        index++;
      }
    }

    await createManyDatasetRecords({
      datasetId: datasetId,
      projectId: trigger.projectId,
      datasetRecords: entries,
    });
  } catch (error) {
    captureException(error, {
      extra: {
        triggerId: trigger.id,
        projectId: trigger.projectId,
        action: TriggerAction.ADD_TO_DATASET,
      },
    });
  }
};

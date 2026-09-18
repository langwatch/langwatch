// Where a target's input variables can read their values from: the active
// dataset and other targets' outputs.

import type { AvailableSource, FieldType } from "@langwatch/prompt-browser-kit";
import { datasetColumnTypeToFieldType } from "@langwatch/workflow-browser-kit";

import type { DatasetReference, TargetConfig } from "../../model/experiments-v3/types.ts";

export function buildTargetAvailableSources({
  activeDataset,
  otherTargets,
  resolveTargetName,
}: {
  activeDataset: DatasetReference | undefined;
  otherTargets: readonly TargetConfig[];
  resolveTargetName: (target: TargetConfig) => string;
}): AvailableSource[] {
  const sources: AvailableSource[] = [];

  if (activeDataset) {
    sources.push({
      id: activeDataset.id,
      name: activeDataset.name,
      type: "dataset",
      fields: activeDataset.columns.map((column) => ({
        name: column.name,
        type: datasetColumnTypeToFieldType(column.type),
      })),
    });
  }

  for (const target of otherTargets) {
    sources.push({
      id: target.id,
      name: resolveTargetName(target),
      type: target.type === "prompt" ? "signature" : "code",
      fields: target.outputs.map((output) => ({
        name: output.identifier,
        type: output.type as FieldType,
      })),
    });
  }

  return sources;
}

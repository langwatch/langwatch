/**
 * Where a target's input variables can read their values from.
 *
 * The ACTIVE dataset only — mappings are stored per dataset, so offering
 * another dataset's columns would write a mapping nothing reads — plus the
 * other targets, whose outputs are how one target chains into another. A
 * target source is labelled with its resolved name rather than its internal
 * id, which is what makes a chained mapping readable.
 */

import type { AvailableSource, FieldType } from "@langwatch/prompt-web/surfaces/variables";
import { datasetColumnTypeToFieldType } from "@langwatch/workflow-web/surfaces/studio-dataset-columns";

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

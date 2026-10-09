import type { JsonValue } from "@prisma/client/runtime/client";
import type { Node } from "@xyflow/react";
import type { Entry, Workflow } from "../../../optimization_studio/types/dsl";

/**
 * The dataset id an experiment ran against, for the experiments list's
 * Dataset column.
 *
 * A workflow-backed experiment carries it in the DSL's entry node. An
 * SDK-driven experiment (`experiments.init()`, no Optimization Studio
 * workflow at all) has no DSL to read, so it falls back to
 * `experiment.datasetId` — set via `experiments.init(slug, { datasetId })` or
 * the batch `log_results` `dataset_id`/`dataset_slug` fields (issue #6411).
 * The workflow DSL wins when both are present, since that is the value the
 * Optimization Studio run actually used.
 */
export function getExperimentDatasetId(experiment: {
  datasetId: string | null;
  workflow?: { currentVersion?: { dsl: JsonValue } | null } | null;
}): string | undefined {
  const dsl = experiment.workflow?.currentVersion?.dsl;
  const fromWorkflow = (
    (dsl as Workflow | undefined)?.nodes.find(
      (node) => node.type === "entry",
    ) as Node<Entry>
  )?.data.dataset?.id;
  return fromWorkflow ?? experiment.datasetId ?? undefined;
}

import type { DatasetReference, EvaluatorConfig, InlineDataset, TargetConfig } from "../../types";
import { TransformError, type WorkbenchState } from "./types";

export const requireTarget = ({
  state,
  targetId,
}: {
  state: WorkbenchState;
  targetId: string;
}): TargetConfig => {
  const target = state.targets.find((t) => t.id === targetId);
  if (!target) {
    throw new TransformError({
      code: "target_not_found",
      message: `No target ${targetId} in the workbench`,
      meta: { targetId },
    });
  }
  return target;
};

export const requireEvaluator = ({
  state,
  evaluatorId,
}: {
  state: WorkbenchState;
  evaluatorId: string;
}): EvaluatorConfig => {
  const evaluator = state.evaluators.find((e) => e.id === evaluatorId);
  if (!evaluator) {
    throw new TransformError({
      code: "evaluator_not_found",
      message: `No evaluator ${evaluatorId} in the workbench`,
      meta: { evaluatorId },
    });
  }
  return evaluator;
};

export const requireDataset = ({
  state,
  datasetId,
}: {
  state: WorkbenchState;
  datasetId: string;
}): DatasetReference => {
  const dataset = state.datasets.find((d) => d.id === datasetId);
  if (!dataset) {
    throw new TransformError({
      code: "dataset_not_found",
      message: `No dataset ${datasetId} in the workbench`,
      meta: { datasetId },
    });
  }
  return dataset;
};

/**
 * A dataset whose rows and columns this layer may edit.
 *
 * Saved datasets are refused: their records live in the database and are
 * written through the dataset API, which also owns the pending-changes queue.
 */
export const requireInlineDataset = ({
  state,
  datasetId,
}: {
  state: WorkbenchState;
  datasetId: string;
}): DatasetReference & { inline: InlineDataset } => {
  const dataset = requireDataset({ state, datasetId });
  if (dataset.type !== "inline" || !dataset.inline) {
    throw new TransformError({
      code: "dataset_not_editable",
      message: `Dataset ${datasetId} is saved — edit its rows through the dataset API`,
      meta: { datasetId, type: dataset.type },
    });
  }
  return dataset as DatasetReference & { inline: InlineDataset };
};

/** Row count of an inline dataset: the longest column wins. */
export const inlineRowCount = (inline: InlineDataset): number => {
  const columnValues = Object.values(inline.records);
  if (columnValues.length === 0) return 0;
  return Math.max(...columnValues.map((v) => v.length));
};

export const replaceDataset = ({
  state,
  dataset,
}: {
  state: WorkbenchState;
  dataset: DatasetReference;
}): WorkbenchState => ({
  ...state,
  datasets: state.datasets.map((d) => (d.id === dataset.id ? dataset : d)),
});

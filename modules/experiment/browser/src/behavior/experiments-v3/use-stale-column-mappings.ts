/**
 * The mappings of one target column (its own and the evaluators' for it) that
 * read a column the active dataset does not have, and the action clearing them.
 * @see specs/experiments-v3/mapping-validation.feature
 */
import {
  evaluatorMappingGaps,
  getTargetMissingMappings,
} from "@langwatch/experiment-contract/mapping-validation";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { TargetConfig } from "../../model/experiments-v3/types.ts";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store.ts";

export type StaleColumnMapping = { fieldId: string; columnName: string };

/** One line per stale mapping, as the column header warns about it. */
export const staleMappingLine = ({ fieldId, columnName }: StaleColumnMapping): string =>
  `"${fieldId}" reads "${columnName}", which is not in the dataset`;

export const useStaleColumnMappings = (
  target: TargetConfig,
): { stale: StaleColumnMapping[]; clear: () => void } => {
  const { activeDatasetId, datasets, evaluators, removeMappingsToMissingColumns } =
    useEvaluationsV3Store(
      useShallow((state) => ({
        activeDatasetId: state.activeDatasetId,
        datasets: state.datasets,
        evaluators: state.evaluators,
        removeMappingsToMissingColumns: state.removeMappingsToMissingColumns,
      })),
    );

  const stale = useMemo(() => {
    const gaps = [
      ...getTargetMissingMappings(target, activeDatasetId, { datasets }).missingMappings,
      ...evaluators.flatMap(
        (evaluator) =>
          evaluatorMappingGaps({
            evaluator,
            datasetId: activeDatasetId,
            targetId: target.id,
            datasets,
          }).missingMappings,
      ),
    ];
    return gaps.flatMap((gap) =>
      gap.reason === "column_not_in_dataset" && gap.columnName !== undefined
        ? [{ fieldId: gap.fieldId, columnName: gap.columnName }]
        : [],
    );
  }, [target, activeDatasetId, datasets, evaluators]);

  return {
    stale,
    clear: () =>
      removeMappingsToMissingColumns({ datasetId: activeDatasetId, targetId: target.id }),
  };
};

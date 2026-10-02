import { ColumnTypeIcon } from "@langwatch/design-system/column-type-icon";
/**
 * The workbench table's column definitions: stable structure only. Headers and
 * cells read current data from the table meta, so these change almost never.
 */
import { HStack, Text } from "@langwatch/design-system/primitives";
import { toComparisonConfig } from "@langwatch/experiment-contract";
import type { ColumnDef, ColumnHelper } from "@tanstack/react-table";

import type {
  DatasetColumn,
  EvaluatorConfig,
  TableMeta,
  TableRowData,
} from "../../../model/experiments-v3/types.ts";
import {
  CHECKBOX_WIDTH_PX,
  COMPARISON_COL_DEFAULT_PCT,
  COMPARISON_COL_MIN_PCT,
  DATASET_COL_DEFAULT_PCT,
  TARGET_COL_DEFAULT_PCT,
} from "../../../model/experiments-v3/workbench-column-widths.ts";
import type { DatasetTableColumnType as ColumnType } from "../../elements/dataset/table-cell.tsx";
import { ComparisonCell } from "./comparison-cell.tsx";
import { ComparisonColumnHeader } from "./comparison-column-header.tsx";
import {
  CheckboxCellFromMeta,
  CheckboxHeaderFromMeta,
  TargetCellFromMeta,
  TargetHeaderFromMeta,
} from "./table-meta-wrappers.tsx";

type Helper = ColumnHelper<TableRowData>;

const metaOf = (meta: unknown): TableMeta | undefined => meta as TableMeta | undefined;

const checkboxColumn = (columnHelper: Helper): ColumnDef<TableRowData> =>
  columnHelper.display({
    id: "select",
    header: (context) => <CheckboxHeaderFromMeta context={context} />,
    cell: (info) => (
      <CheckboxCellFromMeta rowIndex={info.row.index} tableMeta={metaOf(info.table.options.meta)} />
    ),
    size: CHECKBOX_WIDTH_PX,
    enableResizing: false,
    meta: { columnType: "checkbox" as ColumnType, columnId: "__checkbox__", isFixedWidth: true },
  });

const datasetColumn = (columnHelper: Helper, column: DatasetColumn): ColumnDef<TableRowData> =>
  columnHelper.accessor((row) => row.dataset[column.id], {
    id: `dataset.${column.id}`,
    header: () => (
      <HStack gap={1}>
        <ColumnTypeIcon type={column.type} />
        <Text fontSize="13px" fontWeight="medium">
          {column.name}
        </Text>
      </HStack>
    ),
    cell: (info) => info.getValue(),
    size: DATASET_COL_DEFAULT_PCT,
    minSize: 8,
    meta: { columnType: "dataset" as ColumnType, columnId: column.id, dataType: column.type },
  }) as ColumnDef<TableRowData>;

/** A target column. Phantom empty rows render nothing: there is no input to run it on. */
const targetColumn = ({
  columnHelper,
  targetId,
  isComparison,
}: {
  columnHelper: Helper;
  targetId: string;
  isComparison: boolean;
}): ColumnDef<TableRowData> =>
  columnHelper.accessor((row) => row.targets[targetId], {
    id: `target.${targetId}`,
    header: (context) => <TargetHeaderFromMeta targetId={targetId} context={context} />,
    cell: (info) =>
      info.row.original.isEmpty ? null : (
        <TargetCellFromMeta
          targetId={targetId}
          data={info.getValue() as { output: unknown; evaluators: Record<string, unknown> }}
          rowIndex={info.row.index}
          tableMeta={metaOf(info.table.options.meta)}
        />
      ),
    size: isComparison ? COMPARISON_COL_DEFAULT_PCT : TARGET_COL_DEFAULT_PCT,
    minSize: isComparison ? COMPARISON_COL_MIN_PCT : 10,
    meta: { columnType: "target" as ColumnType, columnId: `target.${targetId}` },
  }) as ColumnDef<TableRowData>;

/**
 * A fully configured comparison's own result column, after every target column.
 * The orchestrator anchors its results on the first variant's cell.
 */
const comparisonColumn = (
  columnHelper: Helper,
  comparisonEvaluator: EvaluatorConfig,
): ColumnDef<TableRowData> => {
  const evaluatorId = comparisonEvaluator.id;
  const variantIds = toComparisonConfig(comparisonEvaluator)?.variants ?? [];
  const anchorVariantId = variantIds[0] ?? "";
  return columnHelper.accessor((row) => row.targets[anchorVariantId]?.evaluators[evaluatorId], {
    id: `comparison.${evaluatorId}`,
    header: (context) => (
      <ComparisonColumnHeader
        evaluatorId={evaluatorId}
        name={
          metaOf(context.table.options.meta)?.evaluatorsMap.get(evaluatorId)?.localEvaluatorConfig
            ?.name ?? "Comparison"
        }
      />
    ),
    cell: (info) => {
      if (info.row.original.isEmpty) return null;
      const meta = metaOf(info.table.options.meta);
      return (
        <ComparisonCell
          result={info.getValue()}
          isLoading={info.row.original.targets[anchorVariantId]?.isLoading}
          variantTargets={variantIds.map((id) => meta?.targetsMap.get(id))}
        />
      );
    },
    size: COMPARISON_COL_DEFAULT_PCT,
    minSize: COMPARISON_COL_MIN_PCT,
    meta: { columnType: "comparison" as ColumnType, columnId: `comparison.${evaluatorId}` },
  }) as ColumnDef<TableRowData>;
};

/** The checkbox, dataset, target and comparison columns, in that order. */
export const workbenchColumns = ({
  columnHelper,
  datasetColumns,
  targetIds,
  comparisonTargetIds,
  comparisonEvaluators,
}: {
  columnHelper: Helper;
  datasetColumns: DatasetColumn[];
  targetIds: string[];
  comparisonTargetIds: Set<string>;
  comparisonEvaluators: EvaluatorConfig[];
}): ColumnDef<TableRowData>[] => [
  checkboxColumn(columnHelper),
  ...datasetColumns.map((column) => datasetColumn(columnHelper, column)),
  ...targetIds.map((targetId) =>
    targetColumn({ columnHelper, targetId, isComparison: comparisonTargetIds.has(targetId) }),
  ),
  ...comparisonEvaluators.map((evaluator) => comparisonColumn(columnHelper, evaluator)),
];

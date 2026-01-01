/**
 * Wrapper components that read from TanStack Table's meta object.
 * These keep column definitions stable by avoiding closures over dynamic data.
 */
import { Checkbox } from "@chakra-ui/react";
import type { HeaderContext } from "@tanstack/react-table";

import type { TableRowData, TableMeta } from "../types";
import { RunnerHeader } from "./RunnerSection/RunnerHeader";
import { RunnerCellContent } from "./RunnerSection/RunnerCell";

/**
 * Checkbox header that reads selection state from table meta.
 */
export const CheckboxHeaderFromMeta = ({
  context,
}: {
  context: HeaderContext<TableRowData, unknown>;
}) => {
  const meta = context.table.options.meta as TableMeta | undefined;
  if (!meta) return null;

  return (
    <Checkbox.Root
      checked={
        meta.allSelected ? true : meta.someSelected ? "indeterminate" : false
      }
      onCheckedChange={() => {
        if (meta.allSelected) {
          meta.clearRowSelection();
        } else {
          meta.selectAllRows(meta.rowCount);
        }
      }}
    >
      <Checkbox.HiddenInput />
      <Checkbox.Control />
    </Checkbox.Root>
  );
};

/**
 * Checkbox cell that reads selection state from table meta.
 */
export const CheckboxCellFromMeta = ({
  rowIndex,
  tableMeta,
}: {
  rowIndex: number;
  tableMeta: TableMeta | undefined;
}) => {
  if (!tableMeta) return null;

  return (
    <Checkbox.Root
      checked={tableMeta.selectedRows.has(rowIndex)}
      onCheckedChange={() => tableMeta.toggleRowSelection(rowIndex)}
      onClick={(e) => e.stopPropagation()}
    >
      <Checkbox.HiddenInput />
      <Checkbox.Control />
    </Checkbox.Root>
  );
};

/**
 * Wrapper component for RunnerHeader that reads from table meta.
 * This allows us to have stable column definitions that don't change
 * when runner data changes, preventing unnecessary remounts.
 */
export const RunnerHeaderFromMeta = ({
  runnerId,
  context,
}: {
  runnerId: string;
  context: HeaderContext<TableRowData, unknown>;
}) => {
  const meta = context.table.options.meta as TableMeta | undefined;
  const runner = meta?.runnersMap.get(runnerId);

  if (!runner) return null;

  return (
    <RunnerHeader
      runner={runner}
      onEdit={meta?.handleEditRunner}
      onRemove={meta?.handleRemoveRunner}
    />
  );
};

/**
 * Wrapper component for RunnerCellContent that reads from table meta.
 */
export const RunnerCellFromMeta = ({
  runnerId,
  data,
  rowIndex,
  tableMeta,
}: {
  runnerId: string;
  data: { output: unknown; evaluators: Record<string, unknown> } | undefined;
  rowIndex: number;
  tableMeta: TableMeta | undefined;
}) => {
  const runner = tableMeta?.runnersMap.get(runnerId);

  if (!runner) return null;

  return (
    <RunnerCellContent
      runner={runner}
      output={data?.output}
      evaluatorResults={data?.evaluators ?? {}}
      row={rowIndex}
      evaluatorsMap={tableMeta?.evaluatorsMap ?? new Map()}
      onAddEvaluator={tableMeta?.handleAddEvaluatorForRunner}
    />
  );
};

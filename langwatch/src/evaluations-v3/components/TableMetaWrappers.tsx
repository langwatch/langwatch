/**
 * Wrapper components that read from TanStack Table's meta object.
 * These keep column definitions stable by avoiding closures over dynamic data.
 */
import { Checkbox } from "@chakra-ui/react";
import type { HeaderContext } from "@tanstack/react-table";

import type { TableMeta, TableRowData } from "../types";
import { TargetCellContent } from "./TargetSection/TargetCell";
import { TargetHeader } from "./TargetSection/TargetHeader";

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
 * Wrapper component for TargetHeader that reads from table meta.
 * This allows us to have stable column definitions that don't change
 * when target data changes, preventing unnecessary remounts.
 */
export const TargetHeaderFromMeta = ({
  targetId,
  context,
}: {
  targetId: string;
  context: HeaderContext<TableRowData, unknown>;
}) => {
  const meta = context.table.options.meta as TableMeta | undefined;
  const target = meta?.targetsMap.get(targetId);

  if (!target) return null;

  return (
    <TargetHeader
      target={target}
      onEdit={meta?.openTargetEditor}
      onRemove={meta?.handleRemoveTarget}
    />
  );
};

/**
 * Wrapper component for TargetCellContent that reads from table meta.
 */
export const TargetCellFromMeta = ({
  targetId,
  data,
  rowIndex,
  tableMeta,
}: {
  targetId: string;
  data: { output: unknown; evaluators: Record<string, unknown> } | undefined;
  rowIndex: number;
  tableMeta: TableMeta | undefined;
}) => {
  const target = tableMeta?.targetsMap.get(targetId);

  if (!target) return null;

  return (
    <TargetCellContent
      target={target}
      output={data?.output}
      evaluatorResults={data?.evaluators ?? {}}
      row={rowIndex}
      onAddEvaluator={tableMeta?.handleAddEvaluator}
    />
  );
};

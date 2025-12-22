import type { DataGridColumnDef } from "~/components/ui/datagrid";
import type { TraceRow } from "./types";
import {
  TraceArrowCell,
  TraceIdCell,
  TraceTimestampCell,
  TraceTextCell,
  TraceTokensCell,
  TraceCostCell,
  TraceMetadataCell,
} from "./cells/TraceCells";
import { createColumnHelper } from "@tanstack/react-table";

const columnHelper = createColumnHelper<TraceRow>();

/**
 * Creates trace column definitions for the nested DataGrid in expanded rows
 * Uses TanStack's columnHelper for type-safe column definitions
 */
export function createTraceColumns(): DataGridColumnDef<TraceRow>[] {
  return [
    columnHelper.display({
      id: "arrow",
      header: "",
      size: 40,
      enableSorting: false,
      enableColumnFilter: false,
      cell: TraceArrowCell,
    }),
    columnHelper.accessor("traceId", {
      header: "Trace ID",
      size: 120,
      enableSorting: false,
      enableColumnFilter: false,
      cell: TraceIdCell,
    }),
    columnHelper.accessor("timestamp", {
      header: "Timestamp",
      size: 160,
      enableSorting: false,
      enableColumnFilter: false,
      cell: TraceTimestampCell,
    }),
    columnHelper.accessor("input", {
      header: "Input",
      size: 250,
      enableSorting: false,
      enableColumnFilter: false,
      cell: TraceTextCell,
    }),
    columnHelper.accessor("output", {
      header: "Output",
      size: 250,
      enableSorting: false,
      enableColumnFilter: false,
      cell: TraceTextCell,
    }),
    columnHelper.accessor("totalTokens", {
      header: "Tokens",
      size: 80,
      enableSorting: false,
      enableColumnFilter: false,
      cell: TraceTokensCell,
    }),
    columnHelper.accessor("totalCost", {
      header: "Cost",
      size: 80,
      enableSorting: false,
      enableColumnFilter: false,
      cell: TraceCostCell,
    }),
    columnHelper.accessor("metadata", {
      header: "Metadata",
      size: 200,
      enableSorting: false,
      enableColumnFilter: false,
      cell: TraceMetadataCell,
    }),
  ];
}

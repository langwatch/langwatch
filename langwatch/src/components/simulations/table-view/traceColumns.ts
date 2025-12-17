import type { DataGridColumnDef } from "~/components/ui/datagrid";
import type { TraceRow } from "./types";
import {
  TraceIdCell,
  TraceTimestampCell,
  TraceTextCell,
  TraceTokensCell,
  TraceCostCell,
} from "./cells/TraceCells";

/**
 * Creates trace column definitions for the nested DataGrid in expanded rows
 */
export function createTraceColumns(): DataGridColumnDef<TraceRow>[] {
  return [
    {
      id: "traceId",
      header: "Trace ID",
      accessorKey: "traceId",
      cell: TraceIdCell,
      filterable: false,
      sortable: false,
      defaultVisible: true,
      width: 120,
    },
    {
      id: "timestamp",
      header: "Timestamp",
      accessorKey: "timestamp",
      cell: TraceTimestampCell,
      filterable: false,
      sortable: false,
      defaultVisible: true,
      width: 160,
    },
    {
      id: "input",
      header: "Input",
      accessorKey: "input",
      cell: TraceTextCell,
      filterable: false,
      sortable: false,
      defaultVisible: true,
      width: 250,
    },
    {
      id: "output",
      header: "Output",
      accessorKey: "output",
      cell: TraceTextCell,
      filterable: false,
      sortable: false,
      defaultVisible: true,
      width: 250,
    },
    {
      id: "totalTokens",
      header: "Tokens",
      accessorKey: "totalTokens",
      cell: TraceTokensCell,
      filterable: false,
      sortable: false,
      defaultVisible: true,
      width: 80,
    },
    {
      id: "totalCost",
      header: "Cost",
      accessorKey: "totalCost",
      cell: TraceCostCell,
      filterable: false,
      sortable: false,
      defaultVisible: true,
      width: 80,
    },
  ];
}

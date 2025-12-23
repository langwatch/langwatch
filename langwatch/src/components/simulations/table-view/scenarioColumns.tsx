import type { DataGridColumnDef } from "~/components/ui/datagrid";
import type { ScenarioRunRow } from "./types";
import { ScenarioSetCell } from "./cells/ScenarioSetCell";
import { createColumnHelper } from "@tanstack/react-table";
import { DurationCell,
StatusCell, TimestampCell, VerdictCell } from "./cells";
import { TracesListCell } from "./cells/TraceCells";

const columnHelper = createColumnHelper<ScenarioRunRow>();

/**
 * Creates scenario column definitions for the DataGrid
 * Uses TanStack's columnHelper for type-safe column definitions
 * @param projectSlug - The project slug for generating links
 */
export function createScenarioColumns()  {
  return [
    columnHelper.accessor("status", {
      header: "",
      size: 40,
      enableSorting: false,
      enableColumnFilter: false,
      cell: StatusCell,
      enableHiding: false,
      enableGrouping: false,
    }),
    columnHelper.accessor("name", {
      header: "Scenario Name",
      enableSorting: true,
      enableColumnFilter: true,
      enableGrouping: true,
    }),
    columnHelper.accessor("description", {
      header: "Description",
      enableSorting: false,
      enableColumnFilter: false,
      enableGrouping: false,
      cell: info => info.getValue() || "",
    }),
    columnHelper.accessor("messages", {
      header: "Messages",
      enableSorting: false,
      enableColumnFilter: false,
      enableGrouping: false,
      cell: info => info.getValue().map((message: ScenarioMessageSnapshotEvent["messages"][0]) => message.content).join("\n"),
    }),
    columnHelper.accessor("scenarioSetId", {
      header: "Set Id",
      enableSorting: true,
      enableColumnFilter: true,
      enableGrouping: true,
      cell: ScenarioSetCell,
    }),
    columnHelper.accessor("batchRunId", {
      header: "Batch Run",
      enableSorting: true,
      enableColumnFilter: true,
      enableGrouping: false,
    }),
    columnHelper.accessor("results.verdict", {
      header: "Verdict",
      enableSorting: true,
      enableColumnFilter: true,
      cell: VerdictCell,
      enableGrouping: false,
    }),
    columnHelper.accessor("results.reasoning", {
      header: "Reasoning",
      enableSorting: false,
      enableColumnFilter: false,
      enableGrouping: false,
      cell: info => info.getValue() || "",
    }),
    columnHelper.accessor("results.metCriteria", {
      id: "results.metCriteria",
      header: "Met Criteria",
      enableSorting: false,
      enableColumnFilter: false,
      enableGrouping: false,
      cell: info => Array.isArray(info.getValue()) ? info.getValue().join(", ") : "",
    }),
    columnHelper.accessor("results.unmetCriteria", {
      id: "results.unmetCriteria",
      header: "Unmet Criteria",
      enableSorting: false,
      enableColumnFilter: false,
      enableGrouping: false,
      cell: info => Array.isArray(info.getValue()) ? info.getValue().join(", ") : "",
    }),
    columnHelper.accessor("results.error", {
      id: "results.error",
      header: "Error",
      enableSorting: false,
      enableColumnFilter: false,
      enableGrouping: false,
      cell: info => info.getValue() || "",
    }),
    columnHelper.accessor("timestamp", {
      header: "Date",
      enableSorting: true,
      enableColumnFilter: true,
      cell: TimestampCell,
      enableGrouping: false,
      aggregatedCell: ''
    }),
    columnHelper.accessor("durationInMs", {
      header: "Duration",
      enableColumnFilter: false,
      cell: DurationCell,
      aggregatedCell: '',
    }),
    columnHelper.accessor("scenarioId", {
      header: "Scenario ID",
      enableSorting: true,
      enableColumnFilter: true,
      enableGrouping: false,
    }),
    columnHelper.accessor("scenarioRunId", {
      header: "Run ID",
      enableSorting: false,
      enableColumnFilter: true,
      enableGrouping: false,
    }),
    columnHelper.accessor("metadata.traces", {
      id: "metadata.traces",
      header: "Traces",
      enableSorting: false,
      enableColumnFilter: false,
      enableGrouping: false,
      cell: TracesListCell,
    }),
    // columnHelper.display({
    //   id: "actions",
    //   header: "",
    //   size: 50,
    //   enableSorting: false,
    //   enableColumnFilter: false,
    //   cell: ActionsCell,
    //   enableHiding: false,
    //   enableGrouping: false,
    // }),
  ];
}

/**
 * Generates dynamic columns from trace metadata keys
 * @param metadataKeys - Array of metadata key names
 */
export function generateDynamicColumns(
  metadataKeys: string[]
): DataGridColumnDef<ScenarioRunRow>[] {
  return metadataKeys.map((key) =>
    columnHelper.accessor(`metadata.${key}` as keyof ScenarioRunRow, {
      id: `metadata.${key}`,
      header: key,
      enableSorting: true,
      enableColumnFilter: true,
    })
  );
}

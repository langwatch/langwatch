import type { DataGridColumnDef } from "~/components/ui/datagrid";
import { ScenarioRunStatus, Verdict } from "~/app/api/scenario-events/[[...route]]/enums";
import type { ScenarioRunRow } from "./types";
import { ScenarioSetCell } from "./cells/ScenarioSetCell";

/**
 * Creates scenario column definitions for the DataGrid
 * @param projectSlug - The project slug for generating links
 */
export function createScenarioColumns(
  projectSlug: string
): DataGridColumnDef<ScenarioRunRow>[] {
  return [
    {
      id: "status",
      header: "",
      accessorKey: "status",
      filterable: false,
      sortable: false,
      defaultVisible: true,
      width: 40,
    },
    {
      id: "name",
      header: "Scenario Name",
      accessorKey: "name",
      filterable: true,
      filterType: "text",
      sortable: true,
      groupable: true,
      defaultVisible: true,
    },
    {
      id: "scenarioSetId",
      header: "Scenario Set",
      accessorKey: "scenarioSetId",
      cell: ScenarioSetCell,
      linkTo: (row) => `/${projectSlug}/simulations/${row.scenarioSetId}`,
      filterable: true,
      filterType: "text",
      sortable: true,
      groupable: true,
      defaultVisible: true,
    },
    {
      id: "batchRunId",
      header: "Batch Run",
      accessorKey: "batchRunId",
      linkTo: (row) =>
        `/${projectSlug}/simulations/${row.scenarioSetId}/${row.batchRunId}`,
      filterable: true,
      filterType: "text",
      sortable: true,
      defaultVisible: false,
    },
    {
      id: "verdict",
      header: "Verdict",
      accessorKey: "verdict",
      filterable: true,
      filterType: "enum",
      enumValues: Object.values(Verdict),
      enumLabels: {
        [Verdict.SUCCESS]: "Pass",
        [Verdict.FAILURE]: "Fail",
        [Verdict.INCONCLUSIVE]: "Inconclusive",
      },
      sortable: true,
      groupable: true,
      defaultVisible: true,
    },
    {
      id: "timestamp",
      header: "Date",
      accessorKey: "timestamp",
      filterable: true,
      filterType: "date",
      sortable: true,
      defaultSort: "desc",
      defaultVisible: true,
    },
    {
      id: "durationInMs",
      header: "Duration",
      accessorKey: "durationInMs",
      filterable: false,
      sortable: false,
      defaultVisible: true,
    },
    {
      id: "scenarioId",
      header: "Scenario ID",
      accessorKey: "scenarioId",
      filterable: true,
      filterType: "text",
      sortable: true,
      defaultVisible: false,
    },
    {
      id: "scenarioRunId",
      header: "Run ID",
      accessorKey: "scenarioRunId",
      filterable: true,
      filterType: "text",
      sortable: false,
      defaultVisible: false,
    },
    {
      id: "actions",
      header: "",
      accessorKey: "scenarioRunId", // Dummy accessor
      filterable: false,
      sortable: false,
      defaultVisible: true,
      hideable: false, // Always visible
      width: 50,
    },
  ];
}

/**
 * Generates dynamic columns from trace metadata keys
 * @param metadataKeys - Array of metadata key names
 */
export function generateDynamicColumns(
  metadataKeys: string[]
): DataGridColumnDef<ScenarioRunRow>[] {
  return metadataKeys.map((key) => ({
    id: `metadata.${key}`,
    header: key,
    accessorKey: `metadata.${key}`,
    filterable: true,
    filterType: "text" as const,
    sortable: true,
    defaultVisible: false,
  }));
}

import { useCallback } from "react";
import { toaster } from "~/components/ui/toaster";
import { createLogger } from "~/utils/logger";
import Parse from "papaparse";
import type { Table } from "@tanstack/react-table";
import type { ScenarioRunRow } from "~/components/simulations/table-view/types";

const logger = createLogger("useExportScenarioRuns");

/**
 * Formats a value for CSV export based on column ID and value type
 */
function formatValueForExport(columnId: string, value: unknown): string {
  // Format timestamp as ISO string
  if (columnId === "timestamp" && typeof value === "number") {
    return new Date(value).toISOString();
  }
  
  // Format duration as seconds
  if (columnId === "durationInMs" && typeof value === "number") {
    return `${(value / 1000).toFixed(2)}s`;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  
  // Handle objects
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }

  return value != null ? String(value) : "";
}

export function useExportScenarioRuns() {
  const downloadCsv = useCallback(async (table: Table<ScenarioRunRow>) => {
    try {
      // Get all scenario runs from the table's core model (unfiltered, unpaginated)
      const scenarioRuns = table.getCoreRowModel().rows.map(row => row.original);

      // Get headers from visible columns
      const headers = table
        .getHeaderGroups()
        .flatMap((headerGroup) =>
          headerGroup.headers
            .filter((header) => header.column.getIsVisible())
            .map((header) => header.column.columnDef.header as string)
        );

      // Export ALL rows from scenarioRuns, not just the paginated table rows
      const rows = scenarioRuns.map((row) => {
        return table
          .getAllColumns()
          .filter((col) => col.getIsVisible())
          .map((col) => {
            // Use the column's accessorFn to get the value
            const rawValue = col.accessorFn
              ? col.accessorFn(row, 0)
              : (row as any)[col.id];

            return formatValueForExport(col.id, rawValue);
          });
      });

      const csvBlob = Parse.unparse({
        fields: headers,
        data: rows,
      });

      const url = window.URL.createObjectURL(new Blob([csvBlob]));
      const link = document.createElement("a");
      link.href = url;
      const formattedDate = new Date().toISOString().split("T")[0];
      const fileName = `${formattedDate}_scenario_runs.csv`;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      logger.error("Export failed", error);
      toaster.error({
        title: "Export failed",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  return { downloadCsv };
}

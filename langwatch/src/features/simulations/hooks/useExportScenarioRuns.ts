import { api } from "~/utils/api";
import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { DataGridState } from "~/components/ui/datagrid/types";
import { toaster } from "~/components/ui/toaster";
import { createLogger } from "~/utils/logger";
import type { DataGridStore } from "~/components/ui/datagrid/useDataGridStore.v2";

const logger = createLogger("useExportScenarioRuns");

interface ExportParams {
  filters: DataGridStore['columnFilters'];
  sorting: DataGridStore['sorting'];
  pagination: DataGridStore['pagination'];
  grouping: DataGridStore['grouping'];
  globalFilter: DataGridStore['globalFilter'];
}

export function useExportScenarioRuns() {
  const { project } = useOrganizationTeamProject();
  const trpc = api.useContext();

  // Export handler - exports ALL filtered data with visible columns
  const downloadCsv = useCallback(async (params: DataGridState) => {
    if (!project?.id) return;

    try {
      // Call tRPC export mutation with current filters, sorting, and visible columns
      const result = await trpc.scenarios.exportScenariosCsv.fetch(params);

      // Download the CSV
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      logger.error("Export failed", error);
      toaster.error("Export failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [project?.id]);

  return { downloadCsv };
}

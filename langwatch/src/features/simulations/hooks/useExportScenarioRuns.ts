import { useCallback } from "react";
import { toaster } from "~/components/ui/toaster";
import { createLogger } from "~/utils/logger";
import exportToCsv from "tanstack-table-export-to-csv";


const logger = createLogger("useExportScenarioRuns");

type CsvLike = {
  headers: Parameters<typeof exportToCsv>[1];
  rows: Parameters<typeof exportToCsv>[2];
}

export function useExportScenarioRuns() {
  const downloadCsv = useCallback(async (params: { data: CsvLike }) => {
    try {
      exportToCsv('scenario_runs' + new Date().toISOString() + '.csv', params.data.headers, params.data.rows);
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

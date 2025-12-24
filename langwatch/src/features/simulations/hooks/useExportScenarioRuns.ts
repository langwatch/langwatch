import { useCallback } from "react";
import { toaster } from "~/components/ui/toaster";
import { createLogger } from "~/utils/logger";
import Parse from "papaparse";

const logger = createLogger("useExportScenarioRuns");

export function useExportScenarioRuns() {
  const downloadCsv = useCallback(async (params: { 
    headers: string[], 
    rows: any[][] 
  }) => {
    try {
      const csvBlob = Parse.unparse({
        fields: params.headers,
        data: params.rows,
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

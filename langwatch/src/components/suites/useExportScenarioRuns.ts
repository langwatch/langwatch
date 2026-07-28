import { useCallback, useRef, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import type {
  ScenarioRunExportMode,
  ScenarioRunExportStatusFilter,
} from "~/server/export/scenario-runs/types";

/**
 * Orchestrates the scenario run CSV export: dialog state, the streaming
 * download, and cancellation.
 *
 * The scope passed in is whatever the panel is currently showing — set,
 * scenario, pass/fail and date range — so the file always matches the list the
 * user was looking at when they clicked Export.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */
export function useExportScenarioRuns({
  projectId,
  scenarioSetId,
  scenarioId,
  passFailStatus,
  startDate,
  endDate,
}: {
  projectId: string | undefined;
  scenarioSetId?: string;
  scenarioId?: string;
  passFailStatus?: ScenarioRunExportStatusFilter;
  startDate?: number;
  endDate?: number;
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const openExportDialog = useCallback(() => setIsDialogOpen(true), []);
  const closeExportDialog = useCallback(() => setIsDialogOpen(false), []);

  const cancelExport = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsExporting(false);
  }, []);

  const startExport = useCallback(
    ({ mode }: { mode: ScenarioRunExportMode }) => {
      if (!projectId) return;

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsDialogOpen(false);
      setIsExporting(true);

      const today = new Date().toISOString().split("T")[0];
      const fallbackFilename = `${projectId} - Scenario Runs - ${today} - ${mode}.csv`;

      void fetch("/api/export/scenario-runs/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          mode,
          ...(scenarioSetId ? { scenarioSetId } : {}),
          ...(scenarioId ? { scenarioId } : {}),
          ...(passFailStatus ? { passFailStatus } : {}),
          ...(startDate !== undefined ? { startDate } : {}),
          ...(endDate !== undefined ? { endDate } : {}),
        }),
        signal: abortController.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Export failed: ${response.status}`);
          }
          const blob = await response.blob();
          if (blob.size === 0) {
            toaster.create({
              title: "Export produced no data",
              description:
                "No runs matched the current filters. Try widening the date range.",
              type: "warning",
            });
            return;
          }
          triggerBlobDownload({
            blob,
            filename: extractFilename({
              contentDisposition: response.headers.get("Content-Disposition"),
              fallbackName: fallbackFilename,
            }),
          });
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          toaster.create({
            title: "Export failed",
            description:
              error instanceof Error ? error.message : "Unknown error",
            type: "error",
          });
        })
        .finally(() => {
          if (abortControllerRef.current === abortController) {
            abortControllerRef.current = null;
            setIsExporting(false);
          }
        });
    },
    [projectId, scenarioSetId, scenarioId, passFailStatus, startDate, endDate],
  );

  return {
    isDialogOpen,
    openExportDialog,
    closeExportDialog,
    isExporting,
    startExport,
    cancelExport,
  };
}

function triggerBlobDownload({
  blob,
  filename,
}: {
  blob: Blob;
  filename: string;
}): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function extractFilename({
  contentDisposition,
  fallbackName,
}: {
  contentDisposition: string | null;
  fallbackName: string;
}): string {
  if (!contentDisposition) return fallbackName;
  const match = contentDisposition.match(
    /filename\*?=(?:UTF-8''|")?([^";]+)"?/i,
  );
  return match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
}

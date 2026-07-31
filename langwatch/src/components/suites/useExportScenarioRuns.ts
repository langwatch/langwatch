import { useCallback, useRef, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import type { ExportProgressEvent } from "~/server/api/routers/export";
import type {
  ScenarioRunExportMode,
  ScenarioRunExportStatusFilter,
} from "~/server/export/scenario-runs/types";
import { api } from "~/utils/api";

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
  /**
   * Runs visited so far, against the total the server reported in
   * X-Total-Runs. Counted in runs rather than written rows because criteria
   * mode emits several rows per run.
   */
  const [progress, setProgress] = useState<{ exported: number; total: number }>(
    {
      exported: 0,
      total: 0,
    },
  );
  /**
   * Set from the X-Export-Id response header once the stream starts. The
   * server broadcasts progress over Redis rather than in the response body
   * because the body is the file itself — it goes to disk, so the only way to
   * report a count is out of band.
   */
  const [exportId, setExportId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  api.export.onScenarioRunExportProgress.useSubscription(
    { projectId: projectId!, exportId: exportId! },
    {
      enabled: isExporting && !!exportId && !!projectId,
      onData: (event: ExportProgressEvent) => {
        if (event.exported !== undefined) {
          setProgress((prev) => ({
            exported: event.exported ?? prev.exported,
            total: event.total ?? prev.total,
          }));
        }
      },
    },
  );

  const openExportDialog = useCallback(() => setIsDialogOpen(true), []);
  const closeExportDialog = useCallback(() => setIsDialogOpen(false), []);

  const cancelExport = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsExporting(false);
    setProgress({ exported: 0, total: 0 });
    setExportId(null);
  }, []);

  const startExport = useCallback(
    ({ mode }: { mode: ScenarioRunExportMode }) => {
      if (!projectId) return;

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsDialogOpen(false);
      setIsExporting(true);
      setProgress({ exported: 0, total: 0 });
      setExportId(null);

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
          // The server knows the total before it streams a byte, so the bar
          // has a denominator immediately rather than after the first chunk.
          const total = Number(response.headers.get("X-Total-Runs") ?? "0");
          setProgress({ exported: 0, total });
          // Activating the subscription here rather than before the fetch: the
          // id only exists once the server has accepted the request.
          setExportId(response.headers.get("X-Export-Id"));
          const blob = await response.blob();
          setProgress({ exported: total, total });
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
            setExportId(null);
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
    progress,
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

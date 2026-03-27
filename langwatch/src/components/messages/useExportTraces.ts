import { useCallback, useRef, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import type { ExportMode, ExportFormat, ExportProgress } from "~/server/export/types";
import type { ExportProgressEvent } from "~/server/api/routers/export";
import { api } from "~/utils/api";

interface ExportConfig {
  mode: ExportMode;
  format: ExportFormat;
}

interface UseExportTracesOptions {
  projectId: string | undefined;
  /** Filters currently applied to the trace list */
  filters?: Record<string, unknown>;
  /** Start of the time range (epoch ms) */
  startDate?: number;
  /** End of the time range (epoch ms) */
  endDate?: number;
  /** Free-text search query */
  query?: string;
}

interface UseExportTracesReturn {
  /** Whether the config dialog is open */
  isDialogOpen: boolean;
  /** Open the export dialog, optionally scoped to selected trace IDs */
  openExportDialog: (options?: { selectedTraceIds?: string[] }) => void;
  /** Close the export dialog */
  closeExportDialog: () => void;

  /** Whether an export is currently streaming */
  isExporting: boolean;
  /** Current progress of the export */
  progress: ExportProgress;

  /** Start the export with the given config (called from the dialog) */
  startExport: (config: ExportConfig) => void;
  /** Cancel the in-progress export */
  cancelExport: () => void;
}

/**
 * Triggers a browser download from a Blob and a filename.
 * Creates a temporary anchor element and clicks it.
 */
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

/**
 * Extracts a filename from a Content-Disposition header.
 * Falls back to a generated name if the header is missing.
 */
function extractFilename({
  contentDisposition,
  fallbackName,
}: {
  contentDisposition: string | null;
  fallbackName: string;
}): string {
  if (!contentDisposition) return fallbackName;

  const filenameMatch = contentDisposition.match(
    /filename\*?=(?:UTF-8''|")?([^";]+)"?/i
  );
  if (filenameMatch?.[1]) {
    return decodeURIComponent(filenameMatch[1]);
  }

  return fallbackName;
}

/**
 * Hook that orchestrates the trace export flow:
 * dialog state, file download streaming, tRPC subscription progress updates, and cancellation.
 *
 * The export uses two connections:
 * 1. A POST to `/api/export/traces/download` that streams the file data
 * 2. A tRPC subscription via BroadcastService for real-time progress (works across K8s pods)
 *
 * The tRPC subscription is activated when the download response headers arrive,
 * providing the exportId via the X-Export-Id header.
 *
 * @see specs/traces/trace-export.feature
 */
export function useExportTraces({
  projectId,
  filters,
  startDate,
  endDate,
  query,
}: UseExportTracesOptions): UseExportTracesReturn {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress>({
    exported: 0,
    total: 0,
  });
  const [selectedTraceIds, setSelectedTraceIds] = useState<
    string[] | undefined
  >();
  const [currentExportId, setCurrentExportId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // tRPC subscription for export progress via BroadcastService (Redis pub/sub)
  api.export.onExportProgress.useSubscription(
    { projectId: projectId!, exportId: currentExportId! },
    {
      enabled: isExporting && !!currentExportId && !!projectId,
      onData: (event: ExportProgressEvent) => {
        if (event.exported !== undefined) {
          setProgress({
            exported: event.exported,
            total: event.total ?? progress.total,
          });
        }
        if (event.type === "done") {
          setProgress((prev) => ({
            ...prev,
            exported: prev.total,
          }));
        }
      },
    }
  );

  const openExportDialog = useCallback(
    (options?: { selectedTraceIds?: string[] }) => {
      setSelectedTraceIds(options?.selectedTraceIds);
      setIsDialogOpen(true);
    },
    []
  );

  const closeExportDialog = useCallback(() => {
    setIsDialogOpen(false);
    setSelectedTraceIds(undefined);
  }, []);

  const cancelExport = useCallback(() => {
    if (completionTimeoutRef.current) {
      clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsExporting(false);
    setProgress({ exported: 0, total: 0 });
    setCurrentExportId(null);
  }, []);

  const startExport = useCallback(
    (config: ExportConfig) => {
      if (!projectId) {
        toaster.create({
          title: "Export failed",
          description: "No project selected",
          type: "error",
        });
        return;
      }

      // Cancel any stale completion timeout from a previous export
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }

      // Abort any in-flight export
      abortControllerRef.current?.abort();

      // Close the dialog when export starts
      setIsDialogOpen(false);
      setIsExporting(true);
      setProgress({ exported: 0, total: 0 });

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const requestBody = {
        projectId,
        mode: config.mode,
        format: config.format,
        filters,
        startDate,
        endDate,
        ...(query ? { query } : {}),
        ...(selectedTraceIds ? { traceIds: selectedTraceIds } : {}),
      };

      const fileExtension = config.format === "json" ? "jsonl" : "csv";
      const today = new Date().toISOString().split("T")[0];
      const fallbackFilename = `${projectId} - Traces - ${today} - ${config.mode}.${fileExtension}`;

      // Capture this controller to detect staleness in async handlers.
      // If a new export starts, abortControllerRef.current will change,
      // so comparing against thisController tells us this export is stale.
      const thisController = abortController;

      // Start the file download stream and track progress from both:
      // 1. X-Total-Traces header (immediate total count)
      // 2. tRPC subscription via BroadcastService (real-time exported count)
      const exportPromise = fetch("/api/export/traces/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              `Export failed: ${response.status} ${response.statusText}`
            );
          }

          // Read total from header immediately
          const totalTraces = parseInt(
            response.headers.get("X-Total-Traces") ?? "0",
            10
          );
          setProgress((prev) => ({ ...prev, total: totalTraces }));

          // Activate tRPC subscription for real-time progress
          const exportId = response.headers.get("X-Export-Id");
          if (exportId) {
            setCurrentExportId(exportId);
          }

          const blob = await response.blob();
          const filename = extractFilename({
            contentDisposition: response.headers.get("Content-Disposition"),
            fallbackName: fallbackFilename,
          });

          triggerBlobDownload({ blob, filename });

          return true;
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") {
            return false; // User cancelled, not an error
          }
          const message =
            error instanceof Error ? error.message : "Unknown error";
          toaster.create({
            title: "Export failed",
            description: message,
            type: "error",
          });
          return false;
        });

      // When download completes, show "done" state briefly then hide.
      // Only update state if this export is still the active one —
      // a newer export will have replaced abortControllerRef.current.
      void exportPromise.then((completed) => {
        if (abortControllerRef.current !== thisController) return;

        if (!completed) {
          setIsExporting(false);
          setProgress({ exported: 0, total: 0 });
          setCurrentExportId(null);
          return;
        }
        setProgress((prev) => ({ ...prev, exported: prev.total }));
        // Brief flash of "complete" state before hiding
        completionTimeoutRef.current = setTimeout(() => {
          setIsExporting(false);
          setProgress({ exported: 0, total: 0 });
          setCurrentExportId(null);
        }, 1500);
      });
    },
    [projectId, filters, startDate, endDate, query, selectedTraceIds]
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

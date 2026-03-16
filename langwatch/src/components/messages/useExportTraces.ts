import { useCallback, useRef, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import type { ExportMode, ExportFormat, ExportProgress } from "~/server/export/types";

interface ExportConfig {
  mode: ExportMode;
  format: ExportFormat;
}

/** SSE progress event shape from the export API */
interface ExportProgressEvent {
  type: "progress" | "done" | "error";
  exported?: number;
  total?: number;
  message?: string;
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
 * Connect to the SSE progress endpoint for the given exportId.
 * Uses a GET fetch with streaming reader since the endpoint is GET-based.
 */
function connectProgressSSE({
  exportId,
  signal,
  onEvent,
}: {
  exportId: string;
  signal: AbortSignal;
  onEvent: (event: ExportProgressEvent) => void;
}): Promise<void> {
  return fetch(`/api/export/traces/progress/${exportId}`, {
    method: "GET",
    headers: { Accept: "text/event-stream" },
    signal,
  }).then(async (response) => {
    if (!response.ok || !response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data:")) {
          const dataStr = line.slice("data:".length).trim();
          if (!dataStr) continue;
          try {
            const event = JSON.parse(dataStr) as ExportProgressEvent;
            onEvent(event);
            if (event.type === "done" || event.type === "error") {
              reader.cancel().catch(() => {});
              return;
            }
          } catch {
            // Ignore malformed data lines
          }
        }
      }
    }
  }).catch(() => {
    // Progress SSE errors are non-fatal; the download may still complete
  });
}

/**
 * Hook that orchestrates the trace export flow:
 * dialog state, file download streaming, SSE progress updates, and cancellation.
 *
 * The export uses two connections:
 * 1. A POST to `/api/export/traces/download` that streams the file data
 * 2. A GET SSE connection to `/api/export/traces/progress/:exportId` for real-time progress
 *
 * The SSE connection starts after the download response headers arrive,
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

  const abortControllerRef = useRef<AbortController | null>(null);
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
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

      // Start the file download stream and track progress from both:
      // 1. X-Total-Traces header (immediate total count)
      // 2. SSE sideband (real-time exported count)
      // 3. Chunk-based tracking as fallback (count chunks * batch size)
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

          // Read total from header immediately (no SSE race condition)
          const totalTraces = parseInt(
            response.headers.get("X-Total-Traces") ?? "0",
            10
          );
          setProgress((prev) => ({ ...prev, total: totalTraces }));

          // Start SSE progress listener for real-time exported count
          const exportId = response.headers.get("X-Export-Id");
          if (exportId) {
            void connectProgressSSE({
              exportId,
              signal: abortController.signal,
              onEvent: (event) => {
                // Progress events have {exported, total} — no type field
                if (event.exported !== undefined) {
                  setProgress({
                    exported: event.exported,
                    total: event.total ?? totalTraces,
                  });
                }
                if (event.type === "done") {
                  setProgress((prev) => ({
                    ...prev,
                    exported: prev.total,
                  }));
                }
              },
            });
          }

          const blob = await response.blob();
          const filename = extractFilename({
            contentDisposition: response.headers.get("Content-Disposition"),
            fallbackName: fallbackFilename,
          });

          triggerBlobDownload({ blob, filename });

          // Download complete — abort SSE (fire-and-forget, don't wait)
          // The SSE may have already finished or may hang if it missed "done"
          abortController.abort();

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

      // When download completes, show "done" state briefly then hide
      void exportPromise.then((completed) => {
        if (!completed) {
          setIsExporting(false);
          setProgress({ exported: 0, total: 0 });
          return;
        }
        setProgress((prev) => ({ ...prev, exported: prev.total }));
        // Brief flash of "complete" state before hiding
        completionTimeoutRef.current = setTimeout(() => {
          setIsExporting(false);
          setProgress({ exported: 0, total: 0 });
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

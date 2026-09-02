import { useCallback, useRef, useState } from "react";
import { toaster } from "../../../blocks/toaster";
import { readHandledError, showErrorToast } from "../../errors";
import type { ExportProgressEvent } from "../../../../model/export-types";
import type { ExportFormat, ExportMode, ExportProgress } from "../../../../model/export-types";
import { api } from "../../trace-api";

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
function triggerBlobDownload({ blob, filename }: { blob: Blob; filename: string }): void {
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

  const filenameMatch = contentDisposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i);
  if (filenameMatch?.[1]) {
    return decodeURIComponent(filenameMatch[1]);
  }

  return fallbackName;
}

/**
 * The failure behind a non-OK download response, as something the shared error
 * reader understands.
 *
 * `/api/export/traces/download` answers a rejection with the flat handled body
 * — `{ error: "<code>", message, ...meta, trace }`, see
 * `src/app/api/middleware/error-handler.ts` — and that code is the entire
 * point: a payload too large, a rate limit and a gateway timeout are three
 * different things, and only the first two are worth retrying differently.
 * Synthesising `new Error("Export failed: 413 Payload Too Large")` threw all of
 * it away, and `showErrorToast` — handed an error with no handled payload on it
 * — answered every one of them with "We've been notified. Try again in a
 * moment."
 *
 * The body rides ON an `Error` rather than replacing it, so the throw stays an
 * Error (the `AbortError` check downstream depends on that) while
 * `readHandledError` still finds the flat REST payload hanging off it.
 *
 * A body carrying no recognisable code — an unhandled 500, or an ingress
 * answering HTML before the route ever ran — degrades to `export_failed`, the
 * registry's own code for an export that did not finish. That is already a far
 * better answer than the generic unknown, and it improves on its own the moment
 * the route names its rejections.
 */
async function exportRequestError(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  const payload = readHandledError(body)
    ? (body as Record<string, unknown>)
    : { error: "export_failed" };

  return Object.assign(
    new Error(`Trace export rejected with HTTP ${response.status}`),
    payload,
    // The flat body carries no status of its own — it IS the HTTP status,
    // which lives on the response rather than in it.
    { status: response.status },
  );
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
// Pre-existing: this file moved out of components/messages/ unchanged when the
// legacy Traces page was removed, and the new-violation gate compares by path,
// so a relocation reads as a brand-new file. Splitting these up is a separate
// change from moving them.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: relocated, not rewritten
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
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[] | undefined>();
  const [currentExportId, setCurrentExportId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    },
  );

  const openExportDialog = useCallback((options?: { selectedTraceIds?: string[] }) => {
    setSelectedTraceIds(options?.selectedTraceIds);
    setIsDialogOpen(true);
  }, []);

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
    // biome-ignore lint/complexity/noExcessiveLinesPerFunction: relocated, not rewritten
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
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: relocated, not rewritten
        .then(async (response) => {
          if (!response.ok) {
            throw await exportRequestError(response);
          }

          // Read total from header immediately
          const totalTraces = parseInt(response.headers.get("X-Total-Traces") ?? "0", 10);
          setProgress((prev) => ({ ...prev, total: totalTraces }));

          // Activate tRPC subscription for real-time progress
          const exportId = response.headers.get("X-Export-Id");
          if (exportId) {
            setCurrentExportId(exportId);
          }

          const blob = await response.blob();

          if (blob.size === 0) {
            const isNoMatches = totalTraces === 0;
            toaster.create({
              title: isNoMatches ? "Export produced no data" : "Export failed",
              description: isNoMatches
                ? "No traces matched the current filters. Try adjusting the time range or search query."
                : "The server returned an empty response. Please try again.",
              type: isNoMatches ? "warning" : "error",
            });
            return false;
          }

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
          showErrorToast({
            error,
            fallbackTitle: "Couldn't export your traces",
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
    [projectId, filters, startDate, endDate, query, selectedTraceIds],
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

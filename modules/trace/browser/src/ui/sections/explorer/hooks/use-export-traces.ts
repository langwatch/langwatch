import { toaster } from "@langwatch/design-system/toaster";
import { nowInstant } from "@langwatch/time";
import type {
  ExportProgressEvent,
  ExportFormat,
  ExportMode,
  ExportProgress,
} from "@langwatch/trace-browser-kit";
import { useCallback, useRef, useState } from "react";

import { api } from "../../../../behavior/trace-api.ts";
import { readHandledError, showErrorToast } from "../../errors/index.ts";

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

export interface UseExportTracesReturn {
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
 * The failure behind a non-OK download response, as something the shared error reader
 * understands.
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

const NO_PROGRESS: ExportProgress = { exported: 0, total: 0 };

/** Progress after a streamed event: its counts, and everything exported once done. */
function progressAfter(previous: ExportProgress, event: ExportProgressEvent): ExportProgress {
  const counted =
    event.exported === undefined
      ? previous
      : { exported: event.exported, total: event.total ?? previous.total };
  return event.type === "done" ? { ...counted, exported: counted.total } : counted;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Says why an export produced an empty file: nothing matched, or the server failed. */
function toastEmptyExport(totalTraces: number) {
  const isNoMatches = totalTraces === 0;
  toaster.create({
    title: isNoMatches ? "Export produced no data" : "Export failed",
    description: isNoMatches
      ? "No traces matched the current filters. Try adjusting the time range or search query."
      : "The server returned an empty response. Please try again.",
    type: isNoMatches ? "warning" : "error",
  });
}

/**
 * Streams the export file and saves it. The total arrives in a header at once,
 * and the export id opens the progress subscription. Resolves whether a file
 * was saved; a cancel resolves false quietly, any other failure toasts.
 */
async function downloadExport({
  requestBody,
  fallbackFilename,
  signal,
  onTotal,
  onExportId,
}: {
  requestBody: Record<string, unknown>;
  fallbackFilename: string;
  signal: AbortSignal;
  onTotal: (total: number) => void;
  onExportId: (exportId: string) => void;
}): Promise<boolean> {
  try {
    const response = await fetch("/api/export/traces/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal,
    });
    if (!response.ok) throw await exportRequestError(response);
    const totalTraces = parseInt(response.headers.get("X-Total-Traces") ?? "0", 10);
    onTotal(totalTraces);
    const exportId = response.headers.get("X-Export-Id");
    if (exportId) onExportId(exportId);
    const blob = await response.blob();
    if (blob.size === 0) {
      toastEmptyExport(totalTraces);
      return false;
    }
    const filename = extractFilename({
      contentDisposition: response.headers.get("Content-Disposition"),
      fallbackName: fallbackFilename,
    });
    triggerBlobDownload({ blob, filename });
    return true;
  } catch (error) {
    if (!isAbortError(error)) {
      showErrorToast({ error, fallbackTitle: "Couldn't export your traces" });
    }
    return false;
  }
}

function fallbackExportFilename({
  projectId,
  config,
}: {
  projectId: string;
  config: ExportConfig;
}) {
  const fileExtension = config.format === "json" ? "jsonl" : "csv";
  const today = nowInstant().toString().split("T")[0];
  return `${projectId} - Traces - ${today} - ${config.mode}.${fileExtension}`;
}

/**
 * Hook that orchestrates the trace export flow: dialog state, file download streaming,
 * tRPC subscription progress updates, and cancellation.
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
  const [progress, setProgress] = useState<ExportProgress>(NO_PROGRESS);
  const [selectedTraceIds, setSelectedTraceIds] = useState<string[] | undefined>();
  const [currentExportId, setCurrentExportId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Progress streams over a tRPC subscription fed by the BroadcastService.
  api.export.onExportProgress.useSubscription(
    { projectId: projectId ?? "", exportId: currentExportId ?? "" },
    {
      enabled: isExporting && !!currentExportId && !!projectId,
      onData: (event: ExportProgressEvent) => setProgress((prev) => progressAfter(prev, event)),
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

  const clearCompletionTimer = useCallback(() => {
    if (completionTimeoutRef.current) clearTimeout(completionTimeoutRef.current);
    completionTimeoutRef.current = null;
  }, []);

  const resetExport = useCallback(() => {
    setIsExporting(false);
    setProgress(NO_PROGRESS);
    setCurrentExportId(null);
  }, []);

  const cancelExport = useCallback(() => {
    clearCompletionTimer();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    resetExport();
  }, [clearCompletionTimer, resetExport]);

  const startExport = useCallback(
    (config: ExportConfig) => {
      if (!projectId) {
        showErrorToast({
          fallbackTitle: "Couldn't export the traces",
          description: "No project is selected.",
        });
        return;
      }
      clearCompletionTimer();
      abortControllerRef.current?.abort();
      setIsDialogOpen(false);
      setIsExporting(true);
      setProgress(NO_PROGRESS);

      // A newer export replaces the ref, which is how a stale one knows to stay quiet.
      const thisController = new AbortController();
      abortControllerRef.current = thisController;

      void downloadExport({
        requestBody: {
          projectId,
          mode: config.mode,
          format: config.format,
          filters,
          startDate,
          endDate,
          ...(query ? { query } : {}),
          ...(selectedTraceIds ? { traceIds: selectedTraceIds } : {}),
        },
        fallbackFilename: fallbackExportFilename({ projectId, config }),
        signal: thisController.signal,
        onTotal: (total) => setProgress((prev) => ({ ...prev, total })),
        onExportId: setCurrentExportId,
      }).then((completed) => {
        if (abortControllerRef.current !== thisController) return;
        if (!completed) {
          resetExport();
          return;
        }
        // A brief "complete" state before the progress hides.
        setProgress((prev) => ({ ...prev, exported: prev.total }));
        completionTimeoutRef.current = setTimeout(resetExport, 1500);
      });
    },
    [
      projectId,
      filters,
      startDate,
      endDate,
      query,
      selectedTraceIds,
      clearCompletionTimer,
      resetExport,
    ],
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

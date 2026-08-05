import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import type { ExportProgressEvent } from "~/server/api/routers/export";
import type {
  ScenarioRunExportMode,
  ScenarioRunExportRequest,
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

  useExportProgressUpdates({
    projectId,
    exportId,
    enabled: isExporting && !!exportId && !!projectId,
    setProgress,
  });

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

      void downloadExport({
        request: buildExportRequest({
          projectId,
          mode,
          scenarioSetId,
          scenarioId,
          passFailStatus,
          startDate,
          endDate,
        }),
        signal: abortController.signal,
        onAccepted: ({ total, exportId: acceptedId }) => {
          setProgress({ exported: 0, total });
          setExportId(acceptedId);
        },
        onSwept: (total) => setProgress({ exported: total, total }),
      }).finally(() => {
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

/**
 * Relays the server's progress broadcasts into the counter.
 *
 * Its own hook because the count travels on a different transport from the
 * file: the response body IS the download and goes to disk, so the only way to
 * report how far along the sweep is, is out of band. Nothing else in the export
 * needs to know that.
 */
function useExportProgressUpdates({
  projectId,
  exportId,
  enabled,
  setProgress,
}: {
  projectId: string | undefined;
  exportId: string | null;
  enabled: boolean;
  setProgress: Dispatch<SetStateAction<{ exported: number; total: number }>>;
}): void {
  api.export.onScenarioRunExportProgress.useSubscription(
    { projectId: projectId!, exportId: exportId! },
    {
      enabled,
      onData: (event: ExportProgressEvent) => {
        if (event.exported === undefined) return;
        setProgress((prev) => ({
          exported: event.exported ?? prev.exported,
          total: event.total ?? prev.total,
        }));
      },
    },
  );
}

/**
 * The filters the panel is currently showing, as a request body.
 *
 * Absent filters are omitted rather than sent as `undefined`: the route parses
 * the body with a Zod schema, and an explicit `scenarioId: undefined` survives
 * `JSON.stringify` as a missing key anyway — so building it this way keeps the
 * wire format and the type in agreement instead of relying on that.
 */
function buildExportRequest({
  projectId,
  mode,
  scenarioSetId,
  scenarioId,
  passFailStatus,
  startDate,
  endDate,
}: {
  projectId: string;
  mode: ScenarioRunExportMode;
  scenarioSetId?: string;
  scenarioId?: string;
  passFailStatus?: ScenarioRunExportStatusFilter;
  startDate?: number;
  endDate?: number;
}): ScenarioRunExportRequest {
  return {
    projectId,
    mode,
    ...(scenarioSetId ? { scenarioSetId } : {}),
    ...(scenarioId ? { scenarioId } : {}),
    ...(passFailStatus ? { passFailStatus } : {}),
    ...(startDate !== undefined ? { startDate } : {}),
    ...(endDate !== undefined ? { endDate } : {}),
  };
}

/**
 * Runs one export request to completion: POST, read the headers the server
 * answers with, then write the body to disk.
 *
 * Lives outside the hook so `startExport` reads as the state transition it is.
 * The two callbacks are the only things it needs from React — the progress
 * denominator the moment the server accepts, and the final count once the body
 * has been read.
 */
async function downloadExport({
  request,
  signal,
  onAccepted,
  onSwept,
}: {
  request: ScenarioRunExportRequest;
  signal: AbortSignal;
  onAccepted: (accepted: { total: number; exportId: string | null }) => void;
  onSwept: (total: number) => void;
}): Promise<void> {
  try {
    const response = await fetch("/api/export/scenario-runs/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok) {
      throw await readExportFailure(response);
    }

    // The server knows the total before it streams a byte, so the bar has a
    // denominator immediately rather than after the first chunk. The export id
    // arrives here rather than before the fetch: it only exists once the
    // server has accepted the request.
    const total = Number(response.headers.get("X-Total-Runs") ?? "0");
    onAccepted({ total, exportId: response.headers.get("X-Export-Id") });

    // Nothing matched, so the file would be a header and no rows. Said before
    // the download rather than after, because a spreadsheet with only a header
    // reads as a broken export and the reason is not in the file.
    //
    // Keyed on the count the server reported, not on the size of what came
    // back: the serializer always writes the header, so the body is never
    // empty and a size check here would never fire.
    if (total === 0) {
      toaster.create({
        title: "Export produced no data",
        description:
          "No runs matched the current filters. Try widening the date range.",
        type: "warning",
      });
      return;
    }

    const blob = await response.blob();
    onSwept(total);

    triggerBlobDownload({
      blob,
      filename: extractFilename({
        contentDisposition: response.headers.get("Content-Disposition"),
        fallbackName: fallbackFilename(request),
      }),
    });
  } catch (error) {
    // Cancelling is a thing the user did, not a failure to report back to them.
    if (error instanceof Error && error.name === "AbortError") return;
    showErrorToast({ error, fallbackTitle: "Export failed" });
  }
}

/**
 * The failure body the route sent, so the toast can say what actually went
 * wrong.
 *
 * `handleError` serializes a HandledError to `{ error: "<code>", ... }`, which
 * `showErrorToast` resolves to the registered copy — "Ask an admin for access"
 * rather than the status code. Returning the parsed body rather than an Error
 * is what keeps that path open; a body we cannot parse falls back to the status
 * so the toast still has something to show.
 */
async function readExportFailure(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return new Error(`Export failed: ${response.status}`);
  }
}

/**
 * Used only when the response carries no Content-Disposition — the server names
 * the file, and this keeps a download from landing as "download".
 */
function fallbackFilename(request: ScenarioRunExportRequest): string {
  const today = new Date().toISOString().split("T")[0];
  return `${request.projectId} - Scenario Runs - ${today} - ${request.mode}.csv`;
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

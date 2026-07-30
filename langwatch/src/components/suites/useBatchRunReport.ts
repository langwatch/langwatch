/**
 * Produces the downloadable run report for a batch run in the run history.
 *
 * One instance of this hook serves EVERY row, so the scope of a report is
 * passed to `startReport` rather than to the hook: the panel has one list and
 * an unknown number of rows in it. In-flight requests are therefore keyed by
 * batch run — a report for one run must not cancel a report for another, which
 * is what a single `AbortController` ref (the shape `useExportTraces` uses for
 * its one dialog-scoped export) would do here.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { readHandledError, showErrorToast } from "~/features/errors";
import type { ReportTier } from "~/server/export/batch-run-report/report.types";

export const BATCH_RUN_REPORT_DOWNLOAD_PATH =
  "/api/export/batch-run-report/download";

interface StartReportInput {
  batchRunId: string;
  scenarioSetId: string;
  /** Only used to name the file when the server does not. */
  suiteName?: string;
}

interface UseBatchRunReportReturn {
  /** Every batch run whose report is currently being produced. */
  runningBatchIds: ReadonlySet<string>;
  /** Whether THIS batch run is currently producing a report. */
  isReportRunning: (batchRunId: string) => boolean;
  startReport: (input: StartReportInput) => void;
  cancelReport: (input: { batchRunId: string }) => void;
}

/**
 * Turns a successful response into a downloaded file.
 *
 * The file always arrives; what can be missing from it is the half a model
 * writes. Saying so is the difference between a reader thinking the run had
 * nothing to explain and knowing the explanation is what went missing.
 */
async function deliverReport({
  response,
  suiteName,
  batchRunId,
}: {
  response: Response;
  suiteName?: string;
  batchRunId: string;
}): Promise<void> {
  if (!response.ok) {
    throw await reportRequestError(response);
  }

  const tier = response.headers.get("X-Report-Tier") as ReportTier | null;
  const blob = await response.blob();

  triggerBlobDownload({
    blob,
    filename: extractFilename({
      contentDisposition: response.headers.get("Content-Disposition"),
      fallbackName: fallbackReportFilename({ suiteName, batchRunId }),
    }),
  });

  if (tier === "figures_only") {
    toaster.create({
      title: "Report downloaded without its written analysis",
      description:
        "Every figure for this run is in the file. The written part couldn't be produced this time.",
      type: "info",
    });
  }
}

/** Triggers a browser download from a Blob and a filename. */
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

/** Reads the filename the server chose, falling back to one we can build. */
function extractFilename({
  contentDisposition,
  fallbackName,
}: {
  contentDisposition: string | null;
  fallbackName: string;
}): string {
  if (!contentDisposition) return fallbackName;

  const filenameMatch = contentDisposition.match(
    /filename\*?=(?:UTF-8''|")?([^";]+)"?/i,
  );
  if (filenameMatch?.[1]) {
    return decodeURIComponent(filenameMatch[1]);
  }

  return fallbackName;
}

/** A name that still says which run it came from when the header does not. */
function fallbackReportFilename({
  suiteName,
  batchRunId,
}: {
  suiteName?: string;
  batchRunId: string;
}): string {
  const prefix =
    (suiteName ?? "run").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "run";
  return `${prefix}-report-${batchRunId}.html`;
}

/**
 * The failure behind a non-OK response, as something `showErrorToast`
 * understands. The route answers a rejection with the flat handled body
 * (`{ error: "<code>", message, ...meta }`), and that code is what turns
 * "we've been notified" into a sentence worth reading — so it rides ON an
 * Error rather than being thrown away for a synthesised message. Same reasoning
 * as `exportRequestError` in `~/components/messages/useExportTraces`.
 */
async function reportRequestError(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  const payload = readHandledError(body)
    ? (body as Record<string, unknown>)
    : { error: "export_failed" };

  return Object.assign(
    new Error(`Run report rejected with HTTP ${response.status}`),
    payload,
    { status: response.status },
  );
}

export function useBatchRunReport({
  projectId,
}: {
  projectId: string | undefined;
}): UseBatchRunReportReturn {
  const controllersRef = useRef(new Map<string, AbortController>());
  const [runningBatchIds, setRunningBatchIds] = useState<ReadonlySet<string>>(
    new Set<string>(),
  );

  // A report outlives a re-render but not the panel: leaving one running after
  // the list unmounts would download a file onto a page nobody is looking at.
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
    };
  }, []);

  const clearRunning = useCallback((batchRunId: string) => {
    controllersRef.current.delete(batchRunId);
    setRunningBatchIds((previous) => {
      if (!previous.has(batchRunId)) return previous;
      const next = new Set(previous);
      next.delete(batchRunId);
      return next;
    });
  }, []);

  const startReport = useCallback(
    ({ batchRunId, scenarioSetId, suiteName }: StartReportInput) => {
      if (!projectId) {
        toaster.create({
          title: "Couldn't build the report",
          description: "No project selected",
          type: "error",
        });
        return;
      }

      // Asking twice for the same run buys nothing and would orphan the first
      // controller, leaving the row unable to cancel what it started.
      if (controllersRef.current.has(batchRunId)) return;

      const controller = new AbortController();
      controllersRef.current.set(batchRunId, controller);
      setRunningBatchIds((previous) => new Set(previous).add(batchRunId));

      void fetch(BATCH_RUN_REPORT_DOWNLOAD_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, scenarioSetId, batchRunId }),
        signal: controller.signal,
      })
        .then((response) => deliverReport({ response, suiteName, batchRunId }))
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          showErrorToast({ error, fallbackTitle: "Couldn't build the report" });
        })
        .finally(() => clearRunning(batchRunId));
    },
    [projectId, clearRunning],
  );

  const cancelReport = useCallback(
    ({ batchRunId }: { batchRunId: string }) => {
      controllersRef.current.get(batchRunId)?.abort();
      clearRunning(batchRunId);
    },
    [clearRunning],
  );

  const isReportRunning = useCallback(
    (batchRunId: string) => runningBatchIds.has(batchRunId),
    [runningBatchIds],
  );

  return { runningBatchIds, isReportRunning, startReport, cancelReport };
}

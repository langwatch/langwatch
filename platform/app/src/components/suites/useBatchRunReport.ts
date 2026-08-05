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
import type { ReportStage } from "~/shared/scenario-run-report/report-stages";
import { triggerBlobDownload } from "~/utils/downloadBlob";

export const BATCH_RUN_REPORT_DOWNLOAD_PATH =
  "/api/export/batch-run-report/download";

interface StartReportInput {
  batchRunId: string;
  scenarioSetId: string;
  /** Only used to name the file when the server does not. */
  suiteName?: string;
  /** False exports the computed report alone, without waiting on Langy. */
  withAnalysis?: boolean;
}

export interface UseBatchRunReportReturn {
  /** Every batch run whose report is currently being produced. */
  runningBatchIds: ReadonlySet<string>;
  /** Whether THIS batch run is currently producing a report. */
  isReportRunning: (batchRunId: string) => boolean;
  /** Which stage THIS run's report is in, or null when it is not running. */
  reportStage: (batchRunId: string) => ReportStage | null;
  startReport: (input: StartReportInput) => void;
  cancelReport: (input: { batchRunId: string }) => void;
}

/**
 * One line of the report endpoint's NDJSON: a stage, the document, or a
 * failure.
 *
 * `error` is a handled-error CODE, not a sentence. A failure after the first
 * byte cannot become an HTTP status, so it travels in band, and it travels as
 * the same discriminant a rejected request would have carried: the words come
 * from the presentation registry either way.
 */
interface ReportStreamEvent {
  stage?: ReportStage;
  done?: boolean;
  tier?: ReportTier;
  filename?: string;
  html?: string;
  error?: string;
}

/**
 * Reads the progress stream and delivers the file from its last line.
 *
 * One JSON object per line. Stages arrive as the server enters them, so the
 * label tracks the real wait rather than a timer, and the document arrives
 * whole at the end — a report that appeared progressively would be readable
 * before its own header could say how much of it survived being produced.
 */
async function consumeReportStream({
  response,
  suiteName,
  batchRunId,
  onStage,
}: {
  response: Response;
  suiteName?: string;
  batchRunId: string;
  onStage: (stage: ReportStage) => void;
}): Promise<void> {
  if (!response.ok) {
    throw await reportRequestError(response);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("The report stream carried no body.");

  const decoder = new TextDecoder();
  let buffered = "";
  let isDelivered = false;

  const handle = (line: string) => {
    const event = parseStreamEvent(line);
    if (!event) return;
    if (event.stage) return onStage(event.stage);
    if (event.error) throw streamFailure(event.error);
    if (!event.done || event.html === undefined) return;

    deliverDocument({ event, suiteName, batchRunId });
    isDelivered = true;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  handle(buffered);

  if (!isDelivered) {
    throw new Error("The report stream ended before the file arrived.");
  }
}

/**
 * One NDJSON line as an event, or null when there is nothing to read in it.
 *
 * A malformed or truncated line is skipped rather than thrown on. The last
 * line of a cut stream is the one this matters for: a connection dropped after
 * the document had already been delivered would otherwise surface as a failure
 * toast over a file the reader has in their downloads folder. When the
 * document really did not arrive, the caller's own "ended before the file
 * arrived" check still fires.
 */
function parseStreamEvent(line: string): ReportStreamEvent | null {
  if (line.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as ReportStreamEvent)
      : null;
  } catch {
    return null;
  }
}

/**
 * A mid-stream failure as something `showErrorToast` can render.
 *
 * The line carries a code, so it rides on the error under `error`, which is
 * the flat shape `readHandledError` reads a REST rejection from. Same reasoning
 * as `reportRequestError` below: a synthesised sentence here would replace copy
 * written for this exact failure with a generic one.
 */
function streamFailure(code: string): Error {
  return Object.assign(new Error(`Run report stream failed: ${code}`), {
    error: code,
  });
}

/** Saves the finished document and says so when the analysis is missing. */
function deliverDocument({
  event,
  suiteName,
  batchRunId,
}: {
  event: ReportStreamEvent;
  suiteName?: string;
  batchRunId: string;
}): void {
  triggerBlobDownload({
    blob: new Blob([event.html ?? ""], { type: "text/html;charset=utf-8" }),
    filename:
      event.filename ?? fallbackReportFilename({ suiteName, batchRunId }),
  });

  if (event.tier === "figures_only") {
    toaster.create({
      title: "Report downloaded without Langy's analysis",
      description:
        "Every figure for this run is in the file. Langy couldn't write the analysis this time.",
      type: "info",
    });
  }
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

/**
 * Asks for one report and sees it through to the file or to a toast.
 *
 * Rejection is handled here rather than by the caller so the hook's own body
 * stays about which runs are in flight: an abort is the user cancelling and
 * says nothing, anything else is worth a toast.
 */
async function requestReport({
  projectId,
  scenarioSetId,
  batchRunId,
  suiteName,
  withAnalysis,
  controller,
  onStage,
}: {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
  suiteName?: string;
  withAnalysis: boolean;
  controller: AbortController;
  onStage: (stage: ReportStage) => void;
}): Promise<void> {
  try {
    const response = await fetch(`${BATCH_RUN_REPORT_DOWNLOAD_PATH}?stream=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        scenarioSetId,
        batchRunId,
        withAnalysis,
      }),
      signal: controller.signal,
    });
    await consumeReportStream({ response, suiteName, batchRunId, onStage });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") return;
    showErrorToast({ error, fallbackTitle: "Couldn't build the report" });
  }
}

/**
 * Which runs are producing a report, and how far along each one is.
 *
 * Kept apart from starting and cancelling: this is bookkeeping over two maps
 * keyed by run, while the caller below is about one request's lifecycle. The
 * controllers live here too, because a controller and the "running" flag it
 * backs must be added and removed together or a row loses the ability to
 * cancel what it started.
 */
function useRunningReports() {
  const controllersRef = useRef(new Map<string, AbortController>());
  const [runningBatchIds, setRunningBatchIds] = useState<ReadonlySet<string>>(
    new Set<string>(),
  );
  const [stages, setStages] = useState<ReadonlyMap<string, ReportStage>>(
    new Map<string, ReportStage>(),
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
    setStages((previous) => {
      if (!previous.has(batchRunId)) return previous;
      const next = new Map(previous);
      next.delete(batchRunId);
      return next;
    });
  }, []);

  const markRunning = useCallback(
    ({
      batchRunId,
      controller,
    }: {
      batchRunId: string;
      controller: AbortController;
    }) => {
      controllersRef.current.set(batchRunId, controller);
      setRunningBatchIds((previous) => new Set(previous).add(batchRunId));
    },
    [],
  );

  const setStage = useCallback(
    ({ batchRunId, stage }: { batchRunId: string; stage: ReportStage }) => {
      setStages((previous) => new Map(previous).set(batchRunId, stage));
    },
    [],
  );

  return {
    controllersRef,
    runningBatchIds,
    stages,
    clearRunning,
    markRunning,
    setStage,
  };
}

export function useBatchRunReport({
  projectId,
}: {
  projectId: string | undefined;
}): UseBatchRunReportReturn {
  const {
    controllersRef,
    runningBatchIds,
    stages,
    clearRunning,
    markRunning,
    setStage,
  } = useRunningReports();

  const startReport = useCallback(
    ({
      batchRunId,
      scenarioSetId,
      suiteName,
      withAnalysis = true,
    }: StartReportInput) => {
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
      markRunning({ batchRunId, controller });

      void requestReport({
        projectId,
        scenarioSetId,
        batchRunId,
        suiteName,
        withAnalysis,
        controller,
        onStage: (stage) => setStage({ batchRunId, stage }),
      }).finally(() => clearRunning(batchRunId));
    },
    [projectId, clearRunning, markRunning, setStage, controllersRef],
  );

  const cancelReport = useCallback(
    ({ batchRunId }: { batchRunId: string }) => {
      controllersRef.current.get(batchRunId)?.abort();
      clearRunning(batchRunId);
    },
    [clearRunning, controllersRef],
  );

  const isReportRunning = useCallback(
    (batchRunId: string) => runningBatchIds.has(batchRunId),
    [runningBatchIds],
  );

  const reportStage = useCallback(
    (batchRunId: string) => stages.get(batchRunId) ?? null,
    [stages],
  );

  return {
    runningBatchIds,
    isReportRunning,
    reportStage,
    startReport,
    cancelReport,
  };
}

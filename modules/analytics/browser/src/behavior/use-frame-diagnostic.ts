/**
 * Keeps the latest error a sandboxed chart frame reported, and keeps running: the widget's own
 * code is the cause, so a restart would only reproduce it. A crash while drawing, or the
 * frame's own libraries not loading, is reported as an exception.
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import {
  CHART_FRAME_CRASH_TITLES,
  CHART_FRAME_LOAD_FAILURE_TITLES,
} from "@langwatch/analytics-contract/chart-frame-protocol";
import type { LangWatchQLChartCrashContext } from "@langwatch/analytics-contract/visualization";
import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ChartFrameLogEntry } from "./frame-bridge.ts";

/**
 * The frame's own error panel (compile, no export, render crash) reports "lw.error";
 * a widget's console.error does not.
 */
const isFatal = (entry: ChartFrameLogEntry) =>
  entry.level === "error" && entry.source === "lw.error";

const startsWithTitle = (text: string, titles: Readonly<Record<string, string>>) =>
  Object.values(titles).some((title) => text === title || text.startsWith(`${title}: `));

/**
 * The surface a fatal line is reported under: a crash while drawing, or the frame's libraries
 * not loading. A refusal of the widget's own source (compile, no export, import) is neither.
 */
const reportedSurface = (entry: ChartFrameLogEntry) => {
  if (!isFatal(entry)) return undefined;
  if (startsWithTitle(entry.text, CHART_FRAME_CRASH_TITLES)) return "dashboard_widget_frame";
  if (startsWithTitle(entry.text, CHART_FRAME_LOAD_FAILURE_TITLES)) {
    return "dashboard_widget_frame_load";
  }
  return undefined;
};

/**
 * Widget text is author-controlled, so distinct texts are unbounded: past this many reports per
 * mount the frame's errors stop reaching PostHog, and the per-text dedup alone is not enough.
 */
const MAX_REPORTED_EXCEPTIONS_PER_MOUNT = 5;

const MAX_CRASH_TITLE_LENGTH = 200;

/**
 * Widget author text may quote trace values, so a crash report keeps its first line, cut short
 * at a word boundary: a key straddling the cut would leave a start the masker cannot recognise.
 */
const crashTitle = (text: string) => {
  const line = text.split("\n")[0] ?? "";
  if (line.length <= MAX_CRASH_TITLE_LENGTH) return line;
  const atWord = line.slice(0, MAX_CRASH_TITLE_LENGTH + 1).replace(/\s*\S*$/, "");
  return atWord || line.slice(0, MAX_CRASH_TITLE_LENGTH);
};

export function useFrameDiagnostic({
  /** Identifies one run of the code (code and retry attempt); a change clears the last error. */
  resetKey,
  crashContext,
}: {
  readonly resetKey: string;
  /** The board and widget a crash is reported with. */
  readonly crashContext?: LangWatchQLChartCrashContext;
}) {
  const [diagnostic, setDiagnostic] = useState<ChartFrameLogEntry | null>(null);
  // Latched: a later console error must not uncover a widget that already crashed.
  const [fatal, setFatal] = useState(false);
  const analytics = useUiAnalytics();
  // Refs keep onLog stable for the bridge; the set outlives a retry, so one crash reports once.
  const reporting = useRef({ analytics, crashContext });
  const reported = useRef(new Set<string>());

  useEffect(() => {
    reporting.current = { analytics, crashContext };
  });

  useEffect(() => {
    setDiagnostic(null);
    setFatal(false);
  }, [resetKey]);

  const onLog = useCallback((entry: ChartFrameLogEntry) => {
    if (entry.level !== "error") return;
    setDiagnostic(entry);
    if (isFatal(entry)) setFatal(true);
    const surface = reportedSurface(entry);
    if (surface === undefined) return;
    const error = surface === "dashboard_widget_frame" ? crashTitle(entry.text) : entry.text;
    if (reported.current.has(error)) return;
    if (reported.current.size >= MAX_REPORTED_EXCEPTIONS_PER_MOUNT) return;
    reported.current.add(error);
    // A string, not an Error: the host's stack would point at this file, not the widget.
    reporting.current.analytics.captureException({
      error,
      properties: { surface, ...reporting.current.crashContext },
    });
  }, []);

  return { diagnostic, fatal, onLog };
}

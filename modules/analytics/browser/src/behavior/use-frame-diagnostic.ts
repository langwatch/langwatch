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
    if (surface === undefined || reported.current.has(entry.text)) return;
    reported.current.add(entry.text);
    // A string, not an Error: the host's stack would point at this file, not the widget.
    reporting.current.analytics.captureException({
      error: entry.text,
      properties: { surface, ...reporting.current.crashContext },
    });
  }, []);

  return { diagnostic, fatal, onLog };
}

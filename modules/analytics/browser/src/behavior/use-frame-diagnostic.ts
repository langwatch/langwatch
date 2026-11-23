/**
 * Keeps the latest error a sandboxed chart frame reported. It keeps
 * running after an error — the widget's own code is the cause, so a
 * restart would only reproduce it. A crash while drawing is reported as an exception.
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { CHART_FRAME_CRASH_TITLES } from "@langwatch/analytics-contract/chart-frame-protocol";
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

/** A fatal line whose title is a crash, not a refusal of the widget's own source. */
const isCrash = (entry: ChartFrameLogEntry) =>
  isFatal(entry) &&
  Object.values(CHART_FRAME_CRASH_TITLES).some(
    (title) => entry.text === title || entry.text.startsWith(`${title}: `),
  );

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
    if (isCrash(entry) && !reported.current.has(entry.text)) {
      reported.current.add(entry.text);
      reporting.current.analytics.captureException({
        error: new Error(entry.text),
        properties: { surface: "dashboard_widget_frame", ...reporting.current.crashContext },
      });
    }
  }, []);

  return { diagnostic, fatal, onLog };
}

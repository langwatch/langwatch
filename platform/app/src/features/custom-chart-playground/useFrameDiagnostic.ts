/**
 * Keeps the most recent error a sandboxed chart frame reported, so a host
 * can show it instead of dropping it. Compile errors, render throws and
 * `LW.error(...)` all arrive here through the bridge's `onLog`; the frame
 * itself keeps running, because the widget's code is the cause and a
 * restart would only reproduce it.
 *
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { useCallback, useEffect, useState } from "react";

import type { ChartFrameLogEntry } from "./bridge/frameBridge";

export function useFrameDiagnostic({
  /** Whatever identifies the code being run — a change clears the last error. */
  resetKey,
}: {
  readonly resetKey: string;
}) {
  const [diagnostic, setDiagnostic] = useState<ChartFrameLogEntry | null>(null);

  useEffect(() => {
    setDiagnostic(null);
  }, [resetKey]);

  const onLog = useCallback((entry: ChartFrameLogEntry) => {
    if (entry.level !== "error") return;
    setDiagnostic(entry);
  }, []);

  return { diagnostic, onLog };
}

/**
 * Keeps the latest error a sandboxed chart frame reported. It keeps
 * running after an error — the widget's own code is the cause, so a
 * restart would only reproduce it.
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { useCallback, useEffect, useState } from "react";

import type { ChartFrameLogEntry } from "./frameBridge.ts";

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

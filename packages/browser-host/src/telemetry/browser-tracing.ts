/**
 * Starts once the composing application says it's wanted — the flag lives
 * on the server, so the caller passes resolved values in. See ADR-058.
 */

import type { ProcessWebConfig } from "@langwatch/config/public-app-config";
import { RUM_DEFAULT_SAMPLE_RATIO, startBrowserTracing } from "@langwatch/react-rum";
import { useEffect } from "react";

export type BrowserTracingPublicConfig = {
  enabled: boolean | undefined;
  environment: ProcessWebConfig["mode"] | undefined;
  sampleRatio: number | undefined;
};

export function useBrowserTracing({
  enabled,
  environment,
  sampleRatio,
}: BrowserTracingPublicConfig): void {
  useEffect(() => {
    if (!enabled) return;
    // Idempotent — remounts and strict-mode double effects are expected.
    // The sampling ratio is fixed at this first call and can't be changed
    // without a new provider, orphaning the one already exporting.
    startBrowserTracing({
      environment,
      sampleRatio: sampleRatio ?? RUM_DEFAULT_SAMPLE_RATIO,
    });
  }, [enabled, environment, sampleRatio]);
}

/**
 * Starts browser tracing once the composing application has said whether it is
 * wanted.
 *
 * The flag lives on the server, so nothing can start until the application's
 * public configuration query resolves; the caller passes the resolved values
 * rather than this behaviour reading them. See ADR-058.
 */

import { RUM_DEFAULT_SAMPLE_RATIO, startBrowserTracing } from "@langwatch/react-rum";
import { useEffect } from "react";
import type { PublicEnvironment } from "../model/public-environment";

export type BrowserTracingPublicConfig = {
  enabled: boolean | undefined;
  environment: PublicEnvironment["NODE_ENV"] | undefined;
  sampleRatio: number | undefined;
};

export function useBrowserTracing({
  enabled,
  environment,
  sampleRatio,
}: BrowserTracingPublicConfig): void {
  useEffect(() => {
    if (!enabled) return;
    // Idempotent — remounts and strict-mode double effects are expected here.
    // The sampling ratio is fixed at this first call: it is read into the
    // provider's sampler, and a later change would need a provider we cannot
    // replace without orphaning the one already exporting.
    startBrowserTracing({
      environment,
      sampleRatio: sampleRatio ?? RUM_DEFAULT_SAMPLE_RATIO,
    });
  }, [enabled, environment, sampleRatio]);
}

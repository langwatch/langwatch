/**
 * Starts browser tracing once the server has said whether it is wanted.
 *
 * Mirrors how `usePostHog` waits for `usePublicEnv` before initialising its
 * client: the flag lives on the server, so nothing can start until that query
 * resolves. See ADR-058.
 */

import { useEffect } from "react";

import {
  RUM_DEFAULT_SAMPLE_RATIO,
  startBrowserTracing,
} from "@langwatch/react-rum";
import { usePublicEnv } from "./usePublicEnv";

export function useBrowserTracing(): void {
  const publicEnv = usePublicEnv();
  const enabled = publicEnv.data?.RUM_ENABLED;
  const environment = publicEnv.data?.NODE_ENV;
  const sampleRatio = publicEnv.data?.RUM_SAMPLE_RATIO;

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

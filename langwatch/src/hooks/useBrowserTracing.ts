/**
 * Starts browser tracing once the server has said whether it is wanted.
 *
 * Mirrors how `usePostHog` waits for `usePublicEnv` before initialising its
 * client: the flag lives on the server, so nothing can start until that query
 * resolves. See ADR-058.
 */

import { useEffect } from "react";

import { startBrowserTracing } from "@langwatch/react-rum";
import { usePublicEnv } from "./usePublicEnv";

export function useBrowserTracing(): void {
  const publicEnv = usePublicEnv();
  const enabled = publicEnv.data?.RUM_ENABLED;
  const environment = publicEnv.data?.NODE_ENV;

  useEffect(() => {
    if (!enabled) return;
    // Idempotent — remounts and strict-mode double effects are expected here.
    startBrowserTracing({ environment });
  }, [enabled, environment]);
}

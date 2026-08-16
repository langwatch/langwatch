/**
 * The remote-trace fragment of the SDK run configuration.
 *
 * The scenario SDK owns remote-trace judging: with `fetchRemoteTraces` on,
 * its judge collects the trace ids stamped on the conversation's messages,
 * fetches them from the trace API, settle-waits at verdict time, and degrades
 * to a synthetic error span when spans do not arrive. The platform's part is
 * this configuration: enable the capability for http targets, hand the SDK
 * the project's endpoint and key (the SDK's fetcher reads them off the run
 * config's `langwatch` block, with env vars as fallback), and pass the
 * prefetcher's ingest-lag wait budget. Omitting `traceWaitTimeoutMs` leaves
 * the SDK's own default in place.
 *
 * @see dev/docs/adr/097-scenario-remote-trace-judging.md
 * @see specs/scenarios/remote-trace-judging.feature
 */

import type { TargetConfig } from "./types";

export interface RemoteTraceRunConfig {
  fetchRemoteTraces: true;
  traceWaitTimeoutMs?: number;
  langwatch: {
    endpoint: string;
    apiKey: string;
  };
}

export function buildRemoteTraceRunConfig({
  targetType,
  traceWaitTimeoutMs,
  langwatchEndpoint,
  langwatchApiKey,
}: {
  targetType: TargetConfig["type"];
  traceWaitTimeoutMs: number | undefined;
  langwatchEndpoint: string;
  langwatchApiKey: string;
}): RemoteTraceRunConfig | Record<string, never> {
  if (targetType !== "http") {
    return {};
  }
  return {
    fetchRemoteTraces: true,
    ...(traceWaitTimeoutMs !== undefined ? { traceWaitTimeoutMs } : {}),
    langwatch: {
      endpoint: langwatchEndpoint,
      apiKey: langwatchApiKey,
    },
  };
}

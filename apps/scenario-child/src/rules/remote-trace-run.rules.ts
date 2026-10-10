/**
 * Remote-trace fragment of SDK run configuration. Platform enables capability for http targets,
 * hands SDK endpoint/key; SDK judge fetches traces by message-stamped trace ids.
 * See dev/docs/adr/097-scenario-remote-trace-judging.md and remote-trace-judging.feature.
 */

import type { TargetConfig } from "@langwatch/scenario-contract";

/**
 * Verdict-time wait cap (30s covers p90 tenant per prod measurement). Shared by
 * server-side clamp and child's run config (child-safe module, no ClickHouse imports).
 */
export const TRACE_WAIT_CAP_MS = 30_000;

/**
 * Quiet period a trace's span set must hold, once every parent resolved, before the
 * judge reads it: a tool span ending after its parent exported lands a second later.
 */
export const TRACE_QUIET_PERIOD_MS = 2_000;

export interface RemoteTraceRunConfig {
  fetchRemoteTraces: true;
  traceWaitTimeoutMs?: number;
  traceWaitExtensionMs: number;
  traceQuietPeriodMs: number;
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
  if (targetType !== "http" && targetType !== "connected") {
    return {};
  }
  return {
    fetchRemoteTraces: true,
    ...(traceWaitTimeoutMs !== undefined ? { traceWaitTimeoutMs } : {}),
    traceWaitExtensionMs: TRACE_WAIT_CAP_MS,
    traceQuietPeriodMs: TRACE_QUIET_PERIOD_MS,
    langwatch: {
      endpoint: langwatchEndpoint,
      apiKey: langwatchApiKey,
    },
  };
}

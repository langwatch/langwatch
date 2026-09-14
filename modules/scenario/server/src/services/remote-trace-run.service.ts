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

export interface RemoteTraceRunConfig {
  fetchRemoteTraces: true;
  traceWaitTimeoutMs?: number;
  traceWaitExtensionMs: number;
  langwatch: {
    endpoint: string;
    apiKey: string;
  };
}

export class RemoteTraceRunAdapter {
  static create(): RemoteTraceRunAdapter {
    return new RemoteTraceRunAdapter();
  }

  private constructor() {}

  static build({
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
    // A connected agent's SDK adopts the turn's traceparent before it calls the
    // function, so its spans land in the turn's trace exactly as an http
    // target's do behind a traceparent middleware.
    if (targetType !== "http" && targetType !== "connected") {
      return {};
    }
    return {
      fetchRemoteTraces: true,
      ...(traceWaitTimeoutMs !== undefined ? { traceWaitTimeoutMs } : {}),
      // A measured budget can be as low as 10 seconds; the extension keeps the
      // judge's one extra wait meaningful regardless of the measured value.
      traceWaitExtensionMs: TRACE_WAIT_CAP_MS,
      langwatch: {
        endpoint: langwatchEndpoint,
        apiKey: langwatchApiKey,
      },
    };
  }
}

export const buildRemoteTraceRunConfig = RemoteTraceRunAdapter.build;

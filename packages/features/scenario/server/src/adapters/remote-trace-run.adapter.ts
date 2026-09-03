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

import type { TargetConfig } from "@langwatch/scenario-contract";

/**
 * Upper bound on the verdict-time wait, and the size of the judge's one extra
 * `wait_for_traces` wait. Production measurement (per-trace stored_spans lag,
 * 24h window): global p95 6.6s, p99 12.4s; per-tenant p95 median 8.2s, p90
 * 27.3s. 30 seconds covers the p90 tenant, and the judge-requested extension
 * covers the tail once more when the missing spans are essential.
 *
 * Lives in this child-safe module (no ClickHouse import chain) because both
 * the server-side budget clamp and the child's run configuration read it.
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

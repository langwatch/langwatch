/**
 * Bridges the trace ID from an HTTP adapter to the ES-backed judge agent.
 *
 * Wraps the judge's call() to transfer the adapter's captured trace ID
 * before each evaluation, ensuring the judge queries the correct trace's spans.
 */

import type { EsBackedJudgeAgent } from "./es-backed-judge-agent";

/**
 * Intercepts the judge's call() to set the trace ID from the adapter
 * immediately before evaluation. This ensures the judge always uses
 * the most recently captured trace ID from HTTP adapter calls.
 */
export function bridgeTraceIdFromAdapterToJudge({
  adapter,
  judge,
}: {
  adapter: { getTraceId(): string | undefined };
  judge: EsBackedJudgeAgent;
}): void {
  const originalCall = judge.call.bind(judge);
  judge.call = async (input) => {
    const traceId = adapter.getTraceId();
    if (traceId) {
      judge.setTraceId(traceId);
    }
    return originalCall(input);
  };
}

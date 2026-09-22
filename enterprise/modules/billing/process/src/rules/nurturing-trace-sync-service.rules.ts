import { findSink, reportFailure } from "./nurturing-sink-registry-service.rules.ts";

/**
 * Fires when a project's first real trace arrives — Langy's own turns and
 * seeded samples are not the customer's traces, so the caller gates on the
 * same rule trace's own first-ingest check applies before reaching here.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
export function fireFirstTraceIntegrated({
  userId,
  projectId,
  sdkLanguage,
  sdkFramework,
  traceOccurredAt,
}: {
  userId: string;
  projectId: string;
  sdkLanguage: string;
  sdkFramework: string;
  traceOccurredAt: string;
}): void {
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  void nurturing
    .identifyUser({
      userId,
      traits: {
        has_traces: true,
        sdk_language: sdkLanguage,
        sdk_framework: sdkFramework,
        first_trace_at: traceOccurredAt,
      },
    })
    .catch(reportFailure);

  void nurturing
    .trackEvent({
      userId,
      event: "first_trace_integrated",
      properties: {
        sdk_language: sdkLanguage,
        sdk_framework: sdkFramework,
        project_id: projectId,
      },
    })
    .catch(reportFailure);
}

/** A later trace from a project that already sent its first — updates the freshness trait only. */
export function identifySubsequentTrace({
  userId,
  traceOccurredAt,
}: {
  userId: string;
  traceOccurredAt: string;
}): void {
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  void nurturing
    .identifyUser({ userId, traits: { last_trace_at: traceOccurredAt } })
    .catch(reportFailure);
}

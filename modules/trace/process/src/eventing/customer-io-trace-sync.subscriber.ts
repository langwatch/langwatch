import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant, Temporal } from "@langwatch/time";
import type { TraceSummaryData, TraceProcessingEvent } from "@langwatch/trace-contract";

import type { TraceProjectMetadata } from "../app/trace.members.ts";
import { ProjectMetadataSync } from "./project-metadata.subscriber.ts";

const logger = createLogger("langwatch:trace-processing:customer-io-trace-sync");

/** CRM contract, not a queue tunable: at most one identify per project per window. */
export const CIO_TRACE_SYNC_DEBOUNCE_MS = 300_000;

/**
 * Billing's nurturing rules, injected structurally so trace never imports
 * billing's process package. Matches
 * `enterprise/modules/billing/process/src/rules/nurturing-trace-sync-service.rules.ts`.
 */
export interface CustomerIoTraceSyncDeps {
  fireFirstTraceIntegrated: (input: {
    userId: string;
    projectId: string;
    sdkLanguage: string;
    sdkFramework: string;
    traceOccurredAt: string;
  }) => void;
  identifySubsequentTrace: (input: { userId: string; traceOccurredAt: string }) => void;
}

export interface CustomerIoTraceSyncSubscriberDeps {
  projects: TraceProjectMetadata;
  traceSync: CustomerIoTraceSyncDeps;
}

// Per-project debounce for the subsequent-trace path only: the first trace
// always fires immediately (its own CRM milestone).
const lastSubsequentSyncAt = new Map<string, number>();

function isDebounced(projectId: string, now: number): boolean {
  const last = lastSubsequentSyncAt.get(projectId);
  return last !== undefined && now - last < CIO_TRACE_SYNC_DEBOUNCE_MS;
}

function traceOccurredAtOf(foldState: TraceSummaryData): string {
  return Temporal.Instant.fromEpochMilliseconds(foldState.occurredAt).toString({
    fractionalSecondDigits: 3,
  });
}

/** Project-scoped job id for the pipeline's own debounce/dedup registration. */
export function customerIoTraceSyncJobId(projectId: string): string {
  return `cio-trace-sync-${projectId}`;
}

/**
 * Reuses the `resolveOrgAdmin`-carried `firstMessage` flag rather than
 * redetecting the project's first trace: the projectMetadata subscriber
 * already owns that detection.
 */
async function syncTrace(
  deps: CustomerIoTraceSyncSubscriberDeps,
  tenantId: string,
  foldState: TraceSummaryData,
): Promise<void> {
  const { userId, firstMessage } = await deps.projects.resolveOrgAdmin(tenantId);
  if (!userId) {
    logger.warn({ tenantId }, "No admin user found for project — skipping CIO trace sync");
    return;
  }

  const traceOccurredAt = traceOccurredAtOf(foldState);

  if (!firstMessage) {
    deps.traceSync.fireFirstTraceIntegrated({
      userId,
      projectId: tenantId,
      sdkLanguage: foldState.attributes?.["sdk.language"] ?? "unknown",
      sdkFramework: foldState.attributes?.["langwatch.sdk.framework"] ?? "unknown",
      traceOccurredAt,
    });
    return;
  }

  const now = nowInstant().epochMilliseconds;
  if (isDebounced(tenantId, now)) return;
  lastSubsequentSyncAt.set(tenantId, now);
  deps.traceSync.identifySubsequentTrace({ userId, traceOccurredAt });
}

// Offered on the traceSummary fold (see project-metadata.subscriber.ts's
// sibling registration); not registered into a pipeline here — see this
// lane's handoff §10 for the worker composition line.
export function createCustomerIoTraceSyncHandler(
  deps: CustomerIoTraceSyncSubscriberDeps,
): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  return async (_event, context) => {
    const { tenantId, state: foldState } = context;

    if (!ProjectMetadataSync.isRealFirstIngest(foldState)) return;

    try {
      await syncTrace(deps, tenantId, foldState);
    } catch (error) {
      logger.error(
        {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to process CIO trace sync — non-fatal",
      );
    }
  };
}

/**
 * Resets the debounce cache. Only exposed for testing.
 * @internal
 */
export function resetCustomerIoTraceSyncDebounceCache(): void {
  lastSubsequentSyncAt.clear();
}

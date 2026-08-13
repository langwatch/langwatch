import { createLogger } from "@langwatch/observability";
import type { NurturingService } from "../../../../../../ee/billing/nurturing/nurturing.service";
import {
  captureException,
  toError,
} from "../../../../../utils/posthogErrorCapture";
import type { ProjectService } from "../../../../app-layer/projects/project.service";
import type {
  SubscriberSpec,
  TriggerContext,
} from "../../../pipeline/processManagerDefinition";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:customer-io-trace-sync",
);

/**
 * Debounce shared across all Customer.io subscriber registrations. The
 * five-minute window is the CRM contract, not a queue tunable.
 */
export const CIO_SYNC_DEBOUNCE_TTL_MS = 300_000;

export interface CustomerIoTraceSyncSubscriberDeps {
  projects: ProjectService;
  nurturing: NurturingService;
}

/**
 * Subscriber that syncs trace milestones and metrics to Customer.io.
 *
 * Offered on the trace_processing pipeline after the traceSummary fold; not
 * registered yet — the counting strategy needs finalising before enabling.
 *
 * First trace (Project.firstMessage is false):
 *   - Identifies user with has_traces, sdk_language, sdk_framework, first_trace_at
 *   - Tracks "first_trace_integrated" event
 *
 * Subsequent traces (Project.firstMessage is true):
 *   - Identifies user with last_trace_at
 *   - Debounced via dedupId with 5-minute TTL
 *
 * Reads Project.firstMessage from DB to detect first trace rather than
 * duplicating the detection logic from the projectMetadata subscriber.
 *
 * All nurturing calls are fire-and-forget with captureException.
 */
export function createCustomerIoTraceSyncSubscriber(
  deps: CustomerIoTraceSyncSubscriberDeps,
): SubscriberSpec<TraceProcessingEvent> & { fold: "traceSummary" } {
  return {
    fold: "traceSummary",
    dedupId: (event) => `cio-trace-sync-${event.tenantId}`,
    ttl: CIO_SYNC_DEBOUNCE_TTL_MS,

    async handler(
      _event: TraceProcessingEvent,
      context: TriggerContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId: projectId, state: foldState } = context;

      try {
        const { userId, firstMessage } =
          await deps.projects.resolveOrgAdmin(projectId);

        if (!userId) {
          logger.warn(
            { projectId },
            "No admin user found for project — skipping CIO trace sync",
          );
          return;
        }

        const sdkLanguage = foldState.attributes["sdk.language"] ?? "unknown";
        const sdkFramework =
          foldState.attributes["langwatch.sdk.framework"] ?? "unknown";
        const traceOccurredAt = new Date(foldState.occurredAt).toISOString();

        if (!firstMessage) {
          // First trace — fire immediately, fire-and-forget
          void deps.nurturing
            .identifyUser({
              userId,
              traits: {
                has_traces: true,
                sdk_language: sdkLanguage,
                sdk_framework: sdkFramework,
                first_trace_at: traceOccurredAt,
              },
            })
            .catch((error) => {
              logger.error(
                { projectId, error },
                "Failed to identify user for first trace",
              );
              captureException(toError(error));
            });
          void deps.nurturing
            .trackEvent({
              userId,
              event: "first_trace_integrated",
              properties: {
                sdk_language: sdkLanguage,
                sdk_framework: sdkFramework,
                project_id: projectId,
              },
            })
            .catch((error) => {
              logger.error(
                { projectId, error },
                "Failed to track first_trace_integrated event",
              );
              captureException(toError(error));
            });
        } else {
          // Subsequent trace — debounced via dedupId, fire-and-forget
          void deps.nurturing
            .identifyUser({
              userId,
              traits: {
                last_trace_at: traceOccurredAt,
              },
            })
            .catch((error) => {
              logger.error(
                { projectId, error },
                "Failed to identify user for trace update",
              );
              captureException(toError(error));
            });
        }
      } catch (error) {
        logger.error(
          { projectId, error },
          "Failed to process CIO trace sync — non-fatal",
        );
        captureException(toError(error));
      }
    },
  };
}

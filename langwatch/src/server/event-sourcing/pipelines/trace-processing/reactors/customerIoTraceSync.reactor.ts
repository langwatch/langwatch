import type { NurturingService } from "../../../../../../ee/billing/nurturing/nurturing.service";
import type { ProjectService } from "../../../../app-layer/projects/project.service";
import { createLogger } from "../../../../../utils/logger/server";
import { captureException } from "../../../../../utils/posthogErrorCapture";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:customer-io-trace-sync-reactor",
);

/** Debounce TTL shared across all Customer.io reactor registrations. */
export const CIO_REACTOR_DEBOUNCE_TTL_MS = 300_000;

export interface CustomerIoTraceSyncReactorDeps {
  projects: ProjectService;
  nurturing: NurturingService;
}

/**
 * Reactor that syncs trace milestones and metrics to Customer.io.
 *
 * Registered on the trace_processing pipeline after the traceSummary fold.
 *
 * First trace (Project.firstMessage is false):
 *   - Identifies user with has_traces, sdk_language, sdk_framework, first_trace_at
 *   - Tracks "first_trace_integrated" event
 *
 * Subsequent traces (Project.firstMessage is true):
 *   - Identifies user with last_trace_at
 *   - Debounced via makeJobId with 5-minute TTL
 *
 * Reads Project.firstMessage from DB to detect first trace rather than
 * duplicating the detection logic from projectMetadata reactor.
 *
 * All nurturing calls are fire-and-forget with captureException.
 */
export function createCustomerIoTraceSyncReactor(
  deps: CustomerIoTraceSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "customerIoTraceSync",
    options: {
      makeJobId: (payload) =>
        `cio-trace-sync-${payload.event.tenantId}`,
      ttl: CIO_REACTOR_DEBOUNCE_TTL_MS,
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId: projectId, foldState } = context;

      try {
        const { userId, firstMessage } = await deps.projects.resolveOrgAdmin(projectId);

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
            .identifyUser({ userId, traits: {
              has_traces: true,
              sdk_language: sdkLanguage,
              sdk_framework: sdkFramework,
              first_trace_at: traceOccurredAt,
            }})
            .catch((error) => {
              logger.error({ projectId, error }, "Failed to identify user for first trace");
              captureException(error);
            });
          void deps.nurturing
            .trackEvent({ userId, event: "first_trace_integrated", properties: {
              sdk_language: sdkLanguage,
              sdk_framework: sdkFramework,
              project_id: projectId,
            }})
            .catch((error) => {
              logger.error({ projectId, error }, "Failed to track first_trace_integrated event");
              captureException(error);
            });
        } else {
          // Subsequent trace — debounced via makeJobId, fire-and-forget
          void deps.nurturing
            .identifyUser({ userId, traits: {
              last_trace_at: traceOccurredAt,
            }})
            .catch((error) => {
              logger.error({ projectId, error }, "Failed to identify user for trace update");
              captureException(error);
            });
        }
      } catch (error) {
        logger.error(
          { projectId, error },
          "Failed to process CIO trace sync — non-fatal",
        );
        captureException(error);
      }
    },
  };
}

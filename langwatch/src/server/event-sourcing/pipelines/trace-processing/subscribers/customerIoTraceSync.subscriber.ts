/**
 * NOT WIRED — nothing constructs this factory, and this file is inert.
 *
 * Customer.io nurture has no live path at all. The reactor this replaces never
 * ran either, and has since been deleted, so there is nothing else to read for
 * "what actually happens today": nothing does. See the note in
 * `pipelineRegistry.registerAll()` for the counting-strategy question that has
 * to be settled first.
 *
 * Mounting it, once that lands, is one line on
 * `trace-processing/pipeline.ts`:
 * `.withEventSubscriber("customerIoTraceSync", createCustomerIoTraceSyncSubscriber({…}))`,
 * built from the pipeline's own `Deps` per ADR-077 Rule 1.
 */

import type { NurturingService } from "@ee/billing/nurturing/nurturing.service";
import { createLogger } from "@langwatch/observability";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type {
  EventSubscriberContext,
  EventSubscriberDefinition,
} from "../../../subscribers/eventSubscriber.types";
import {
  CIO_SYNC_DEBOUNCE_TTL_MS,
  nurtureFireAndForget,
} from "../../shared/nurtureSync";
import {
  ORIGIN_RESOLVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../schemas/constants";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:customer-io-trace-sync-subscriber",
);

export interface CustomerIoTraceSyncSubscriberDeps {
  projects: ProjectService;
  nurturing: NurturingService;
  /**
   * ADR-075: a subscriber receives no fold state, so the committed traceSummary
   * row is read back here instead. The sdk metadata and the trace's business
   * timestamp only exist on the fold — neither is derivable from a single
   * `span_received` event (`event.occurredAt` is INGEST time, not the trace's
   * own time). The read is I/O, so it lives in the handler where a failure
   * retries this job rather than at the enqueue seam where it would be lost.
   */
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
}

/**
 * ADR-075 Class B: syncs trace milestones and metrics to Customer.io.
 *
 * Marketing nurture data — lossy by contract. Every Customer.io call is
 * fire-and-forget, and the handler never throws: a dropped sync is a slightly
 * stale trait, not a correctness problem, and retrying a nurture identify buys
 * nothing.
 *
 * First trace (Project.firstMessage is false):
 *   - Identifies user with has_traces, sdk_language, sdk_framework, first_trace_at
 *   - Tracks "first_trace_integrated" event
 *
 * Subsequent traces (Project.firstMessage is true):
 *   - Identifies user with last_trace_at
 *
 * Reads Project.firstMessage from DB to detect first trace rather than
 * duplicating the detection logic from the projectMetadata process.
 */
export function createCustomerIoTraceSyncSubscriber(
  deps: CustomerIoTraceSyncSubscriberDeps,
): EventSubscriberDefinition<TraceProcessingEvent> {
  return {
    name: "customerIoTraceSync",
    // Genuine message events only. The traceSummary fold also folds
    // annotations, topic assignment and log/metric correlation; a trait called
    // `last_trace_at` must not move when someone annotates an old trace.
    eventTypes: [SPAN_RECEIVED_EVENT_TYPE, ORIGIN_RESOLVED_EVENT_TYPE],
    options: {
      // The reactor's `makeJobId` + `ttl` verbatim: one Customer.io sync per
      // project per 5 minutes. `extend`/`replace` are left at their defaults
      // (both true), which is exactly what the reactor's ttl resolved to.
      deduplication: {
        makeId: (event) => `cio-trace-sync-${event.tenantId}`,
        ttlMs: CIO_SYNC_DEBOUNCE_TTL_MS,
      },
    },

    async handle(
      _event: TraceProcessingEvent,
      context: EventSubscriberContext,
    ): Promise<void> {
      const projectId = context.tenantId;

      try {
        const summary = await deps.traceSummaryStore.get(context.aggregateId, {
          tenantId: createTenantId(projectId),
          aggregateId: context.aggregateId,
        });
        if (!summary) {
          logger.debug(
            { projectId, traceId: context.aggregateId },
            "Trace summary not readable — skipping CIO trace sync",
          );
          return;
        }

        const { userId, firstMessage } =
          await deps.projects.resolveOrgAdmin(projectId);

        if (!userId) {
          logger.warn(
            { projectId },
            "No admin user found for project — skipping CIO trace sync",
          );
          return;
        }

        const sdkLanguage = summary.attributes["sdk.language"] ?? "unknown";
        const sdkFramework =
          summary.attributes["langwatch.sdk.framework"] ?? "unknown";
        const traceOccurredAt = new Date(summary.occurredAt).toISOString();

        const call = {
          nurturing: deps.nurturing,
          projectId,
          userId,
          sdkLanguage,
          sdkFramework,
          traceOccurredAt,
        };
        // `Project.firstMessage` stays false until the projectMetadata process
        // has recorded one, so false here IS this project's first trace.
        if (firstMessage) {
          notifyReturningTrace(call);
        } else {
          notifyFirstTrace(call);
        }
      } catch (error) {
        // Class B is lossy by contract: never throw back into the queue, so a
        // Customer.io or store hiccup can never wedge the subscriber's group.
        logger.error(
          { projectId, error },
          "Failed to process CIO trace sync — non-fatal",
        );
        captureException(toError(error));
      }
    },
  };
}

/** What both nurture branches need. The trace itself never crosses. */
interface TraceNurtureCall {
  nurturing: NurturingService;
  projectId: string;
  userId: string;
  sdkLanguage: string;
  sdkFramework: string;
  traceOccurredAt: string;
}

/**
 * The project's first trace: the integration milestone. Fired immediately —
 * there is nothing earlier to debounce against — and fire-and-forget, so the
 * subscriber's lane never waits on Customer.io.
 */
function notifyFirstTrace({
  nurturing,
  projectId,
  userId,
  sdkLanguage,
  sdkFramework,
  traceOccurredAt,
}: TraceNurtureCall): void {
  nurtureFireAndForget({
    promise: nurturing.identifyUser({
      userId,
      traits: {
        has_traces: true,
        sdk_language: sdkLanguage,
        sdk_framework: sdkFramework,
        first_trace_at: traceOccurredAt,
      },
    }),
    logger,
    projectId,
    what: "identify user for first trace",
  });
  nurtureFireAndForget({
    promise: nurturing.trackEvent({
      userId,
      event: "first_trace_integrated",
      properties: {
        sdk_language: sdkLanguage,
        sdk_framework: sdkFramework,
        project_id: projectId,
      },
    }),
    logger,
    projectId,
    what: "track first_trace_integrated event",
  });
}

/**
 * Every trace after the first: one trait, debounced by the subscriber's dedup
 * window rather than by anything here.
 */
function notifyReturningTrace({
  nurturing,
  projectId,
  userId,
  traceOccurredAt,
}: TraceNurtureCall): void {
  nurtureFireAndForget({
    promise: nurturing.identifyUser({
      userId,
      traits: {
        last_trace_at: traceOccurredAt,
      },
    }),
    logger,
    projectId,
    what: "identify user for trace update",
  });
}

import { createLogger } from "@langwatch/observability";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import { throttledPerWindow } from "../../../reactors/throttleWindow";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:trace-update-broadcast-reactor",
);

export interface TraceUpdateBroadcastReactorDeps {
  broadcast: BroadcastService;
  hasRedis?: boolean;
}

/** Mirrors the listener-side debounce so the two windows do not stack. */
export const TRACE_UPDATE_BROADCAST_WINDOW_MS = 2_000;

/**
 * Reactor that broadcasts trace updates to connected SSE clients.
 *
 * Fires on ALL event types (recordSpan, assignTopic).
 * The frontend debounces duplicate events.
 * Broadcast failure is swallowed — it must not block the pipeline.
 */
export function createTraceUpdateBroadcastReactor(
  deps: TraceUpdateBroadcastReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "traceUpdateBroadcast",
    options: {
      runIn: ["worker"],
      // Without Redis, worker-to-web pub/sub bridge is unavailable
      disabled: deps.hasRedis === false,
      // Deliberately short. Nothing polls behind this while the live stream is
      // connected, so the window is the whole latency a watching user sees;
      // it matches the debounce the listener already applies, which puts the
      // collapsing on the side that can drop the work instead of the side that
      // has already paid to deliver it. Level-triggered, so shouldSurviveDispatch
      // stays off and the final update always arrives.
      ...throttledPerWindow({
        makeJobId: (payload) =>
          `trace-update:${payload.event.tenantId}:${payload.event.aggregateId}`,
        windowMs: TRACE_UPDATE_BROADCAST_WINDOW_MS,
      }),
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, aggregateId: traceId } = context;

      try {
        const payload = JSON.stringify({
          event: "trace_summary_updated",
          traceId,
        });

        await deps.broadcast.broadcastToTenant(
          tenantId,
          payload,
          "trace_updated",
        );

        logger.debug(
          {
            tenantId,
            traceId,
          },
          "Broadcasted trace update",
        );
      } catch (error) {
        logger.warn(
          {
            tenantId,
            traceId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to broadcast trace update — non-fatal",
        );
      }
    },
  };
}

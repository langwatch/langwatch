import { createLogger } from "../../../../../utils/logger/server";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { SuiteRunStateData } from "../projections/suiteRunState.foldProjection";
import type { SuiteRunProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:suite-run-processing:suite-run-broadcast",
);

export interface SuiteRunBroadcastReactorDeps {
  broadcast: BroadcastService;
  hasRedis?: boolean;
}

/**
 * Reactor that broadcasts suite run updates to connected SSE clients.
 *
 * Fires on ALL event types (started, scenario_result, completed).
 * The frontend debounces duplicate events.
 * Broadcast failure is swallowed — it must not block the pipeline.
 */
export function createSuiteRunBroadcastReactor(
  deps: SuiteRunBroadcastReactorDeps,
): ReactorDefinition<SuiteRunProcessingEvent, SuiteRunStateData> {
  return {
    name: "suiteRunBroadcast",
    options: {
      runIn: ["web", "worker"],
      makeJobId: (payload) =>
        `suite-run-update:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 1000,
    },

    async handle(
      _event: SuiteRunProcessingEvent,
      context: ReactorContext<SuiteRunStateData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;

      try {
        const payload = JSON.stringify({
          event: "suite_run_updated",
          suiteId: foldState.SuiteId,
          batchRunId: foldState.BatchRunId,
          setId: foldState.SetId,
          status: foldState.Status,
          progress: foldState.Progress,
          total: foldState.Total,
        });

        await deps.broadcast.broadcastToTenant(
          tenantId,
          payload,
          "suite_run_updated",
        );

        logger.debug(
          {
            tenantId,
            suiteId: foldState.SuiteId,
            batchRunId: foldState.BatchRunId,
            progress: foldState.Progress,
            total: foldState.Total,
          },
          "Broadcasted suite run update",
        );
      } catch (error) {
        logger.warn(
          {
            tenantId,
            suiteId: foldState.SuiteId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to broadcast suite run update — non-fatal",
        );
      }
    },
  };
}

import { createLogger } from "@langwatch/observability";
import type { CancellationPublisher } from "../../../../scenarios/cancellation-channel";
import { publishCancellation } from "../../../../scenarios/cancellation-channel";
import type {
  EventSubscriberContext,
  EventSubscriberDefinition,
} from "../../../subscribers/eventSubscriber.types";
import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";
import { isSimulationRunCancelRequestedEvent } from "../schemas/typeGuards";

const logger = createLogger(
  "langwatch:simulation-processing:cancellation-broadcast",
);

export interface CancellationBroadcastSubscriberDeps {
  publisher: CancellationPublisher | null;
}

/**
 * Broadcasts a cancellation signal to every worker pod over Redis pub/sub.
 * Each pod checks whether it owns the run and kills its child process if so.
 *
 * **Retried, unlike the SSE nudges it used to be classified with.** ADR-075
 * files this next to the browser pushes under "at-most-once is the design";
 * that reading is wrong, and the difference is not cosmetic. Losing an SSE
 * push costs a stale card until the next refetch. Losing this one leaves a
 * child process running — burning tokens against a provider — on a run the
 * user explicitly asked to stop, and nothing downstream ever notices. So a
 * failed publish is rethrown, which hands the job back to the queue for
 * redelivery while it is still in flight. Do not "align" this with the
 * at-most-once handlers by swallowing the error.
 *
 * What it still does not get is an outbox. The signal is only meaningful to a
 * pod running the child process right now, so durable replay minutes later
 * reaches a pod that has long since finished the run and risks acting on a run
 * id that has been reused. Queue redelivery is the right retry window; a
 * durable one is not.
 *
 * **Event-only — no fold state, no read-back.** The published message is the
 * run id and nothing else, and the run id is this pipeline's aggregate id, so
 * the event carries everything the handler needs. The `projectId` and
 * `batchRunId` this used to publish had no reader anywhere; dropping them is
 * what removed the last reason to bind to `simulationRunState`.
 *
 * `eventTypes` narrows to `cancel_requested` at the routing seam, so no
 * `enqueue.filter` is needed. The handler re-checks the type anyway: during a
 * rolling deploy a job staged by an older build can still be in the queue.
 */
export function createCancellationBroadcastSubscriber(
  deps: CancellationBroadcastSubscriberDeps,
): EventSubscriberDefinition<SimulationProcessingEvent> {
  return {
    name: "cancellationBroadcast",
    eventTypes: [SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED],

    async handle(
      event: SimulationProcessingEvent,
      context: EventSubscriberContext,
    ): Promise<void> {
      if (!isSimulationRunCancelRequestedEvent(event)) return;

      const scenarioRunId = event.data.scenarioRunId || context.aggregateId;

      if (!deps.publisher) {
        logger.warn(
          { scenarioRunId },
          "No Redis publisher available, cancellation broadcast skipped",
        );
        return;
      }

      try {
        await publishCancellation({
          publisher: deps.publisher,
          message: { scenarioRunId },
        });

        logger.debug({ scenarioRunId }, "Broadcasted cancellation signal");
      } catch (error) {
        logger.error(
          {
            scenarioRunId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to broadcast cancellation signal",
        );
        throw error;
      }
    },
  };
}

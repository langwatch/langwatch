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
  /**
   * Resolves the run's batch id for the published `CancellationMessage`.
   *
   * The reactor this replaces read `BatchRunId` off the committed
   * `simulationRunState` fold. A subscriber has no fold state
   * (`EventSubscriberContext` is tenant + aggregate only) and the
   * `cancel_requested` event carries `scenarioRunId` alone, so the one field
   * the event cannot supply is injected instead of smuggled in.
   *
   * Return `null` when the run's state cannot be found; the broadcast still
   * goes out with an empty batch id, because the sole consumer
   * (`scenario.processor.ts`) matches on `scenarioRunId` and killing the child
   * process matters more than labelling the message.
   */
  readBatchRunId: (params: {
    tenantId: string;
    scenarioRunId: string;
  }) => Promise<string | null>;
}

/**
 * Broadcasts a cancellation signal to every worker pod over Redis pub/sub
 * (ADR-075 Class A). Each pod checks whether it owns the run and kills its
 * child process if so.
 *
 * **At-most-once, by design — do not put this behind an outbox.** The signal is
 * only meaningful to a pod that is running the child process right now.
 * Replaying it later reaches a pod that has long since finished the run, so
 * durable redelivery buys nothing and risks acting on a run id that has been
 * reused. There is no outbox and no durable trace: the only retry is queue
 * redelivery while the job is still in flight, which is why a failed publish is
 * rethrown here (unlike the SSE nudges, whose loss is invisible) — a
 * cancellation that never reaches a pod leaves a run executing that a user
 * asked to stop.
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

      // Best-effort: the batch id only labels the message. A store hiccup must
      // never stop the kill signal from going out, so a failed read degrades to
      // an empty label instead of throwing the whole broadcast into redelivery.
      let batchRunId = "";
      try {
        batchRunId =
          (await deps.readBatchRunId({
            tenantId: context.tenantId,
            scenarioRunId,
          })) ?? "";
      } catch (error) {
        logger.warn(
          {
            scenarioRunId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to resolve batchRunId for cancellation broadcast — publishing without it",
        );
      }

      try {
        await publishCancellation({
          publisher: deps.publisher,
          message: {
            scenarioRunId,
            projectId: context.tenantId,
            batchRunId,
          },
        });

        logger.debug(
          { scenarioRunId, batchRunId },
          "Broadcasted cancellation signal",
        );
      } catch (error) {
        logger.error(
          {
            scenarioRunId,
            batchRunId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to broadcast cancellation signal",
        );
        throw error;
      }
    },
  };
}

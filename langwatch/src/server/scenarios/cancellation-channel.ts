/**
 * Redis pub/sub channel for distributed job cancellation.
 *
 * The cancellation broadcast reactor publishes to this channel when a
 * cancel_requested event is processed. Worker pods subscribe and kill
 * matching child processes.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:scenarios:cancellation-channel");

/** Redis pub/sub channel name for scenario job cancellations. */
export const CANCELLATION_CHANNEL = "scenario:cancel";

/** Payload published when a job should be cancelled. */
export interface CancellationMessage {
  projectId: string;
  scenarioRunId: string;
  batchRunId: string;
}

/** Minimal publisher interface (subset of ioredis). */
export interface CancellationPublisher {
  publish(channel: string, message: string): Promise<number>;
}

/** Minimal subscriber interface (subset of ioredis). */
export interface CancellationSubscriber {
  subscribe(channel: string): Promise<unknown>;
  on(event: "message", handler: (channel: string, message: string) => void): void;
  quit(): Promise<unknown>;
}

/**
 * Publish a cancellation message to the Redis channel.
 *
 * Called by the cancellationBroadcast reactor when a cancel_requested
 * event is processed. All worker pods subscribed to the channel receive
 * this message and check if they own the scenario.
 */
export async function publishCancellation({
  publisher,
  message,
}: {
  publisher: CancellationPublisher;
  message: CancellationMessage;
}): Promise<void> {
  const payload = JSON.stringify(message);
  await publisher.publish(CANCELLATION_CHANNEL, payload);
  logger.debug({ scenarioRunId: message.scenarioRunId, batchRunId: message.batchRunId }, "Cancellation published");
}

/**
 * Subscribe to the cancellation channel and invoke a handler for each message.
 *
 * Called by the scenario processor at startup. When a cancellation message
 * arrives, the handler checks if the local worker owns the scenario and
 * kills the child process.
 *
 * @returns A cleanup function that unsubscribes and closes the subscriber.
 */
export async function subscribeToCancellations({
  subscriber,
  onCancel,
}: {
  subscriber: CancellationSubscriber;
  onCancel: (message: CancellationMessage) => void;
}): Promise<() => Promise<void>> {
  await subscriber.subscribe(CANCELLATION_CHANNEL);

  subscriber.on("message", (channel, raw) => {
    if (channel !== CANCELLATION_CHANNEL) return;

    let message: CancellationMessage;
    try {
      message = JSON.parse(raw) as CancellationMessage;
    } catch {
      logger.warn({ raw }, "Received malformed cancellation message, ignoring");
      return;
    }

    onCancel(message);
  });

  return async () => {
    await subscriber.quit();
  };
}

/**
 * Redis pub/sub channel for distributed job cancellation.
 *
 * BullMQ's worker.cancelJob() is local-only — it only cancels a job on the
 * worker instance that owns it. This module provides a pub/sub mechanism so
 * the cancellation API (running on the web server) can signal any worker
 * instance to cancel a job.
 *
 * Usage:
 *   - Web server: call publishCancellation() when a cancel request arrives
 *   - Each worker: call subscribeToCancellations() at startup
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:scenarios:cancellation-channel");

/** Redis pub/sub channel name for scenario job cancellations. */
export const CANCELLATION_CHANNEL = "scenario:cancel";

/** Payload published when a job should be cancelled. */
export interface CancellationMessage {
  jobId: string;
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

/** Minimal worker interface for cancellation. */
export interface CancellationWorker {
  cancelJob(jobId: string): boolean;
}

/**
 * Publish a cancellation message to the Redis channel.
 *
 * All worker instances subscribed to the channel will receive this message
 * and attempt to cancel the job. Only the worker that owns the job will
 * actually cancel it — others treat it as a no-op.
 */
export async function publishCancellation({
  publisher,
  message,
}: {
  publisher: CancellationPublisher;
  message: CancellationMessage;
}): Promise<boolean> {
  const payload = JSON.stringify(message);
  await publisher.publish(CANCELLATION_CHANNEL, payload);
  logger.debug({ jobId: message.jobId, batchRunId: message.batchRunId }, "Cancellation published");
  return true;
}

/**
 * Subscribe a worker to the cancellation channel.
 *
 * When a cancellation message arrives for a job this worker owns,
 * worker.cancelJob() fires the AbortSignal for that job's processor function.
 * If the worker doesn't own the job, cancelJob() is a no-op.
 *
 * @returns A cleanup function that unsubscribes and closes the subscriber.
 */
export async function subscribeToCancellations({
  worker,
  subscriber,
}: {
  worker: CancellationWorker;
  subscriber: CancellationSubscriber;
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

    const owned = worker.cancelJob(message.jobId);
    if (owned) {
      logger.info({ jobId: message.jobId }, "Cancellation signal sent to active job");
    }
  });

  return async () => {
    await subscriber.quit();
  };
}

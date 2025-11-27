import {
  Queue,
  Worker,
  type Job,
  type JobsOptions,
  type QueueOptions,
  type WorkerOptions,
} from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { connection } from "../../../redis";
import { createLogger } from "../../../../utils/logger";
import { trace } from "@opentelemetry/api";
import type { SemConvAttributes } from "langwatch/observability";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "../../library/queues";
import {
  isSequentialOrderingError,
  extractPreviousSequenceNumber,
  ConfigurationError,
  QueueError,
} from "../../library/services/errorHandling";

/**
 * Context for handling ordering errors, containing all necessary information
 * for progressive delay calculation and job re-queuing.
 */
interface OrderingErrorContext<Payload> {
  job: Job<Payload>;
  error: unknown;
  previousSequence: number | null;
  progressiveDelayMs: number;
}

export class EventSourcedQueueProcessorBullMq<Payload>
  implements EventSourcedQueueProcessor<Payload>
{
  private readonly logger = createLogger("langwatch:event-sourcing:queue");
  private readonly queueName: string;
  private readonly jobName: string;
  private readonly makeJobId?: (payload: Payload) => string;
  private readonly process: (payload: Payload) => Promise<void>;
  private readonly spanAttributes?: (payload: Payload) => SemConvAttributes;
  private readonly queue: Queue<Payload, unknown, string>;
  private readonly worker: Worker<Payload>;
  private readonly delay?: number;
  private readonly redisConnection: IORedis | Cluster;
  private shutdownRequested = false;

  constructor(
    definition: EventSourcedQueueDefinition<Payload>,
    redisConnection?: IORedis | Cluster,
  ) {
    const { name, makeJobId, process, options, delay, spanAttributes } =
      definition;

    // Use provided connection if available, otherwise fall back to global connection
    const effectiveConnection = redisConnection ?? connection;

    if (!effectiveConnection) {
      throw new ConfigurationError(
        "BullMQQueueProcessor",
        "BullMQ queue processor requires Redis connection. Use memory implementation instead.",
      );
    }

    this.redisConnection = effectiveConnection;

    this.spanAttributes = spanAttributes;
    this.delay = delay;

    this.queueName = name;
    this.jobName = "queue";
    this.makeJobId = makeJobId;
    this.process = process;

    const queueOptions: QueueOptions = {
      connection: this.redisConnection,
      telemetry: new BullMQOtel(this.queueName),
      defaultJobOptions: {
        attempts: 15,
        backoff: {
          // Due to the sequential nature of event processing, we don't really want to use exponential backoff, as that
          // could cause a chain reaction of events that are laggier and laggier in processing, causing the system to
          // grind to a halt. Quick retires, coupled with our custom delay logic for event ordering errors, will
          // produce a much more resilient system.
          type: "fixed",
          delay: 2000,
        },
        delay: this.delay ?? 0,
        removeOnComplete: {
          age: 3600, // 1 hour
          count: 1000,
        },
        removeOnFail: {
          age: 60 * 60 * 24 * 7, // 7 days
        },
      },
    };
    this.queue = new Queue<Payload, unknown, string>(
      this.queueName,
      queueOptions,
    );

    const workerOptions: WorkerOptions = {
      connection: this.redisConnection,
      concurrency: options?.concurrency ?? 5,
      telemetry: new BullMQOtel(this.queueName),
    };
    this.worker = new Worker<Payload>(
      this.queueName,
      async (job) => this.processJob(job),
      workerOptions,
    );

    this.worker.on("ready", () => {
      this.logger.info(
        { queueName: this.queueName },
        "Event-sourced queue worker ready",
      );
    });

    this.worker.on("failed", (job, error) => {
      this.logger.error(
        {
          queueName: this.queueName,
          jobId: job?.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Event-sourced queue job failed",
      );
    });
  }

  /**
   * Processes a single job from the queue.
   */
  private async processJob(job: Job<Payload>): Promise<void> {
    const customAttributes = this.spanAttributes
      ? this.spanAttributes(job.data)
      : {};

    const span = trace.getActiveSpan();
    span?.setAttributes({
      ...customAttributes,
    });

    this.logger.debug(
      {
        queueName: this.queueName,
        jobId: job.id,
      },
      "Processing queue job",
    );

    try {
      await this.process(job.data);
      this.logger.debug(
        {
          queueName: this.queueName,
          jobId: job.id,
        },
        "Queue job processed successfully",
      );
    } catch (error) {
      // Detect ordering errors for better logging and potential future smart retry logic
      const isOrderingError = isSequentialOrderingError(error);
      const previousSequence = isOrderingError
        ? extractPreviousSequenceNumber(error)
        : null;

      this.logger.error(
        {
          queueName: this.queueName,
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
          isOrderingError,
          ...(previousSequence !== null
            ? { previousSequenceNumber: previousSequence }
            : {}),
        },
        isOrderingError
          ? "Queue job failed due to ordering violation - previous event not yet processed"
          : "Queue job processing failed",
      );

      // For ordering errors, we should NOT retry immediately because:
      // 1. The event is already stored in the database
      // 2. The sequence number calculation will include it, causing sequence numbers to grow
      // 3. The previous event needs to be processed first, which will happen naturally
      // Instead, we move the job to delayed state to retry later when the previous event is processed
      // IMPORTANT: We use progressive delays to prevent jobs from hitting retry limits when many
      // events arrive simultaneously. Ordering errors should wait indefinitely until their turn.
      if (isOrderingError) {
        const progressiveDelayMs = this.calculateProgressiveDelay(
          previousSequence,
          job.attemptsMade,
        );

        await this.handleOrderingError({
          job,
          error,
          previousSequence,
          progressiveDelayMs,
        });
        return;
      }

      // For non-ordering errors, throw to trigger normal retry logic
      throw error;
    }
  }

  /**
   * Calculates a progressive delay based on sequence position and attempts.
   * Higher sequence numbers wait longer, giving earlier events priority to process first.
   *
   * Formula: baseDelay + (sequenceNumber * perSequenceDelay) + (attempts * perAttemptDelay)
   * - Event 2 (waiting for seq 1): 1000 + (2 * 200) = 1400ms
   * - Event 3 (waiting for seq 2): 1000 + (3 * 200) = 1600ms
   * - Event 5 (waiting for seq 4): 1000 + (5 * 200) = 2000ms
   */
  private calculateProgressiveDelay(
    previousSequence: number | null,
    attemptsMade: number | undefined,
  ): number {
    const currentSequence = (previousSequence ?? 0) + 1;
    const baseDelayMs = 1000;
    const perSequenceDelayMs = 200;
    const perAttemptDelayMs = 200;

    const sequenceBasedDelay =
      baseDelayMs + currentSequence * perSequenceDelayMs;
    const attemptBasedDelay = (attemptsMade ?? 0) * perAttemptDelayMs;

    return Math.min(
      sequenceBasedDelay + attemptBasedDelay,
      20000, // Cap at 20 seconds
    );
  }

  /**
   * Handles ordering errors by attempting to move the job to delayed state.
   * Falls back to re-queuing if moveToDelayed fails.
   */
  private async handleOrderingError(
    context: OrderingErrorContext<Payload>,
  ): Promise<void> {
    const { job, error, previousSequence, progressiveDelayMs } = context;
    const delayedTimestamp = Date.now() + progressiveDelayMs;

    type JobWithOptionalLock = Job<Payload> & {
      takeLock?: () => Promise<boolean>;
    };
    const jobWithOptionalLock = job as JobWithOptionalLock;
    const hasTakeLock = typeof jobWithOptionalLock.takeLock === "function";

    if (!hasTakeLock) {
      await this.requeueWithFallbackDelay(
        job,
        progressiveDelayMs,
        previousSequence,
        "Ordering error: BullMQ job missing takeLock; re-enqueued with fallback delay",
        { supportsManualDelay: false },
      );
      return;
    }

    try {
      const hasLock = await jobWithOptionalLock.takeLock!();
      if (!hasLock) {
        this.logger.warn(
          {
            queueName: this.queueName,
            jobId: job.id,
            attemptsMade: job.attemptsMade,
            previousSequenceNumber: previousSequence,
          },
          "Ordering error: unable to reacquire job lock before delaying, falling back to BullMQ retry",
        );
        throw error;
      }

      await job.moveToDelayed(delayedTimestamp);

      this.logger.debug(
        {
          queueName: this.queueName,
          jobId: job.id,
          delayMs: progressiveDelayMs,
          attemptsMade: job.attemptsMade,
          previousSequenceNumber: previousSequence,
          supportsManualDelay: hasTakeLock,
        },
        "Ordering error: moved job to delayed state with progressive delay",
      );

      // Don't throw - job is moved to delayed state
      // Note: moveToDelayed doesn't increment attemptsMade, so ordering errors
      // won't consume retry attempts. The job will retry indefinitely until
      // the previous event is processed.
    } catch (moveError) {
      // If moveToDelayed fails, handle gracefully
      const moveErrorMessage =
        moveError instanceof Error ? moveError.message : String(moveError);

      if (moveErrorMessage.includes("Missing lock")) {
        await this.requeueWithFallbackDelay(
          job,
          progressiveDelayMs,
          previousSequence,
          "Ordering error: BullMQ lock missing while delaying, re-enqueued job with fallback delay",
          {
            supportsManualDelay: hasTakeLock,
            moveError: moveErrorMessage,
          },
        );
      } else {
        this.logger.warn(
          {
            queueName: this.queueName,
            jobId: job.id,
            moveError: moveErrorMessage,
            supportsManualDelay: hasTakeLock,
          },
          "Failed to move ordering error job to delayed state, will retry normally",
        );
        // Fall through to throw original error so BullMQ manages retry/backoff.
        throw error;
      }
    }
  }

  /**
   * Re-queues a job with a fallback delay when moveToDelayed is not available.
   * Uses default job options when the original job's options are not available.
   */
  private async requeueWithFallbackDelay(
    job: Job<Payload>,
    progressiveDelayMs: number,
    previousSequence: number | null,
    logMessage: string,
    extraContext?: Record<string, unknown>,
  ): Promise<void> {
    const fallbackJobId = `${job.id}:retry:${Date.now()}`;
    this.logger.warn(
      {
        queueName: this.queueName,
        jobId: job.id,
        requeueJobId: fallbackJobId,
        delayMs: progressiveDelayMs,
        attemptsMade: job.attemptsMade,
        previousSequenceNumber: previousSequence,
        ...extraContext,
      },
      logMessage,
    );

    // Use job.opts with fallback defaults in case options are not set
    const defaultJobOptions = {
      attempts: 15,
      backoff: { type: "fixed" as const, delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    };

    await this.queue.add(
      // @ts-expect-error - jobName typing
      this.jobName,
      job.data,
      {
        jobId: fallbackJobId,
        delay: progressiveDelayMs,
        attempts: job.opts?.attempts ?? defaultJobOptions.attempts,
        backoff: job.opts?.backoff ?? defaultJobOptions.backoff,
        removeOnComplete:
          job.opts?.removeOnComplete ?? defaultJobOptions.removeOnComplete,
        removeOnFail: job.opts?.removeOnFail ?? defaultJobOptions.removeOnFail,
      },
    );
  }

  async send(payload: Payload): Promise<void> {
    if (this.shutdownRequested) {
      throw new QueueError(
        this.queueName,
        "send",
        "Cannot send to queue after shutdown has been requested",
      );
    }

    const jobId = this.makeJobId ? this.makeJobId(payload) : void 0;
    const opts: JobsOptions = {
      ...(jobId ? { jobId } : {}),
      ...(this.delay !== void 0 ? { delay: this.delay } : {}),
      // When jobId is provided and a job with the same ID exists, BullMQ will
      // automatically replace it if it's still waiting. This enables batching/debouncing.
    };

    const customAttributes = this.spanAttributes
      ? this.spanAttributes(payload)
      : {};

    const span = trace.getActiveSpan();
    span?.setAttributes({ ...customAttributes });

    await this.queue.add(
      // @ts-expect-error - jobName is a string, this is stupid typing from BullMQ
      this.jobName,
      payload,
      opts,
    );
  }

  /**
   * Gracefully closes the queue processor, waiting for in-flight jobs to complete.
   * Should be called during application shutdown.
   */
  async close(): Promise<void> {
    this.shutdownRequested = true;
    this.logger.info({ queueName: this.queueName }, "Closing queue processor");

    try {
      // Close worker first to stop accepting new jobs
      if (this.worker) {
        await this.worker.close();
        this.logger.debug({ queueName: this.queueName }, "Worker closed");
      }

      // Close queue
      if (this.queue) {
        await this.queue.close();
        this.logger.debug({ queueName: this.queueName }, "Queue closed");
      }

      this.logger.info(
        { queueName: this.queueName },
        "Queue processor closed successfully",
      );
    } catch (error) {
      this.logger.error(
        {
          queueName: this.queueName,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error closing queue processor",
      );
      throw error;
    }
  }
}

import { trace } from "@opentelemetry/api";
import {
  DelayedError,
  type Job,
  type JobsOptions,
  Queue,
  QueueEvents,
  type QueueOptions,
  Worker,
  type WorkerOptions,
} from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { SemConvAttributes } from "langwatch/observability";
import { createLogger } from "../../../../utils/logger";
import { connection } from "../../../redis";
import type {
  DeduplicationConfig,
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "../../library/queues";
import {
  ConfigurationError,
  extractPreviousSequenceNumber,
  isLockError,
  isNoEventsFoundError,
  isSequentialOrderingError,
  QueueError,
} from "../../library/services/errorHandling";

/**
 * Configuration for job retry behavior.
 */
const JOB_RETRY_CONFIG = {
  /** Maximum number of retry attempts before failing permanently */
  maxAttempts: 15,
  /** Fixed backoff delay between retries in milliseconds */
  backoffDelayMs: 2000,
  /** How long to keep completed jobs (in seconds) */
  removeOnCompleteAgeSec: 3600, // 1 hour
  /** Maximum number of completed jobs to keep */
  removeOnCompleteCount: 1000,
  /** How long to keep failed jobs (in seconds) */
  removeOnFailAgeSec: 60 * 60 * 24 * 7, // 7 days
} as const;

/**
 * Configuration for progressive delay calculation when handling ordering errors.
 * Higher sequence numbers wait longer, giving earlier events priority.
 *
 * These delays should be short since we're just polling for the previous event's
 * checkpoint to appear. Actual event processing is typically fast (10-100ms),
 * so we use short polling intervals to minimize latency when events arrive together.
 */
const PROGRESSIVE_DELAY_CONFIG = {
  /** Base delay before any sequence-based adjustment */
  baseDelayMs: 100,
  /** Additional delay per sequence number position */
  perSequenceDelayMs: 50,
  /** Additional delay per retry attempt */
  perAttemptDelayMs: 50,
  /** Maximum delay cap to prevent excessive waits */
  maxDelayMs: 5000,
} as const;

/**
 * Configuration for exponential backoff when events are not yet visible in ClickHouse.
 * This handles the "No events found for aggregate" error caused by replication lag.
 * Uses exponential backoff since we're waiting for data replication which can take variable time.
 *
 * Formula: min(baseDelayMs * (multiplier ^ attemptsMade), maxDelayMs)
 * Attempt 0: 2000ms, Attempt 1: 4000ms, Attempt 2: 8000ms, Attempt 3: 16000ms, etc.
 */
const NO_EVENTS_FOUND_DELAY_CONFIG = {
  /** Initial delay for first retry */
  baseDelayMs: 2000,
  /** Multiplier for exponential growth */
  multiplier: 2,
  /** Maximum delay cap */
  maxDelayMs: 60000,
} as const;

/**
 * Default worker configuration.
 */
const WORKER_CONFIG = {
  /** Default concurrency for job processing */
  defaultConcurrency: 50,
} as const;

/**
 * Configuration for graceful shutdown.
 */
const SHUTDOWN_CONFIG = {
  /** Maximum time to wait for graceful shutdown in milliseconds */
  timeoutMs: 20000,
} as const;

/** Default TTL for deduplication in milliseconds */
const DEFAULT_DEDUPLICATION_TTL_MS = 200;

export class EventSourcedQueueProcessorBullMq<Payload>
  implements EventSourcedQueueProcessor<Payload>
{
  private readonly logger = createLogger("langwatch:event-sourcing:queue");
  private readonly queueName: string;
  private readonly jobName: string;
  private readonly process: (payload: Payload) => Promise<void>;
  private readonly spanAttributes?: (payload: Payload) => SemConvAttributes;
  private readonly queue: Queue<Payload, unknown, string>;
  private readonly worker: Worker<Payload>;
  private readonly queueEvents: QueueEvents;
  private readonly delay?: number;
  private readonly deduplication?: DeduplicationConfig<Payload>;
  private readonly redisConnection: IORedis | Cluster;
  private shutdownRequested = false;

  constructor(
    definition: EventSourcedQueueDefinition<Payload>,
    redisConnection?: IORedis | Cluster,
  ) {
    const { name, process, options, delay, spanAttributes, deduplication } =
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
    this.deduplication = deduplication;
    this.queueName = name;
    this.jobName = "queue";
    this.process = process;

    const queueOptions: QueueOptions = {
      connection: this.redisConnection,
      telemetry: new BullMQOtel(this.queueName),
      defaultJobOptions: {
        attempts: JOB_RETRY_CONFIG.maxAttempts,
        backoff: {
          // Due to the sequential nature of event processing, we don't really want to use exponential backoff, as that
          // could cause a chain reaction of events that are laggier and laggier in processing, causing the system to
          // grind to a halt. Quick retires, coupled with our custom delay logic for event ordering errors, will
          // produce a much more resilient system.
          type: "fixed",
          delay: JOB_RETRY_CONFIG.backoffDelayMs,
        },
        delay: this.delay ?? 0,
        removeOnComplete: {
          age: JOB_RETRY_CONFIG.removeOnCompleteAgeSec,
          count: JOB_RETRY_CONFIG.removeOnCompleteCount,
        },
        removeOnFail: {
          age: JOB_RETRY_CONFIG.removeOnFailAgeSec,
        },
      },
    };
    this.queue = new Queue<Payload, unknown, string>(
      this.queueName,
      queueOptions,
    );

    const workerOptions: WorkerOptions = {
      connection: this.redisConnection,
      concurrency: options?.concurrency ?? WORKER_CONFIG.defaultConcurrency,
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
      // Don't log ordering/lock/replication-lag errors at ERROR level - they're expected behavior
      if (this.isExpectedError(error)) {
        this.logger.debug(
          {
            queueName: this.queueName,
            jobId: job?.id,
            error: error instanceof Error ? error.message : String(error),
          },
          this.getExpectedErrorMessage(error),
        );
        return;
      }

      this.logger.error(
        {
          queueName: this.queueName,
          jobId: job?.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Event-sourced queue job failed",
      );
    });

    // Listen for deduplication events to debug job deduplication behavior
    // Note: QueueEvents can share the same Redis connection as Queue/Worker
    this.queueEvents = new QueueEvents(this.queueName, {
      connection: this.redisConnection,
    });

    this.queueEvents.on(
      "deduplicated",
      ({ jobId, deduplicationId, deduplicatedJobId }) => {
        this.logger.debug(
          {
            queueName: this.queueName,
            existingJobId: jobId,
            deduplicationId,
            deduplicatedJobId,
          },
          "Job deduplicated",
        );
      },
    );
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
      // Detect expected errors - ordering and lock contention are normal when events arrive close together
      const isOrderingError = isSequentialOrderingError(error);
      const isLockContention = isLockError(error);

      // For ordering errors, re-queue with progressive delay
      if (isOrderingError) {
        const previousSequence = extractPreviousSequenceNumber(error);
        const progressiveDelayMs = this.calculateProgressiveDelay(
          previousSequence,
          job.attemptsMade,
        );

        this.logger.debug(
          {
            queueName: this.queueName,
            jobId: job.id,
            delayMs: progressiveDelayMs,
            attemptsMade: job.attemptsMade,
            previousSequenceNumber: previousSequence,
          },
          "Re-queuing job with delay due to ordering (previous event not yet processed)",
        );

        const targetTimestamp = Date.now() + progressiveDelayMs;
        await job.moveToDelayed(targetTimestamp, job.token);
        // Throw DelayedError to tell BullMQ not to try to complete the job
        // (the job has been moved to delayed state, so there's nothing to complete)
        throw new DelayedError();
      }

      // For lock contention, log at DEBUG and let BullMQ handle retry
      if (isLockContention) {
        this.logger.debug(
          {
            queueName: this.queueName,
            jobId: job.id,
            error: error instanceof Error ? error.message : String(error),
          },
          "Lock contention detected, will retry (expected behavior)",
        );
        throw error;
      }

      // For "no events found" errors (ClickHouse replication lag), use exponential backoff
      // Note: BullMQ doesn't increment attemptsMade for DelayedError, so we track retries in job.data
      if (isNoEventsFoundError(error)) {
        const jobData = job.data as Payload & {
          _noEventsFoundRetryCount?: number;
        };
        const currentRetryCount = jobData._noEventsFoundRetryCount ?? 0;
        const nextRetryCount = currentRetryCount + 1;

        // Update job data with incremented retry count
        await job.updateData({
          ...jobData,
          _noEventsFoundRetryCount: nextRetryCount,
        });

        const exponentialDelayMs =
          this.calculateExponentialBackoff(currentRetryCount);

        this.logger.debug(
          {
            queueName: this.queueName,
            jobId: job.id,
            delayMs: exponentialDelayMs,
            noEventsFoundRetryCount: nextRetryCount,
          },
          "Re-queuing job with exponential backoff due to events not yet visible in ClickHouse",
        );

        const targetTimestamp = Date.now() + exponentialDelayMs;
        await job.moveToDelayed(targetTimestamp, job.token);
        throw new DelayedError();
      }

      // Non-expected errors are actual failures
      this.logger.error(
        {
          queueName: this.queueName,
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
        },
        "Queue job processing failed",
      );

      throw error;
    }
  }

  /**
   * Checks if an error is an expected error type that should be logged at DEBUG level.
   * Expected errors include ordering errors, lock contention, and ClickHouse replication lag.
   */
  private isExpectedError(error: unknown): boolean {
    return (
      isSequentialOrderingError(error) ||
      isLockError(error) ||
      isNoEventsFoundError(error)
    );
  }

  /**
   * Returns the appropriate log message for an expected error type.
   */
  private getExpectedErrorMessage(error: unknown): string {
    if (isSequentialOrderingError(error)) {
      return "Job delayed due to ordering (previous event not yet processed)";
    }
    if (isLockError(error)) {
      return "Job failed due to lock contention, will retry";
    }
    return "Job delayed due to events not yet visible in ClickHouse";
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

    const sequenceBasedDelay =
      PROGRESSIVE_DELAY_CONFIG.baseDelayMs +
      currentSequence * PROGRESSIVE_DELAY_CONFIG.perSequenceDelayMs;
    const attemptBasedDelay =
      (attemptsMade ?? 0) * PROGRESSIVE_DELAY_CONFIG.perAttemptDelayMs;

    return Math.min(
      sequenceBasedDelay + attemptBasedDelay,
      PROGRESSIVE_DELAY_CONFIG.maxDelayMs,
    );
  }

  /**
   * Calculates exponential backoff delay for "no events found" errors.
   * Used when events aren't yet visible in ClickHouse due to replication lag.
   *
   * Formula: min(baseDelayMs * (multiplier ^ attemptsMade), maxDelayMs)
   * - Attempt 0: 2000ms
   * - Attempt 1: 4000ms
   * - Attempt 2: 8000ms
   * - Attempt 3: 16000ms
   * - Attempt 4: 32000ms
   * - Attempt 5+: 60000ms (capped)
   */
  private calculateExponentialBackoff(
    attemptsMade: number | undefined,
  ): number {
    const attempts = attemptsMade ?? 0;
    const delay =
      NO_EVENTS_FOUND_DELAY_CONFIG.baseDelayMs *
      NO_EVENTS_FOUND_DELAY_CONFIG.multiplier ** attempts;

    return Math.min(delay, NO_EVENTS_FOUND_DELAY_CONFIG.maxDelayMs);
  }

  /**
   * Generates a unique job ID for the payload.
   * Uses payload.id if available (for Event payloads), otherwise generates a random ID.
   * Format: ${queueName}:${payloadId}
   */
  private generateJobId(payload: Payload): string {
    const payloadWithId = payload as { id?: string };
    const payloadId = payloadWithId.id ?? crypto.randomUUID();
    // Sanitize for BullMQ (replace colons with dots)
    return `${this.queueName}.${payloadId}`.replaceAll(":", ".");
  }

  async send(payload: Payload): Promise<void> {
    if (this.shutdownRequested) {
      throw new QueueError(
        this.queueName,
        "send",
        "Cannot send to queue after shutdown has been requested",
      );
    }

    const jobId = this.generateJobId(payload);
    const opts: JobsOptions = {
      jobId,
      ...(this.delay !== void 0 ? { delay: this.delay } : {}),
      ...(this.deduplication !== void 0
        ? {
            deduplication: {
              // Sanitize deduplication ID for BullMQ (replace colons with dots)
              id: this.deduplication.makeId(payload).replaceAll(":", "."),
              ttl: this.deduplication.ttlMs ?? DEFAULT_DEDUPLICATION_TTL_MS,
              // Enable Debounce Mode by default: new jobs replace existing ones and reset TTL
              // This ensures the latest event is always processed, and batch processor catches up on missed events
              extend: this.deduplication.extend ?? true,
              replace: this.deduplication.replace ?? true,
            },
          }
        : {}),
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
   * Pauses the worker from accepting new jobs while allowing current jobs to complete.
   * Called during graceful shutdown.
   */
  async pause(): Promise<void> {
    if (this.worker) {
      await this.worker.pause();
      this.logger.info(
        { queueName: this.queueName },
        "Queue worker paused - no longer accepting new jobs",
      );
    }
  }

  /**
   * Gracefully closes the queue processor, waiting for in-flight jobs to complete.
   * Times out after SHUTDOWN_CONFIG.timeoutMs to prevent indefinite hangs.
   * Should be called during application shutdown.
   */
  async close(): Promise<void> {
    this.shutdownRequested = true;
    this.logger.info({ queueName: this.queueName }, "Closing queue processor");

    const closeWithTimeout = async (): Promise<void> => {
      // Pause worker first to stop accepting new jobs and wait for current jobs to complete
      if (this.worker) {
        await this.worker.pause();
        this.logger.debug({ queueName: this.queueName }, "Worker paused");
      }

      // Close worker - this waits for all active jobs to complete before closing
      // Do NOT pass force=true as that would force immediate close without waiting
      if (this.worker) {
        await this.worker.close();
        this.logger.debug({ queueName: this.queueName }, "Worker closed");
      }

      // Close queue
      if (this.queue) {
        await this.queue.close();
        this.logger.debug({ queueName: this.queueName }, "Queue closed");
      }

      // Close queue events listener
      if (this.queueEvents) {
        await this.queueEvents.close();
        this.logger.debug({ queueName: this.queueName }, "Queue events closed");
      }
    };

    try {
      await Promise.race([
        closeWithTimeout(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new QueueError(
                  this.queueName,
                  "close",
                  `Shutdown timed out after ${SHUTDOWN_CONFIG.timeoutMs}ms`,
                ),
              ),
            SHUTDOWN_CONFIG.timeoutMs,
          ),
        ),
      ]);

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

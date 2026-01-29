import { context as otContext, SpanKind, trace } from "@opentelemetry/api";
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
import {
  type JobContextMetadata,
  createContextFromJobData,
  getJobContextMetadata,
  runWithContext,
} from "../../../context/asyncContext";
import {
  type BullMQQueueState,
  getBullMQJobWaitDurationHistogram,
  setBullMQJobCount,
} from "../../../metrics";
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
import {
  calculateExponentialBackoff,
  calculateLockContentionDelay,
  calculateProgressiveDelay,
} from "./calculateDelays";

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

/** Interval for collecting queue metrics in milliseconds */
const QUEUE_METRICS_INTERVAL_MS = 15000;

/**
 * Type for job data that includes context metadata for trace correlation.
 */
type JobDataWithContext<Payload> = Payload & {
  __context?: JobContextMetadata;
};

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
  private metricsInterval: ReturnType<typeof setInterval> | null = null;

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
      // All errors are already logged with full details in processJob().
      // This handler only logs at DEBUG level to avoid duplicate ERROR logs.
      // Expected errors (ordering/lock/replication-lag) get a specific message,
      // unexpected errors just note that the job failed.
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

      this.logger.debug(
        {
          queueName: this.queueName,
          jobId: job?.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Event-sourced queue job failed (details logged above)",
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

    // Start periodic queue metrics collection
    this.startMetricsCollection();
  }

  /**
   * Starts periodic collection of queue metrics.
   */
  private startMetricsCollection(): void {
    // Collect immediately
    void this.collectQueueMetrics();

    // Then collect periodically
    this.metricsInterval = setInterval(() => {
      void this.collectQueueMetrics();
    }, QUEUE_METRICS_INTERVAL_MS);
  }

  /**
   * Collects and reports queue metrics to Prometheus.
   */
  private async collectQueueMetrics(): Promise<void> {
    try {
      const counts = await this.queue.getJobCounts();

      // Report each state as a gauge metric
      const states: Array<{ state: BullMQQueueState; count: number }> = [
        { state: "waiting", count: counts.waiting ?? 0 },
        { state: "active", count: counts.active ?? 0 },
        { state: "completed", count: counts.completed ?? 0 },
        { state: "failed", count: counts.failed ?? 0 },
        { state: "delayed", count: counts.delayed ?? 0 },
        { state: "paused", count: counts.paused ?? 0 },
        { state: "prioritized", count: counts.prioritized ?? 0 },
        { state: "waiting-children", count: counts["waiting-children"] ?? 0 },
      ];

      for (const { state, count } of states) {
        setBullMQJobCount(this.queueName, state, count);
      }
    } catch (error) {
      this.logger.debug(
        {
          queueName: this.queueName,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to collect queue metrics",
      );
    }
  }

  /**
   * Stops the periodic metrics collection.
   */
  private stopMetricsCollection(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  /**
   * Processes a single job from the queue.
   */
  private async processJob(job: Job<JobDataWithContext<Payload>>): Promise<void> {
    // Extract context metadata from job data
    const jobData = job.data;
    const contextMetadata = jobData.__context;

    // Create request context from job metadata
    const requestContext = createContextFromJobData(contextMetadata);

    // Record job wait time (time from enqueue to processing start)
    if (job.timestamp) {
      const waitTimeMs = Date.now() - job.timestamp;
      getBullMQJobWaitDurationHistogram(this.queueName).observe(waitTimeMs);
    }

    // Run the job processing within the restored context
    return runWithContext(requestContext, async () => {
      const customAttributes = this.spanAttributes
        ? this.spanAttributes(jobData)
        : {};

      const span = trace.getActiveSpan();
      span?.setAttributes({
        ...customAttributes,
        // Add context attributes to the span
        ...(contextMetadata?.organizationId && {
          "organization.id": contextMetadata.organizationId,
        }),
        ...(contextMetadata?.projectId && {
          "tenant.id": contextMetadata.projectId,
        }),
        ...(contextMetadata?.userId && {
          "user.id": contextMetadata.userId,
        }),
      });

      // If we have a parent trace context, create a link to it
      if (contextMetadata?.traceId && contextMetadata?.parentSpanId) {
        span?.addLink({
          context: {
            traceId: contextMetadata.traceId,
            spanId: contextMetadata.parentSpanId,
            traceFlags: 1, // sampled
          },
        });
      }

      this.logger.debug(
        {
          queueName: this.queueName,
          jobId: job.id,
          traceId: requestContext.traceId,
          organizationId: requestContext.organizationId,
          projectId: requestContext.projectId,
        },
        "Processing queue job",
      );

      try {
        // Pass the original payload without context metadata to the processor
        await this.process(jobData);
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
          const progressiveDelayMs = calculateProgressiveDelay(
            previousSequence,
            job.attemptsStarted,
          );

          this.logger.debug(
            {
              queueName: this.queueName,
              jobId: job.id,
              delayMs: progressiveDelayMs,
              attemptsStarted: job.attemptsStarted,
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

        // For lock contention, delay significantly since the lock holder will process all events
        // Use DelayedError so it doesn't count against retry attempts
        if (isLockContention) {
          const lockContentionDelayMs = calculateLockContentionDelay(
            job.attemptsStarted,
          );

          this.logger.debug(
            {
              queueName: this.queueName,
              jobId: job.id,
              delayMs: lockContentionDelayMs,
              attemptsStarted: job.attemptsStarted,
            },
            "Lock contention detected, delaying job (lock holder will process all events)",
          );

          const targetTimestamp = Date.now() + lockContentionDelayMs;
          await job.moveToDelayed(targetTimestamp, job.token);
          throw new DelayedError();
        }

        // For "no events found" errors (ClickHouse replication lag), use exponential backoff
        if (isNoEventsFoundError(error)) {
          const exponentialDelayMs = calculateExponentialBackoff(
            job.attemptsStarted,
          );

          this.logger.debug(
            {
              queueName: this.queueName,
              jobId: job.id,
              delayMs: exponentialDelayMs,
              attemptsStarted: job.attemptsStarted,
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
    });
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

  async waitUntilReady(): Promise<void> {
    await this.worker.waitUntilReady();
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

    // Get current context metadata and attach it to the job payload for trace correlation
    const contextMetadata = getJobContextMetadata();
    const payloadWithContext: JobDataWithContext<Payload> = {
      ...payload,
      __context: contextMetadata,
    };

    await this.queue.add(
      // @ts-expect-error - jobName is a string, this is stupid typing from BullMQ
      this.jobName,
      payloadWithContext,
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
    this.stopMetricsCollection();
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

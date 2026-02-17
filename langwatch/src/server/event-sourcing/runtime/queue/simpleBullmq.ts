import {
  type Job,
  type JobsOptions,
  Queue,
  type QueueOptions,
  Worker,
  type WorkerOptions,
} from "bullmq";
import { createQueueTelemetry, createWorkerTelemetry } from "~/server/background/bullmqTelemetry";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { SemConvAttributes } from "langwatch/observability";
import { createLogger } from "../../../../utils/logger/server";
import { connection } from "../../../redis";
import {
  type JobContextMetadata,
  createContextFromJobData,
  getJobContextMetadata,
  runWithContext,
} from "../../../context/asyncContext";
import {
  type BullMQQueueState,
  recordJobWaitDuration,
  setBullMQJobCount,
} from "../../../metrics";
import type {
  DeduplicationConfig,
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "../../library/queues";
import {
  ConfigurationError,
  QueueError,
} from "../../library/services/errorHandling";

import { trace } from "@opentelemetry/api";

/**
 * Configuration for job retry behavior.
 */
const JOB_RETRY_CONFIG = {
  maxAttempts: 15,
  backoffDelayMs: 2000,
  removeOnCompleteAgeSec: 3600,
  removeOnCompleteCount: 100,
  removeOnFailAgeSec: 60 * 60 * 24 * 7, // 7 days
} as const;

/**
 * Configuration for the simple queue.
 */
const SIMPLE_QUEUE_CONFIG = {
  /** Default concurrency */
  defaultConcurrency: 20,
  /** Interval for collecting queue metrics in milliseconds */
  metricsIntervalMs: 15000,
  /** Maximum time to wait for graceful shutdown in milliseconds */
  shutdownTimeoutMs: 20000,
} as const;

/**
 * Legacy container type where payload was wrapped in __payload.
 * Only used for reading jobs that were enqueued before the format change.
 */
type LegacyJobContainer<Payload> = {
  __payload: Payload;
  __context?: JobContextMetadata;
};

/**
 * Simple BullMQ queue processor for event handlers.
 *
 * Unlike GroupQueueProcessorBullMq, this has no staging layer, no Lua scripts,
 * and no dispatcher loop. Jobs go directly to BullMQ. Deduplication uses
 * BullMQ's native jobId mechanism.
 *
 * Use for event handlers that process individual events independently
 * (no sequential ordering needed).
 */
export class SimpleBullmqQueueProcessor<
  Payload,
> implements EventSourcedQueueProcessor<Payload> {
  private readonly logger = createLogger(
    "langwatch:event-sourcing:simple-queue",
  );
  private readonly queueName: string;
  private readonly jobName: string;
  private readonly process: (payload: Payload) => Promise<void>;
  private readonly spanAttributes?: (payload: Payload) => SemConvAttributes;
  private readonly queue: Queue<Payload, unknown, string>;
  private readonly worker: Worker<Payload>;
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

    const effectiveConnection = redisConnection ?? connection;
    if (!effectiveConnection) {
      throw new ConfigurationError(
        "SimpleBullmqQueueProcessor",
        "Simple queue processor requires Redis connection.",
      );
    }

    this.redisConnection = effectiveConnection;
    this.spanAttributes = spanAttributes;
    this.delay = delay;
    this.deduplication = deduplication;
    this.queueName = name;
    this.jobName = "queue";
    this.process = process;

    const concurrency =
      options?.concurrency ?? SIMPLE_QUEUE_CONFIG.defaultConcurrency;

    // BullMQ Queue for job persistence
    const queueOptions: QueueOptions = {
      connection: this.redisConnection,
      telemetry: createQueueTelemetry(this.queueName),
      defaultJobOptions: {
        attempts: JOB_RETRY_CONFIG.maxAttempts,
        backoff: {
          type: "fixed",
          delay: JOB_RETRY_CONFIG.backoffDelayMs,
        },
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

    // BullMQ Worker
    const workerOptions: WorkerOptions = {
      connection: this.redisConnection,
      concurrency,
      telemetry: createWorkerTelemetry(this.queueName),
    };
    this.worker = new Worker<Payload>(
      this.queueName,
      async (job, token) => this.processJob(job, token),
      workerOptions,
    );

    this.worker.on("ready", () => {
      this.logger.info(
        { queueName: this.queueName },
        "Simple queue worker ready",
      );
    });

    this.worker.on("failed", (job, error) => {
      this.logger.error(
        {
          queueName: this.queueName,
          jobId: job?.id,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : void 0,
        },
        "Simple queue job failed",
      );
    });

    // Start metrics collection
    this.startMetricsCollection();
  }

  /**
   * Sends a job directly to BullMQ.
   * Uses native BullMQ jobId for deduplication if configured.
   */
  async send(payload: Payload): Promise<void> {
    if (this.shutdownRequested) {
      throw new QueueError(
        this.queueName,
        "send",
        "Cannot send to queue after shutdown has been requested",
      );
    }

    // Attach context metadata to the payload
    const contextMetadata = getJobContextMetadata();
    const payloadWithContext = {
      ...(payload as Record<string, unknown>),
      __context: contextMetadata,
    };

    // Add span attributes
    const span = trace.getActiveSpan();
    if (span) {
      const customAttributes = this.spanAttributes
        ? this.spanAttributes(payload)
        : {};
      span.setAttributes({ ...customAttributes });
    }

    const opts: JobsOptions = {};

    // Dedup via BullMQ native jobId
    if (this.deduplication) {
      const dedupId = this.deduplication.makeId(payload).replaceAll(":", ".");
      opts.deduplication = {
        id: dedupId,
        ttl: this.deduplication.ttlMs ?? 200,
      };
    }

    // Support delay
    if (this.delay && this.delay > 0) {
      opts.delay = this.delay;
    }

    await this.queue.add(
      // @ts-expect-error - jobName is a string, this is stupid typing from BullMQ
      this.jobName,
      payloadWithContext as unknown as Payload,
      opts,
    );

    this.logger.debug({ queueName: this.queueName }, "Job sent to BullMQ");
  }

  /**
   * Processes a single job from BullMQ.
   * Handles CH replication lag with exponential backoff.
   */
  private async processJob(job: Job<Payload>, token?: string): Promise<void> {
    // Extract payload and context, supporting both legacy __payload wrapper and new flat format
    const rawData = job.data as Record<string, unknown>;
    let payload: Payload;
    let contextMetadata: JobContextMetadata | undefined;

    if ("__payload" in rawData && rawData.__payload !== undefined) {
      const legacy = rawData as unknown as LegacyJobContainer<Payload>;
      payload = legacy.__payload;
      contextMetadata = legacy.__context;
    } else {
      // Strip internal metadata fields
      const { __context, ...rest } = rawData;
      payload = rest as Payload;
      contextMetadata = __context as JobContextMetadata | undefined;
    }

    const requestContext = createContextFromJobData(contextMetadata);

    recordJobWaitDuration(job, this.queueName);

    return runWithContext(requestContext, async () => {
      const customAttributes = this.spanAttributes
        ? this.spanAttributes(payload)
        : {};

      const span = trace.getActiveSpan();
      span?.setAttributes({
        ...customAttributes,
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

      if (contextMetadata?.traceId && contextMetadata?.parentSpanId) {
        span?.addLink({
          context: {
            traceId: contextMetadata.traceId,
            spanId: contextMetadata.parentSpanId,
            traceFlags: 1,
          },
        });
      }

      this.logger.debug(
        {
          queueName: this.queueName,
          jobId: job.id,
        },
        "Processing simple queue job",
      );

      try {
        await this.process(payload);
        this.logger.debug(
          {
            queueName: this.queueName,
            jobId: job.id,
          },
          "Simple queue job processed successfully",
        );
      } catch (error) {
        // Let BullMQ's retry mechanism handle errors
        throw error;
      }
    });
  }

  /**
   * Starts periodic metrics collection.
   */
  private startMetricsCollection(): void {
    void this.collectMetrics();
    this.metricsInterval = setInterval(() => {
      void this.collectMetrics();
    }, SIMPLE_QUEUE_CONFIG.metricsIntervalMs);
  }

  /**
   * Collects and reports queue metrics.
   */
  private async collectMetrics(): Promise<void> {
    try {
      const counts = await this.queue.getJobCounts();
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
        "Failed to collect simple queue metrics",
      );
    }
  }

  private stopMetricsCollection(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  async waitUntilReady(): Promise<void> {
    await this.worker.waitUntilReady();
  }

  async close(): Promise<void> {
    this.shutdownRequested = true;
    this.stopMetricsCollection();
    this.logger.info(
      { queueName: this.queueName },
      "Closing simple queue processor",
    );

    const closeWithTimeout = async (): Promise<void> => {
      if (this.worker) {
        await this.worker.pause();
        this.logger.debug({ queueName: this.queueName }, "Worker paused");
      }

      if (this.worker) {
        await this.worker.close();
        this.logger.debug({ queueName: this.queueName }, "Worker closed");
      }

      if (this.queue) {
        await this.queue.close();
        this.logger.debug({ queueName: this.queueName }, "Queue closed");
      }
    };

    try {
      let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        closeWithTimeout(),
        new Promise<never>((_, reject) => {
          shutdownTimer = setTimeout(
            () =>
              reject(
                new QueueError(
                  this.queueName,
                  "close",
                  `Shutdown timed out after ${SIMPLE_QUEUE_CONFIG.shutdownTimeoutMs}ms`,
                ),
              ),
            SIMPLE_QUEUE_CONFIG.shutdownTimeoutMs,
          );
        }),
      ]);
      clearTimeout(shutdownTimer);

      this.logger.info(
        { queueName: this.queueName },
        "Simple queue processor closed successfully",
      );
    } catch (error) {
      this.logger.error(
        {
          queueName: this.queueName,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error closing simple queue processor",
      );
      throw error;
    }
  }
}

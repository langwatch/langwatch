import {
	type Job,
	type JobsOptions,
  type BulkJobOptions,
	Queue,
	type QueueOptions,
	Worker,
	type WorkerOptions,
} from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { SemConvAttributes } from "langwatch/observability";
import { createLogger } from "../../../utils/logger/server";
import {
	type JobContextMetadata,
	getJobContextMetadata,
} from "../../context/asyncContext";
import { connection } from "../../redis";
import type {
	DeduplicationConfig,
	EventSourcedQueueDefinition,
	EventSourcedQueueProcessor,
} from "../queues";
import {
	ConfigurationError,
	QueueError,
} from "../services/errorHandling";

import { trace } from "@opentelemetry/api";
import {
	JOB_RETRY_CONFIG,
	collectBullMQMetrics,
	extractJobPayload,
	processJobWithContext,
} from "./shared";

/**
 * Configuration for the simple queue.
 */
const SIMPLE_QUEUE_CONFIG = {
  /** Default concurrency */
  defaultConcurrency: 20,
  /** Interval for collecting queue metrics in milliseconds */
  metricsIntervalMs: 15000,
  /** Maximum time to wait for graceful shutdown in milliseconds */
  shutdownTimeoutMs:
    process.env.NODE_ENV === "development" || process.env.ENVIRONMENT === "local"
      ? 2000
      : 20000,
} as const;

/**
 * Internal payload structure that includes context metadata for propagation.
 */
type InternalJobPayload<Payload> = Payload & {
  __context: JobContextMetadata | undefined;
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
  Payload extends Record<string, unknown>,
> implements EventSourcedQueueProcessor<Payload> {
  private readonly logger = createLogger(
    "langwatch:event-sourcing:simple-queue",
  );
  private readonly queueName: string;
  private readonly jobName: string;
  private readonly process: (payload: Payload) => Promise<void>;
  private readonly spanAttributes?: (payload: Payload) => SemConvAttributes;
  private readonly queue: Queue<InternalJobPayload<Payload>, unknown, string>;
  private readonly worker: Worker<InternalJobPayload<Payload>>;
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
      telemetry: new BullMQOtel(this.queueName),
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
    this.queue = new Queue<InternalJobPayload<Payload>, unknown, string>(
      this.queueName,
      queueOptions,
    );

    // BullMQ Worker
    const workerOptions: WorkerOptions = {
      connection: this.redisConnection,
      concurrency,
      telemetry: new BullMQOtel(this.queueName),
    };
    this.worker = new Worker<InternalJobPayload<Payload>>(
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
    const payloadWithContext: InternalJobPayload<Payload> = {
      ...payload,
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
      // @ts-expect-error - BullMQ expects string literal union but jobName is dynamic
      this.jobName,
      payloadWithContext,
      opts,
    );

    this.logger.debug({ queueName: this.queueName }, "Job sent to BullMQ");
  }

  async sendBatch(payloads: Payload[]): Promise<void> {
    if (this.shutdownRequested) {
      throw new QueueError(
        this.queueName,
        "sendBatch",
        "Cannot send to queue after shutdown has been requested",
      );
    }

    if (payloads.length === 0) {
      return;
    }

    const contextMetadata = getJobContextMetadata();

    const jobs = payloads.map((payload) => {
      const payloadWithContext: InternalJobPayload<Payload> = {
        ...payload,
        __context: contextMetadata,
      };

      const opts: JobsOptions = {};

      if (this.deduplication) {
        const dedupId = this.deduplication.makeId(payload).replaceAll(":", ".");
        opts.deduplication = {
          id: dedupId,
          ttl: this.deduplication.ttlMs ?? 200,
        };
      }

      if (this.delay && this.delay > 0) {
        opts.delay = this.delay;
      }

      return {
        name: this.jobName as string,
        data: payloadWithContext,
        opts,
      };
    });

    await this.queue.addBulk(jobs as any);

    this.logger.debug(
      { queueName: this.queueName, count: payloads.length },
      "Batch of jobs sent to BullMQ",
    );
  }

  private async processJob(
    job: Job<InternalJobPayload<Payload>>,
    _token?: string,
  ): Promise<void> {
    const { payload, contextMetadata } =
      extractJobPayload<InternalJobPayload<Payload>>(job);

    return processJobWithContext({
      job,
      payload,
      contextMetadata,
      queueName: this.queueName,
      spanAttributes: this.spanAttributes,
      handler: this.process,
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

  private async collectMetrics(): Promise<void> {
    try {
      await collectBullMQMetrics(this.queue, this.queueName);
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

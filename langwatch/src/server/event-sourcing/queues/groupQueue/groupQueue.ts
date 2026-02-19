import {
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
import { createLogger } from "../../../../utils/logger/server";
import {
	type JobContextMetadata,
	getJobContextMetadata,
} from "../../../context/asyncContext";
import { connection } from "../../../redis";
import type {
	DeduplicationConfig,
	EventSourcedQueueDefinition,
	EventSourcedQueueProcessor,
} from "../../queues";
import {
	ConfigurationError,
	QueueError,
} from "../../services/errorHandling";

import { TraceFlags, context as otelContext, trace } from "@opentelemetry/api";
import {
	JOB_RETRY_CONFIG,
	collectBullMQMetrics,
	extractJobPayload,
	processJobWithContext,
} from "../shared";
import {
	gqActiveGroups,
	gqGroupsBlockedTotal,
	gqJobsCompletedTotal,
	gqJobsDedupedTotal,
	gqJobsDispatchedTotal,
	gqJobsStagedTotal,
	gqPendingGroups,
} from "./metrics";
import { GroupStagingScripts } from "./scripts";

/**
 * Configuration for the group queue.
 */
const GROUP_QUEUE_CONFIG = {
  /** Default global concurrency (max parallel groups) */
  defaultGlobalConcurrency: 20,
  /** TTL for the active key (safety net for crashes), in seconds */
  activeTtlSec: 300,
  /** BRPOP timeout in seconds (fallback polling interval) */
  signalTimeoutSec: 1,
  /** Interval for collecting queue metrics in milliseconds */
  metricsIntervalMs: 15000,
  /** Maximum time to wait for graceful shutdown in milliseconds */
  shutdownTimeoutMs:
    process.env.NODE_ENV === "development" || process.env.ENVIRONMENT === "local"
      ? 2000
      : 20000,
} as const;

/** Default TTL for deduplication in milliseconds */
const DEFAULT_DEDUPLICATION_TTL_MS = 200;

/**
 * Metadata attached to BullMQ jobs for group queue tracking.
 */
interface GroupJobMetadata {
  __groupId: string;
  __stagedJobId: string;
}

/**
 * Group Queue Processor that provides per-group FIFO with cross-group parallelism.
 *
 * Architecture:
 * - A Redis staging layer sits in front of BullMQ
 * - Jobs flow: send() → staging → dispatch → BullMQ queue → worker → completion callback → dispatch next
 * - Per-group sequential processing eliminates ordering errors and distributed lock contention
 * - Weighted round-robin (sqrt(pendingCount)) provides fair scheduling across groups
 */
export class GroupQueueProcessorBullMq<
  Payload extends Record<string, unknown>,
> implements EventSourcedQueueProcessor<Payload> {
  private readonly logger = createLogger(
    "langwatch:event-sourcing:group-queue",
  );
  private readonly queueName: string;
  private readonly jobName: string;
  private readonly process: (payload: Payload) => Promise<void>;
  private readonly spanAttributes?: (payload: Payload) => SemConvAttributes;
  private readonly queue: Queue<Payload, unknown, string>;
  private readonly worker: Worker<Payload>;
  private readonly queueEvents: QueueEvents;
  private readonly delay?: number;
  private readonly deduplication?: DeduplicationConfig<Payload>;
  private readonly groupKey: (payload: Payload) => string;
  private readonly score?: (payload: Payload) => number;
  private readonly redisConnection: IORedis | Cluster;
  private readonly blockingConnection: IORedis | Cluster;
  private readonly scripts: GroupStagingScripts;
  private readonly globalConcurrency: number;

  private shutdownRequested = false;
  private dispatcherRunning = false;
  private metricsInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    definition: EventSourcedQueueDefinition<Payload>,
    redisConnection?: IORedis | Cluster,
  ) {
    const {
      name,
      process,
      options,
      delay,
      spanAttributes,
      deduplication,
      groupKey,
      score,
    } = definition;

    const effectiveConnection = redisConnection ?? connection;
    if (!effectiveConnection) {
      throw new ConfigurationError(
        "GroupQueueProcessorBullMq",
        "Group queue processor requires Redis connection.",
      );
    }

    if (!groupKey) {
      throw new ConfigurationError(
        "GroupQueueProcessorBullMq",
        "Group queue processor requires a groupKey function in the queue definition.",
      );
    }

    this.redisConnection = effectiveConnection;
    // Dedicated connection for BRPOP to avoid blocking the shared connection
    this.blockingConnection =
      "duplicate" in effectiveConnection &&
      typeof effectiveConnection.duplicate === "function"
        ? effectiveConnection.duplicate()
        : effectiveConnection;
    this.spanAttributes = spanAttributes;
    this.delay = delay;
    this.deduplication = deduplication;
    this.groupKey = groupKey;
    this.score = score;
    this.queueName = name;
    this.jobName = "queue";
    this.process = process;
    this.globalConcurrency =
      options?.globalConcurrency ?? GROUP_QUEUE_CONFIG.defaultGlobalConcurrency;

    // Initialize Lua scripts wrapper
    this.scripts = new GroupStagingScripts(
      this.redisConnection,
      this.queueName,
    );

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
    this.queue = new Queue<Payload, unknown, string>(
      this.queueName,
      queueOptions,
    );

    // BullMQ Worker - concurrency matches global group concurrency
    const workerOptions: WorkerOptions = {
      connection: this.redisConnection,
      concurrency: this.globalConcurrency,
      telemetry: new BullMQOtel(this.queueName),
    };
    this.worker = new Worker<Payload>(
      this.queueName,
      async (job, token) => this.processJob(job, token),
      workerOptions,
    );

    this.worker.on("ready", () => {
      this.logger.info(
        { queueName: this.queueName },
        "Group queue worker ready",
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
        "Group queue job failed",
      );

      // On exhausted retries, block the group
      if (job && job.attemptsMade >= JOB_RETRY_CONFIG.maxAttempts) {
        const metadata = this.extractGroupMetadata(job);
        if (metadata) {
          void this.handleExhaustedRetries(metadata);
        }
      }
    });

    // Listen for completed jobs to trigger group completion
    this.worker.on("completed", (job) => {
      const metadata = this.extractGroupMetadata(job);
      if (metadata) {
        void this.handleJobCompleted(metadata);
      }
    });

    // BullMQ QueueEvents for deduplication logging
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
          "BullMQ job deduplicated",
        );
      },
    );

    // Start dispatcher loop and metrics collection
    this.startDispatcher();
    this.startMetricsCollection();
  }

  /**
   * Stages a job into the group queue's Redis staging layer.
   */
  async send(payload: Payload): Promise<void> {
    if (this.shutdownRequested) {
      throw new QueueError(
        this.queueName,
        "send",
        "Cannot send to queue after shutdown has been requested",
      );
    }

    const groupId = this.groupKey(payload);
    const stagedJobId = this.generateStagedJobId(payload);
    const score = this.score?.(payload) ?? Date.now();
    const dispatchAfterMs = score + (this.delay ?? 0);

    // Get dedup config
    let dedupId = "";
    let dedupTtlMs = 0;
    if (this.deduplication) {
      dedupId = this.deduplication.makeId(payload).replaceAll(":", ".");
      dedupTtlMs = this.deduplication.ttlMs ?? DEFAULT_DEDUPLICATION_TTL_MS;
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

    const isNew = await this.scripts.stage({
      stagedJobId,
      groupId,
      dispatchAfterMs,
      dedupId,
      dedupTtlMs,
      jobDataJson: JSON.stringify(payloadWithContext),
    });

    if (isNew) {
      gqJobsStagedTotal.inc({ queue_name: this.queueName });
    } else {
      gqJobsDedupedTotal.inc({ queue_name: this.queueName });
    }

    this.logger.debug(
      {
        queueName: this.queueName,
        groupId,
        stagedJobId,
        deduplicated: !isNew,
      },
      isNew ? "Job staged" : "Job deduplicated (replaced existing)",
    );
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
    const now = Date.now();

    const jobsToStage = payloads.map((payload, index) => {
      const groupId = this.groupKey(payload);
      const stagedJobId = this.generateStagedJobId(payload);
      const score = this.score?.(payload) ?? now;
      // Add index to ensure FIFO order within the batch even if timestamps are identical
      const dispatchAfterMs = score + (this.delay ?? 0) + index;

      let dedupId = "";
      let dedupTtlMs = 0;
      if (this.deduplication) {
        dedupId = this.deduplication.makeId(payload).replaceAll(":", ".");
        dedupTtlMs = this.deduplication.ttlMs ?? DEFAULT_DEDUPLICATION_TTL_MS;
      }

      const payloadWithContext = {
        ...(payload as Record<string, unknown>),
        __context: contextMetadata,
      };

      return {
        stagedJobId,
        groupId,
        dispatchAfterMs,
        dedupId,
        dedupTtlMs,
        jobDataJson: JSON.stringify(payloadWithContext),
      };
    });

    const newStagedCount = await this.scripts.stageBatch(jobsToStage);

    const dedupedCount = payloads.length - newStagedCount;
    if (newStagedCount > 0) {
      gqJobsStagedTotal.inc({ queue_name: this.queueName }, newStagedCount);
    }
    if (dedupedCount > 0) {
      gqJobsDedupedTotal.inc({ queue_name: this.queueName }, dedupedCount);
    }

    this.logger.debug(
      {
        queueName: this.queueName,
        count: payloads.length,
        newStagedCount,
        dedupedCount,
      },
      "Batch of jobs staged",
    );
  }

  /**
   * Dispatcher loop: waits for signals and dispatches jobs from staging to BullMQ.
   */
  private startDispatcher(): void {
    this.dispatcherRunning = true;

    const run = async () => {
      while (!this.shutdownRequested) {
        try {
          // Wait for signal (BRPOP with timeout)
          await this.waitForSignal();

          // Dispatch as many jobs as possible
          let dispatched = true;
          while (dispatched && !this.shutdownRequested) {
            dispatched = await this.dispatchOneJob();
          }
        } catch (error) {
          if (this.shutdownRequested) break;

          const errorMessage = error instanceof Error ? error.message : String(error);

          // Treat closed connections as an implicit shutdown signal
          if (errorMessage.includes("Connection is closed")) {
            this.logger.info(
              { queueName: this.queueName },
              "Redis connection closed, stopping dispatcher",
            );
            this.shutdownRequested = true;
            break;
          }

          this.logger.error(
            {
              queueName: this.queueName,
              error: errorMessage,
            },
            "Dispatcher loop error",
          );

          // Brief pause to avoid tight error loop
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      this.dispatcherRunning = false;
      this.logger.debug(
        { queueName: this.queueName },
        "Dispatcher loop stopped",
      );
    };

    void run();
  }

  /**
   * Wait for a signal on the signal list (BRPOP with timeout).
   */
  private async waitForSignal(): Promise<void> {
    const signalKey = this.scripts.getSignalKey();
    // BRPOP blocks until a signal arrives or timeout elapses.
    // Uses a dedicated connection to avoid blocking the shared connection.
    await this.blockingConnection.brpop(
      signalKey,
      GROUP_QUEUE_CONFIG.signalTimeoutSec,
    );
  }

  /**
   * Dispatch one job from staging to BullMQ.
   * @returns true if a job was dispatched, false if nothing to dispatch
   */
  private async dispatchOneJob(): Promise<boolean> {
    const result = await this.scripts.dispatch({
      nowMs: Date.now(),
      activeTtlSec: GROUP_QUEUE_CONFIG.activeTtlSec,
    });

    if (!result) {
      return false;
    }

    const { stagedJobId, groupId, jobDataJson } = result;

    // Parse the stored job data
    let jobData: Record<string, unknown>;
    try {
      jobData = JSON.parse(jobDataJson) as Record<string, unknown>;
    } catch {
      this.logger.error(
        { queueName: this.queueName, stagedJobId, groupId },
        "Failed to parse staged job data",
      );
      // Complete the group slot so it's not stuck
      await this.scripts.complete({ groupId, stagedJobId });
      return true;
    }

    // Attach group metadata to the job data
    const jobDataWithMetadata = {
      ...jobData,
      __groupId: groupId,
      __stagedJobId: stagedJobId,
    };

    // Generate a BullMQ-safe job ID
    const bullmqJobId = `${this.queueName}.${stagedJobId}`.replaceAll(":", ".");

    const opts: JobsOptions = {
      jobId: bullmqJobId,
      telemetry: { omitContext: true },
    };

    // Restore the original request's OTEL trace context so BullMQOtel propagates
    // the correct parent span into the worker, linking it back to the originating request.
    const contextMetadata = jobData.__context as JobContextMetadata | undefined;
    const addJob = () =>
      this.queue.add(
        // @ts-expect-error - BullMQ expects string literal union but jobName is dynamic
        this.jobName,
        jobDataWithMetadata as unknown as Payload,
        opts,
      );

    if (contextMetadata?.traceId && contextMetadata?.parentSpanId) {
      const parentContext = trace.setSpanContext(otelContext.active(), {
        traceId: contextMetadata.traceId,
        spanId: contextMetadata.parentSpanId,
        traceFlags: TraceFlags.SAMPLED,
        isRemote: true,
      });
      await otelContext.with(parentContext, addJob);
    } else {
      await addJob();
    }

    gqJobsDispatchedTotal.inc({ queue_name: this.queueName });

    this.logger.debug(
      {
        queueName: this.queueName,
        groupId,
        stagedJobId,
        bullmqJobId,
      },
      "Dispatched job from staging to BullMQ",
    );

    return true;
  }

  private async processJob(job: Job<Payload>, _token?: string): Promise<void> {
    const { payload, contextMetadata } = extractJobPayload<Payload>(job, [
      "__groupId",
      "__stagedJobId",
    ]);

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
   * Handle successful job completion: clear the group's active flag.
   */
  private async handleJobCompleted(metadata: GroupJobMetadata): Promise<void> {
    const completed = await this.scripts.complete({
      groupId: metadata.__groupId,
      stagedJobId: metadata.__stagedJobId,
    });

    if (completed) {
      gqJobsCompletedTotal.inc({ queue_name: this.queueName });
      this.logger.debug(
        {
          queueName: this.queueName,
          groupId: metadata.__groupId,
          stagedJobId: metadata.__stagedJobId,
        },
        "Group job completed, slot freed",
      );
    } else {
      this.logger.warn(
        {
          queueName: this.queueName,
          groupId: metadata.__groupId,
          stagedJobId: metadata.__stagedJobId,
        },
        "Stale completion (active key doesn't match)",
      );
    }
  }

  /**
   * Handle exhausted retries: block the group.
   */
  private async handleExhaustedRetries(
    metadata: GroupJobMetadata,
  ): Promise<void> {
    const blocked = await this.scripts.fail({
      groupId: metadata.__groupId,
      stagedJobId: metadata.__stagedJobId,
    });

    if (blocked) {
      gqGroupsBlockedTotal.inc({ queue_name: this.queueName });
      this.logger.error(
        {
          queueName: this.queueName,
          groupId: metadata.__groupId,
          stagedJobId: metadata.__stagedJobId,
        },
        "Group blocked after exhausted retries",
      );
    }
  }

  /**
   * Extract group metadata from a BullMQ job.
   */
  private extractGroupMetadata(job: Job<Payload>): GroupJobMetadata | null {
    const data = job.data as Record<string, unknown>;
    const groupId = data.__groupId;
    const stagedJobId = data.__stagedJobId;

    if (typeof groupId === "string" && typeof stagedJobId === "string") {
      return { __groupId: groupId, __stagedJobId: stagedJobId };
    }
    return null;
  }

  /**
   * Generates a unique staged job ID.
   */
  private generateStagedJobId(payload: Payload): string {
    const payloadWithId = payload as { id?: string };
    const payloadId = payloadWithId.id ?? crypto.randomUUID();
    return payloadId;
  }

  /**
   * Starts periodic metrics collection.
   */
  private startMetricsCollection(): void {
    void this.collectMetrics();
    this.metricsInterval = setInterval(() => {
      void this.collectMetrics();
    }, GROUP_QUEUE_CONFIG.metricsIntervalMs);
  }

  private async collectMetrics(): Promise<void> {
    try {
      // BullMQ queue metrics
      await collectBullMQMetrics(this.queue, this.queueName);

      // Group queue staging metrics
      const keyPrefix = this.scripts.getKeyPrefix();
      const readyKey = `${keyPrefix}ready`;
      const blockedKey = `${keyPrefix}blocked`;

      const counts = await this.queue.getJobCounts();
      const [pendingGroupCount] = await Promise.all([
        this.redisConnection.zcard(readyKey),
        this.redisConnection.scard(blockedKey),
      ]);

      gqPendingGroups.set({ queue_name: this.queueName }, pendingGroupCount);
      gqActiveGroups.set({ queue_name: this.queueName }, counts.active ?? 0);
    } catch (error) {
      this.logger.debug(
        {
          queueName: this.queueName,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to collect group queue metrics",
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
      "Closing group queue processor",
    );

    const closeWithTimeout = async (): Promise<void> => {
      // Wait for dispatcher to stop
      while (this.dispatcherRunning) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

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

      if (this.queueEvents) {
        await this.queueEvents.close();
        this.logger.debug({ queueName: this.queueName }, "Queue events closed");
      }

      // Close the dedicated blocking connection if it was duplicated
      if (this.blockingConnection !== this.redisConnection) {
        await this.blockingConnection.quit();
        this.logger.debug(
          { queueName: this.queueName },
          "Blocking connection closed",
        );
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
                  `Shutdown timed out after ${GROUP_QUEUE_CONFIG.shutdownTimeoutMs}ms`,
                ),
              ),
            GROUP_QUEUE_CONFIG.shutdownTimeoutMs,
          );
        }),
      ]);
      clearTimeout(shutdownTimer);

      this.logger.info(
        { queueName: this.queueName },
        "Group queue processor closed successfully",
      );
    } catch (error) {
      this.logger.error(
        {
          queueName: this.queueName,
          error: error instanceof Error ? error.message : String(error),
        },
        "Error closing group queue processor",
      );
      throw error;
    }
  }
}

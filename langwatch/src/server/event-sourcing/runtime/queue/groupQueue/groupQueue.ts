import {
  type Job,
  type JobsOptions,
  Queue,
  QueueEvents,
  type QueueOptions,
  Worker,
  type WorkerOptions,
} from "bullmq";
import { createQueueTelemetry, createWorkerTelemetry } from "~/server/background/bullmqTelemetry";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { SemConvAttributes } from "langwatch/observability";
import { createLogger } from "../../../../../utils/logger/server";
import { connection } from "../../../../redis";
import {
  type JobContextMetadata,
  createContextFromJobData,
  getJobContextMetadata,
  runWithContext,
} from "../../../../context/asyncContext";
import {
  type BullMQQueueState,
  recordJobWaitDuration,
  setBullMQJobCount,
} from "../../../../metrics";
import type {
  DeduplicationConfig,
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "../../../library/queues";
import {
  ConfigurationError,
  QueueError,
} from "../../../library/services/errorHandling";

import { GroupStagingScripts } from "./scripts";
import {
  gqActiveGroups,
  gqGroupsBlockedTotal,
  gqJobsCompletedTotal,
  gqJobsDedupedTotal,
  gqJobsDispatchedTotal,
  gqJobsStagedTotal,
  gqPendingGroups,
} from "./metrics";
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
  shutdownTimeoutMs: 20000,
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
 * Legacy container type where payload was wrapped in __payload.
 * Only used for reading jobs that were enqueued before the format change.
 */
type LegacyJobContainer<Payload> = {
  __payload: Payload;
  __context?: JobContextMetadata;
};

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
  Payload,
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

    // BullMQ Worker - concurrency matches global group concurrency
    const workerOptions: WorkerOptions = {
      connection: this.redisConnection,
      concurrency: this.globalConcurrency,
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
    const dispatchAfterMs = Date.now() + (this.delay ?? 0);

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

          this.logger.error(
            {
              queueName: this.queueName,
              error: error instanceof Error ? error.message : String(error),
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
    };

    await this.queue.add(
      // @ts-expect-error - jobName is a string, this is stupid typing from BullMQ
      this.jobName,
      jobDataWithMetadata as unknown as Payload,
      opts,
    );

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

  /**
   * Processes a single job from BullMQ.
   * Simplified vs old bullmq.ts: no ordering/lock error handling needed.
   * Keeps CH replication lag handling.
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
      const { __context, __groupId, __stagedJobId, ...rest } = rawData;
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
        "Processing group queue job",
      );

      try {
        await this.process(payload);
        this.logger.debug(
          {
            queueName: this.queueName,
            jobId: job.id,
          },
          "Group queue job processed successfully",
        );
      } catch (error) {
        // Let BullMQ's retry mechanism handle errors
        throw error;
      }
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

  /**
   * Collects and reports queue metrics.
   */
  private async collectMetrics(): Promise<void> {
    try {
      // BullMQ queue metrics
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

      // Group queue staging metrics
      const keyPrefix = this.scripts.getKeyPrefix();
      const readyKey = `${keyPrefix}ready`;
      const blockedKey = `${keyPrefix}blocked`;

      const [pendingGroupCount, blockedGroupCount] = await Promise.all([
        this.redisConnection.zcard(readyKey),
        this.redisConnection.scard(blockedKey),
      ]);

      gqPendingGroups.set({ queue_name: this.queueName }, pendingGroupCount);
      // Active groups = BullMQ active jobs
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

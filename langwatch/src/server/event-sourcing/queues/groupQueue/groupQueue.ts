import { performance } from "node:perf_hooks";
import {
  context as otelContext,
  SpanKind,
  TraceFlags,
  trace,
} from "@opentelemetry/api";
import fastq from "fastq";
import { Cluster, Redis as IORedis } from "ioredis";
import { getLangWatchTracer } from "langwatch";
import type { SemConvAttributes } from "langwatch/observability";
import { createLogger } from "../../../../utils/logger/server";
import {
  createContextFromJobData,
  getJobContextMetadata,
  type JobContextMetadata,
  runWithContext,
} from "../../../context/asyncContext";
import { featureFlagService } from "../../../featureFlag";
import {
  TenantRateTracker,
  tenantIdFromGroupId,
} from "../../../observability/tenantRateTracker";
import { connection } from "../../../redis";
import type { ProjectStorageDestination } from "../../../stored-objects/project-storage-destination";
import type {
  DeduplicationConfig,
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
  QueueSendOptions,
} from "../../queues";
import {
  ConfigurationError,
  categorizeError,
  ErrorCategory,
  QueueError,
} from "../../services/errorHandling";
import { getBackoffMs, JOB_RETRY_CONFIG } from "../shared";
import { GroupQueueDispatcher } from "./dispatcher";
import { EnvelopeBlobLifecycle } from "./envelopeBlobLifecycle";
import {
  gqGroupsBlockedTotal,
  gqJobDelayMilliseconds,
  gqJobDurationMilliseconds,
  gqJobsCompletedTotal,
  gqJobsDedupedTotal,
  gqJobsDelayedTotal,
  gqJobsExhaustedTotal,
  gqJobsNonRetryableTotal,
  gqJobsRetriedTotal,
  gqJobsStagedTotal,
  gqRetryAttempt,
  gqRetryBackoffMilliseconds,
} from "./metrics";
import { GroupQueueMetricsCollector } from "./metricsCollector";
import {
  type DispatchResult,
  type DrainedJob,
  GroupStagingScripts,
} from "./scripts";
import { type ObjectStore, TransientBlobStoreError } from "./tieredBlobStore";

/**
 * Configuration for the group queue.
 */
const GROUP_QUEUE_CONFIG = {
  /** Default global concurrency (max parallel groups) */
  defaultGlobalConcurrency: Number(process.env.GLOBAL_QUEUE_CONCURRENCY) || 100,
  /** TTL for the active key (safety net for crashes), in seconds */
  activeTtlSec: 300,
  /** BRPOP timeout in seconds (fallback polling interval) */
  signalTimeoutSec: 5,
  /** Interval for collecting queue metrics in milliseconds */
  metricsIntervalMs: 15000,
  /** Maximum time to wait for graceful shutdown in milliseconds */
  shutdownTimeoutMs:
    process.env.NODE_ENV === "development" ||
    process.env.ENVIRONMENT === "local"
      ? 2000
      : 20000,
} as const;

/** Default TTL for deduplication in milliseconds */
const DEFAULT_DEDUPLICATION_TTL_MS = 200;

/**
 * The `__*` namespace is reserved for queue machinery. Routing fields
 * (`__pipelineName`, `__jobType`, `__jobName`) ARE caller-set — event-sourcing
 * pipelines pre-set them so dispatch + the ops dashboard can route — so those
 * pass through. Everything else `__*` is queue-internal (`__context`,
 * `__attempt`, `__groupId`, `__stagedJobId`, `__dispatchScore`), and any
 * user-provided `__custom` would silently collide on the GQ2 content hash and
 * clobber on decode (because the strip is allowlist-free; ADR-029). Reject at
 * the public send-boundary so the contract is loud rather than silent.
 */
const CALLER_RESERVED_KEYS = new Set([
  "__pipelineName",
  "__jobType",
  "__jobName",
]);

function assertNoReservedKeys(
  payload: Record<string, unknown>,
  queueName: string,
  method: "send" | "sendBatch",
): void {
  for (const key of Object.keys(payload)) {
    if (key.startsWith("__") && !CALLER_RESERVED_KEYS.has(key)) {
      throw new QueueError(
        queueName,
        method,
        `Payload key "${key}" is in the reserved __* namespace (queue machinery). User payloads must not start with "__" except __pipelineName / __jobType / __jobName.`,
      );
    }
  }
}

/** Internal fields attached to job data that must be stripped before processing. */
const INTERNAL_FIELDS = [
  "__context",
  "__groupId",
  "__stagedJobId",
  "__dispatchScore",
  "__attempt",
] as const;

/**
 * Group Queue Processor that provides per-group FIFO with cross-group parallelism.
 *
 * Architecture:
 * - A Redis staging layer coordinates job storage, per-group FIFO, weighted round-robin,
 *   dedup, group blocking, heartbeats, and crash recovery via Lua scripts
 * - Jobs flow: send() → staging → dispatch → fastq → processWithRetries → completion callback → dispatch next
 * - Per-group sequential processing eliminates ordering errors and distributed lock contention
 * - Weighted round-robin (sqrt(pendingCount)) provides fair scheduling across groups
 * - fastq provides concurrency-limited async task execution with backpressure
 */
export class GroupQueueProcessor<Payload extends Record<string, unknown>>
  implements EventSourcedQueueProcessor<Payload>
{
  private readonly logger = createLogger(
    "langwatch:event-sourcing:group-queue",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.queue",
  );
  private readonly queueName: string;
  private readonly jobName: string;
  private readonly process: (payload: Payload) => Promise<void>;
  private readonly processBatch?: (payloads: Payload[]) => Promise<void>;
  private readonly coalesceMaxBatch?: (payload: Payload) => number | undefined;
  private readonly spanAttributes?: (payload: Payload) => SemConvAttributes;
  private readonly processingQueue: fastq.queueAsPromised<DispatchResult, void>;
  private readonly delay?: number;
  private readonly deduplication?: DeduplicationConfig<Payload>;
  private readonly groupKey: (payload: Payload) => string;
  private readonly score?: (payload: Payload) => number;
  private readonly redisConnection: IORedis | Cluster;
  private readonly blockingConnection: IORedis | Cluster;
  private readonly scripts: GroupStagingScripts;
  private readonly blobLifecycle: EnvelopeBlobLifecycle;
  private readonly rateTracker!: TenantRateTracker;
  private readonly globalConcurrency: number;
  private readonly consumerEnabled: boolean;
  private readonly dispatcher: GroupQueueDispatcher | null;
  private readonly metricsCollector: GroupQueueMetricsCollector | null;

  private shutdownRequested = false;
  /** Tracks in-flight jobs for active count metrics. */
  private activeJobCount = 0;

  constructor(
    definition: EventSourcedQueueDefinition<Payload>,
    redisConnection?: IORedis | Cluster,
    options?: {
      consumerEnabled?: boolean;
      objectStoreFor?: (projectId: string) => ObjectStore;
      resolveStorageDestination?: (
        projectId: string,
      ) => Promise<ProjectStorageDestination>;
    },
  ) {
    const {
      name,
      process,
      processBatch,
      coalesceMaxBatch,
      options: defOptions,
      delay,
      spanAttributes,
      deduplication,
      groupKey,
      score,
    } = definition;

    const effectiveConnection = redisConnection ?? connection;
    if (!effectiveConnection) {
      throw new ConfigurationError(
        "GroupQueueProcessor",
        "Group queue processor requires Redis connection.",
      );
    }

    if (!groupKey) {
      throw new ConfigurationError(
        "GroupQueueProcessor",
        "Group queue processor requires a groupKey function in the queue definition.",
      );
    }

    this.redisConnection = effectiveConnection;
    this.consumerEnabled = options?.consumerEnabled ?? true;
    // Dedicated connection for BRPOP to avoid blocking the shared connection.
    // Only needed when the dispatcher loop runs (consumer mode).
    // IORedis.duplicate() takes an options override; Cluster.duplicate() takes no
    // args (maxRetriesPerRequest: null is already set inside Cluster's redisOptions).
    this.blockingConnection = !this.consumerEnabled
      ? effectiveConnection
      : effectiveConnection instanceof IORedis
        ? effectiveConnection.duplicate({ maxRetriesPerRequest: null })
        : effectiveConnection instanceof Cluster
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
    this.processBatch = processBatch;
    this.coalesceMaxBatch = coalesceMaxBatch;
    this.globalConcurrency =
      defOptions?.globalConcurrency ??
      GROUP_QUEUE_CONFIG.defaultGlobalConcurrency;

    // Initialize Lua scripts wrapper
    this.scripts = new GroupStagingScripts(
      this.redisConnection,
      this.queueName,
    );

    // The GQ2 content-addressed blob lifecycle — tiered store, holder-set
    // refcount, and the encode/decode/acquire/release seams (ADR-029/030).
    this.blobLifecycle = new EnvelopeBlobLifecycle({
      redis: this.redisConnection,
      queueName: this.queueName,
      objectStoreFor: options?.objectStoreFor,
      resolveStorageDestination: options?.resolveStorageDestination,
    });

    // Advertise this queue in the registry set so the ops dashboard enumerates
    // it via SMEMBERS instead of an O(keyspace) `SCAN MATCH *:gq:ready`.
    // Best-effort: a miss only degrades discovery to the scan fallback.
    void this.scripts.registerQueue().catch((err) => {
      this.logger.debug(
        { err, queueName: this.queueName },
        "queue registry registration failed",
      );
    });

    // Per-tenant rate tracker (post-2026-05-11 incident follow-up). Cheap
    // pipelined writes on the producer hot path. AnomalyDetector worker
    // consumes the data; the tracker itself never blocks send(). The
    // PostHog feature-flag service is wired in so a runaway tracker can
    // be killed in seconds without a redeploy (see
    // ANOMALY_DETECTION_KILL_SWITCH_FLAG).
    this.rateTracker = new TenantRateTracker(
      this.redisConnection,
      Date.now,
      featureFlagService,
    );

    // fastq promise-based queue — replaces BullMQ Queue + Worker
    this.processingQueue = fastq.promise(
      this.processWithRetries.bind(this),
      this.globalConcurrency,
    );
    this.processingQueue.saturated = () => {
      this.logger.debug(
        { queueName: this.queueName },
        "Processing queue saturated",
      );
    };

    // Start dispatcher and metrics collection in consumer mode
    if (this.consumerEnabled) {
      this.dispatcher = new GroupQueueDispatcher({
        scripts: this.scripts,
        processingQueue: this.processingQueue,
        blockingConnection: this.blockingConnection,
        queueName: this.queueName,
        globalConcurrency: this.globalConcurrency,
        activeTtlSec: GROUP_QUEUE_CONFIG.activeTtlSec,
        signalTimeoutSec: GROUP_QUEUE_CONFIG.signalTimeoutSec,
        logger: this.logger,
      });
      this.dispatcher.start();

      this.metricsCollector = new GroupQueueMetricsCollector({
        scripts: this.scripts,
        processingQueue: this.processingQueue,
        redisConnection: this.redisConnection,
        queueName: this.queueName,
        activeJobCountFn: () => this.activeJobCount,
        metricsIntervalMs: GROUP_QUEUE_CONFIG.metricsIntervalMs,
        logger: this.logger,
      });
      this.metricsCollector.start();
    } else {
      this.dispatcher = null;
      this.metricsCollector = null;
    }
  }

  /**
   * Stages a job into the group queue's Redis staging layer.
   */
  async send(
    payload: Payload,
    options?: QueueSendOptions<Payload>,
  ): Promise<void> {
    if (this.shutdownRequested) {
      throw new QueueError(
        this.queueName,
        "send",
        "Cannot send to queue after shutdown has been requested",
      );
    }
    assertNoReservedKeys(
      payload as Record<string, unknown>,
      this.queueName,
      "send",
    );

    const delay = options?.delay ?? this.delay;
    const dedup = options?.deduplication ?? this.deduplication;

    const groupId = this.groupKey(payload);
    const stagedJobId = this.generateStagedJobId(payload);
    const score = this.score?.(payload) ?? Date.now();
    const dispatchAfterMs = score + (delay ?? 0);

    // Get dedup config
    let dedupId = "";
    let dedupTtlMs = 0;
    let shouldExtend = true;
    let shouldReplace = true;
    if (dedup) {
      dedupId = dedup.makeId(payload).replaceAll(":", ".");
      dedupTtlMs = dedup.ttlMs ?? DEFAULT_DEDUPLICATION_TTL_MS;
      shouldExtend = dedup.extend !== false;
      shouldReplace = dedup.replace !== false;
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

    const jobDataJson = await this.blobLifecycle.encode({
      jobData: payloadWithContext,
      groupId,
    });

    const { isNew, orphanedValue } = await this.scripts.stage({
      stagedJobId,
      groupId,
      dispatchAfterMs,
      dedupId,
      dedupTtlMs,
      jobDataJson,
      shouldExtend,
      shouldReplace,
    });

    // Acquire this occupancy's hold BEFORE releasing any payload a dedup squash
    // displaced, so a squash re-staging identical content never drops the shared
    // blob to zero holders. Both are no-ops for inline/legacy values.
    if (orphanedValue) {
      // Atomic hold transfer: a dedup squash moves the hold from the displaced
      // value to the new one in one eval, so a partial failure can't reclaim a
      // live blob (ADR-030 §4).
      this.blobLifecycle.transfer({
        newValue: jobDataJson,
        oldValue: orphanedValue,
        groupId,
      });
    } else {
      this.blobLifecycle.acquire(jobDataJson);
    }

    if (isNew) {
      gqJobsStagedTotal.inc({ queue_name: this.queueName });
      if (delay && delay > 0) {
        gqJobsDelayedTotal.inc({ queue_name: this.queueName });
        gqJobDelayMilliseconds.observe({ queue_name: this.queueName }, delay);
      }
      // Per-tenant rate tracking (post-2026-05-11 follow-up). Non-blocking;
      // failures are swallowed inside the tracker so observability never
      // breaks production traffic.
      const tenantId = tenantIdFromGroupId(groupId);
      if (tenantId) {
        void this.rateTracker.record(tenantId);
      }
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

  async sendBatch(
    payloads: Payload[],
    options?: QueueSendOptions<Payload>,
  ): Promise<void> {
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
    for (const payload of payloads) {
      assertNoReservedKeys(
        payload as Record<string, unknown>,
        this.queueName,
        "sendBatch",
      );
    }

    const delay = options?.delay ?? this.delay;
    const dedup = options?.deduplication ?? this.deduplication;

    const contextMetadata = getJobContextMetadata();
    const now = Date.now();

    const shouldExtend = dedup ? dedup.extend !== false : true;
    const shouldReplace = dedup ? dedup.replace !== false : true;

    const jobsToStage = await Promise.all(
      payloads.map(async (payload, index) => {
        const groupId = this.groupKey(payload);
        const stagedJobId = this.generateStagedJobId(payload);
        const score = this.score?.(payload) ?? now;
        // Add index to ensure FIFO order within the batch even if timestamps are identical
        const dispatchAfterMs = score + (delay ?? 0) + index;

        let dedupId = "";
        let dedupTtlMs = 0;
        if (dedup) {
          dedupId = dedup.makeId(payload).replaceAll(":", ".");
          dedupTtlMs = dedup.ttlMs ?? DEFAULT_DEDUPLICATION_TTL_MS;
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
          jobDataJson: await this.blobLifecycle.encode({
            jobData: payloadWithContext,
            groupId,
          }),
          shouldExtend,
          shouldReplace,
        };
      }),
    );

    const { newStagedCount, orphanedValues } =
      await this.scripts.stageBatch(jobsToStage);

    // Atomically transfer the hold from any in-batch dedup-squashed value to the
    // job that displaced it (orphanedValues is index-aligned with jobsToStage);
    // otherwise just acquire. Matches send()'s atomic path, so a partial failure
    // can't reclaim a live blob the way a separate acquire+release pair can
    // (ADR-030 §4).
    jobsToStage.forEach((job, i) => {
      const orphan = orphanedValues[i];
      if (orphan && orphan.length > 0) {
        this.blobLifecycle.transfer({
          newValue: job.jobDataJson,
          oldValue: orphan,
          groupId: job.groupId,
        });
      } else {
        this.blobLifecycle.acquire(job.jobDataJson);
      }
    });

    const dedupedCount = payloads.length - newStagedCount;
    if (newStagedCount > 0) {
      gqJobsStagedTotal.inc({ queue_name: this.queueName }, newStagedCount);
      const effectiveDelay = options?.delay ?? this.delay;
      if (effectiveDelay && effectiveDelay > 0) {
        gqJobsDelayedTotal.inc({ queue_name: this.queueName }, newStagedCount);
        for (let i = 0; i < newStagedCount; i++) {
          gqJobDelayMilliseconds.observe(
            { queue_name: this.queueName },
            effectiveDelay,
          );
        }
      }
      // Per-tenant rate tracking. The Lua script may have deduped some
      // payloads, so we conservatively credit each unique tenant prefix
      // 1 per source-payload — slight over-count when dedup hits, but the
      // anomaly thresholds (10×/100× baseline) are unaffected.
      const perTenant = new Map<string, number>();
      for (const job of jobsToStage) {
        const tenantId = tenantIdFromGroupId(job.groupId);
        if (tenantId) {
          perTenant.set(tenantId, (perTenant.get(tenantId) ?? 0) + 1);
        }
      }
      for (const [tenantId, count] of perTenant) {
        void this.rateTracker.record(tenantId, count);
      }
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
   * fastq worker function: processes a dispatched job with retries, OTEL tracing,
   * heartbeats, and error handling.
   */
  private async processWithRetries(dispatched: DispatchResult): Promise<void> {
    const { stagedJobId, groupId, jobDataJson, originalScore } = dispatched;

    // Parse the stored job data
    let jobData: Record<string, unknown>;
    try {
      jobData = await this.blobLifecycle.decode({
        value: jobDataJson,
        groupId,
      });
    } catch (err) {
      if (err instanceof TransientBlobStoreError) {
        // The body is temporarily unreachable, not gone — retry, don't drop.
        await this.handleTransientDecode({
          groupId,
          stagedJobId,
          jobDataJson,
          err,
        });
        return;
      }
      this.logger.error(
        {
          queueName: this.queueName,
          projectId: tenantIdFromGroupId(groupId),
          stagedJobId,
          groupId,
        },
        "Failed to parse staged job data",
      );
      // Missing blob or unparseable value: complete the slot so it's not stuck;
      // recover via event replay.
      await this.scripts.complete({ groupId, stagedJobId });
      this.blobLifecycle.release({ values: [jobDataJson], groupId });
      return;
    }

    const contextMetadata = jobData.__context as JobContextMetadata | undefined;
    const attempt =
      typeof jobData.__attempt === "number" ? jobData.__attempt : 1;
    const pipelineName = (jobData.__pipelineName as string) ?? "unknown";
    const jobType = (jobData.__jobType as string) ?? "unknown";
    const jobName = (jobData.__jobName as string) ?? "unknown";
    const routingLabels = {
      queue_name: this.queueName,
      pipeline_name: pipelineName,
      job_type: jobType,
      job_name: jobName,
    };
    const payload = this.stripInternalFields(jobData);

    // Opt-in batch coalescing: if this job type supports it, drain additional
    // already-staged DUE jobs from the same group and fold them alongside the
    // dispatched one in a single handler call. The group's active key (held by
    // this job) guarantees no other worker dequeues from the group meanwhile,
    // so the drain is exclusive. Drained siblings are re-staged on failure so
    // they are not lost. When disabled (maxBatch <= 1) this is a no-op and the
    // per-job path below is unchanged.
    const maxBatch = this.coalesceMaxBatch?.(payload) ?? 1;
    let batchPayloads: Payload[] | null = null;
    let drainedSiblings: DrainedJob[] = [];
    if (maxBatch > 1 && this.processBatch) {
      try {
        drainedSiblings = await this.scripts.drainGroupReady({
          groupId,
          nowMs: Date.now(),
          maxJobs: maxBatch - 1,
        });
      } catch (err) {
        this.logger.warn(
          {
            queueName: this.queueName,
            groupId,
            error: err instanceof Error ? err.message : String(err),
          },
          "Failed to drain group siblings for coalescing — processing single job",
        );
        drainedSiblings = [];
      }
      if (drainedSiblings.length > 0) {
        const parsedSiblings = await Promise.all(
          drainedSiblings.map((sibling) =>
            this.parseDrainedPayload({ sibling, groupId }),
          ),
        );
        const siblingPayloads = parsedSiblings.filter(
          (parsed) => parsed !== null,
        ) as Payload[];
        if (siblingPayloads.length > 0) {
          batchPayloads = [payload, ...siblingPayloads];
        }
      }
    }

    const jobStartTime = performance.now();
    const heartbeat = this.startActiveKeyHeartbeat({ groupId, stagedJobId });
    this.activeJobCount++;

    try {
      // Restore OTEL trace context and wrap in a span
      const spanName = `${this.queueName}/${this.jobName}`;
      const spanAttributes: Record<string, string | number | boolean> = {
        "queue.name": this.queueName,
        "queue.job_name": this.jobName,
        "queue.group_id": groupId,
        "queue.staged_job_id": stagedJobId,
        "queue.attempt": attempt,
      };

      // Add custom span attributes from the definition
      if (this.spanAttributes) {
        try {
          const custom = this.spanAttributes(payload);
          for (const [key, value] of Object.entries(custom)) {
            if (
              value !== undefined &&
              (typeof value === "string" ||
                typeof value === "number" ||
                typeof value === "boolean")
            ) {
              spanAttributes[key] = value;
            }
          }
        } catch {
          // If spanAttributes throws, continue with base attributes
        }
      }

      const executeWithSpan = async () => {
        await this.tracer.withActiveSpan(
          spanName,
          {
            kind: SpanKind.CONSUMER,
            attributes: spanAttributes,
          },
          async (span) => {
            // Link to original request span
            if (contextMetadata?.traceId && contextMetadata?.parentSpanId) {
              span.addLink({
                context: {
                  traceId: contextMetadata.traceId,
                  spanId: contextMetadata.parentSpanId,
                  traceFlags: TraceFlags.SAMPLED,
                },
              });
            }

            // Add business context attributes
            if (contextMetadata?.organizationId) {
              span.setAttribute(
                "organization.id",
                contextMetadata.organizationId,
              );
            }
            if (contextMetadata?.projectId) {
              span.setAttribute("tenant.id", contextMetadata.projectId);
            }
            if (contextMetadata?.userId) {
              span.setAttribute("user.id", contextMetadata.userId);
            }

            try {
              // Run the actual handler with request context propagation
              const requestContext = createContextFromJobData(contextMetadata);
              await runWithContext(requestContext, async () => {
                if (batchPayloads && this.processBatch) {
                  span.setAttribute(
                    "queue.coalesced_batch_size",
                    batchPayloads.length,
                  );
                  await this.processBatch(batchPayloads);
                } else {
                  await this.process(payload);
                }
              });

              // Success — complete the group slot. Drained siblings were
              // removed from staging during the drain, so completing the
              // dispatched job is enough to free the group.
              await this.scripts.complete({ groupId, stagedJobId, jobName });
              this.blobLifecycle.release({
                values: [
                  jobDataJson,
                  ...drainedSiblings.map((sibling) => sibling.jobDataJson),
                ],
                groupId,
              });
              gqJobsCompletedTotal.inc(routingLabels);

              this.logger.debug(
                {
                  queueName: this.queueName,
                  groupId,
                  stagedJobId,
                  attempt,
                },
                "Group job completed, slot freed",
              );
            } catch (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              const category = categorizeError(err);
              const isRetryable = category !== ErrorCategory.CRITICAL;

              // The batch stores its fold state only once, at the very end, so a
              // failure means nothing was persisted for the drained siblings.
              // Re-stage them so they are re-dispatched (and re-coalesced) on the
              // dispatched job's retry, rather than lost until an event replay.
              if (drainedSiblings.length > 0) {
                await this.restageDrainedSiblings(groupId, drainedSiblings);
              }

              if (isRetryable && attempt < JOB_RETRY_CONFIG.maxAttempts) {
                // Re-stage with backoff — frees the worker slot immediately
                gqJobsRetriedTotal.inc(routingLabels);

                const backoffMs = getBackoffMs(attempt);
                gqRetryAttempt.observe(routingLabels, attempt);
                gqRetryBackoffMilliseconds.observe(routingLabels, backoffMs);
                const newStagedJobId = `${stagedJobId}/r/${attempt}`;
                const retryJobData = await this.blobLifecycle.encode({
                  jobData: {
                    ...(payload as Record<string, unknown>),
                    __context: contextMetadata,
                    __attempt: attempt + 1,
                  },
                  groupId,
                });

                await this.scripts.retryRestage({
                  groupId,
                  stagedJobId,
                  newStagedJobId,
                  dispatchAfterMs: Date.now() + backoffMs,
                  jobDataJson: retryJobData,
                  backoffMs,
                });
                // Atomically transfer the hold from the dispatched value to the
                // re-staged one. For GQ2 the retry re-encodes to the SAME content
                // hash, so it's SADD+SREM on one holder set (the blob stays
                // referenced); for a mixed/GQ1 value it falls back to ordered
                // acquire+release. Drained siblings keep their ORIGINAL values.
                this.blobLifecycle.transfer({
                  newValue: retryJobData,
                  oldValue: jobDataJson,
                  groupId,
                });

                this.logger.warn(
                  {
                    queueName: this.queueName,
                    groupId,
                    stagedJobId,
                    attempt,
                    maxAttempts: JOB_RETRY_CONFIG.maxAttempts,
                    backoffMs,
                    error: error.message,
                  },
                  "Job attempt failed, re-staged with backoff",
                );
              } else {
                span.setAttribute("error", true);
                span.setAttribute("error.message", error.message);

                if (!isRetryable) {
                  gqJobsNonRetryableTotal.inc(routingLabels);
                  this.logger.error(
                    {
                      queueName: this.queueName,
                      groupId,
                      stagedJobId,
                      attempt,
                      errorCategory: category,
                      error: error.message,
                    },
                    "Job failed with non-retryable error, skipping retries",
                  );
                }

                await this.handleExhaustedRetries({
                  groupId,
                  stagedJobId,
                  payload,
                  originalScore,
                  lastError: error,
                  contextMetadata,
                  routingLabels,
                });
                this.blobLifecycle.release({ values: [jobDataJson], groupId });
              }
            }
          },
        );
      };

      // Restore parent OTEL context if available
      if (contextMetadata?.traceId && contextMetadata?.parentSpanId) {
        const parentContext = trace.setSpanContext(otelContext.active(), {
          traceId: contextMetadata.traceId,
          spanId: contextMetadata.parentSpanId,
          traceFlags: TraceFlags.SAMPLED,
          isRemote: true,
        });
        await otelContext.with(parentContext, executeWithSpan);
      } else {
        await executeWithSpan();
      }
    } finally {
      clearInterval(heartbeat);
      this.activeJobCount--;
      const jobDurationMs = performance.now() - jobStartTime;
      gqJobDurationMilliseconds.observe(routingLabels, jobDurationMs);
      // Feed the ops dashboard P50/P99 tiles. Capped circular buffer; the
      // collector LRANGE's it every 2s. Fire-and-forget so an instrumentation
      // hiccup never bubbles into the worker pipeline.
      this.redisConnection
        .multi()
        .lpush(
          `${this.queueName}:gq:stats:latencies-ms`,
          String(Math.round(jobDurationMs)),
        )
        .ltrim(`${this.queueName}:gq:stats:latencies-ms`, 0, 199)
        .exec()
        .catch(() => undefined);
    }
  }

  /**
   * Strips internal metadata fields from job data, returning the clean payload.
   */
  private stripInternalFields(jobData: Record<string, unknown>): Payload {
    const clean = { ...jobData };
    for (const field of INTERNAL_FIELDS) {
      delete clean[field];
    }
    return clean as Payload;
  }

  /**
   * Parses a drained sibling's stored JSON into a clean payload. Returns null
   * on parse failure (the job was already removed from staging; it is dropped
   * here and recoverable via event replay, mirroring the dispatched job's own
   * parse-failure handling).
   */
  private async parseDrainedPayload({
    sibling,
    groupId,
  }: {
    sibling: DrainedJob;
    groupId: string;
  }): Promise<Payload | null> {
    try {
      const jobData = await this.blobLifecycle.decode({
        value: sibling.jobDataJson,
        groupId,
      });
      return this.stripInternalFields(jobData);
    } catch {
      this.logger.error(
        {
          queueName: this.queueName,
          groupId,
          stagedJobId: sibling.stagedJobId,
        },
        "Failed to parse drained sibling job data — dropping (recoverable via replay)",
      );
      return null;
    }
  }

  /**
   * Re-stages siblings drained for a batch that ultimately failed, so they are
   * re-dispatched instead of lost. Each is staged with its original score and
   * raw job data (context metadata preserved). Best-effort: a re-stage failure
   * is logged, not thrown, so it never masks the original processing error.
   */
  private async restageDrainedSiblings(
    groupId: string,
    siblings: DrainedJob[],
  ): Promise<void> {
    for (const sibling of siblings) {
      try {
        await this.scripts.stage({
          stagedJobId: sibling.stagedJobId,
          groupId,
          dispatchAfterMs: sibling.originalScore,
          dedupId: "",
          dedupTtlMs: 0,
          jobDataJson: sibling.jobDataJson,
        });
        // Re-acquire the sibling's hold (idempotent: it kept its hold through
        // the drain, and its value — hence token — is unchanged).
        this.blobLifecycle.acquire(sibling.jobDataJson);
      } catch (err) {
        this.logger.error(
          {
            queueName: this.queueName,
            groupId,
            stagedJobId: sibling.stagedJobId,
            error: err instanceof Error ? err.message : String(err),
          },
          "Failed to re-stage drained sibling after batch failure (recoverable via replay)",
        );
      }
    }
  }

  /**
   * Starts a periodic heartbeat that refreshes the active key TTL during
   * processing. This prevents the safety-net TTL from expiring when a single
   * job attempt takes longer than activeTtlSec.
   */
  private startActiveKeyHeartbeat({
    groupId,
    stagedJobId,
  }: {
    groupId: string;
    stagedJobId: string;
  }): ReturnType<typeof setInterval> {
    const intervalMs = (GROUP_QUEUE_CONFIG.activeTtlSec * 1000) / 3;
    return setInterval(() => {
      this.scripts
        .refreshActiveKey({
          groupId,
          stagedJobId,
          activeTtlSec: GROUP_QUEUE_CONFIG.activeTtlSec,
        })
        .catch((err) => {
          this.logger.warn(
            {
              queueName: this.queueName,
              groupId,
              stagedJobId,
              error: err instanceof Error ? err.message : String(err),
            },
            "Failed to heartbeat active key during processing",
          );
        });
    }, intervalMs);
  }

  /**
   * Handle exhausted retries: block the group and re-stage the failed job's data
   * back into the staging layer so it isn't lost. Stores error info for Skynet visibility.
   */
  private async handleExhaustedRetries({
    groupId,
    stagedJobId,
    payload,
    originalScore,
    lastError,
    contextMetadata,
    routingLabels,
  }: {
    groupId: string;
    stagedJobId: string;
    payload: Payload;
    originalScore: number;
    lastError: Error | undefined;
    contextMetadata: JobContextMetadata | undefined;
    routingLabels: Record<string, string>;
  }): Promise<void> {
    const score =
      typeof originalScore === "number"
        ? originalScore
        : (this.score?.(payload) ?? Date.now());

    // Re-stage with a new ID
    const newStagedJobId = `${stagedJobId}/r/${Date.now()}`;
    const jobDataJson = await this.blobLifecycle.encode({
      jobData: {
        ...(payload as Record<string, unknown>),
        __context: contextMetadata,
      },
      groupId,
    });

    // Atomically: block the group, re-stage the job, update ready score, store error
    await this.scripts.restageAndBlock({
      groupId,
      newStagedJobId,
      score,
      jobDataJson,
      errorMessage: lastError?.message,
      errorStack: lastError?.stack,
    });

    // Acquire the re-staged value's hold; the caller releases the dispatched
    // one after this returns (acquire-before-release keeps a GQ2 blob alive).
    this.blobLifecycle.acquire(jobDataJson);

    gqGroupsBlockedTotal.inc(routingLabels);
    gqJobsExhaustedTotal.inc(routingLabels);

    this.logger.error(
      {
        queueName: this.queueName,
        groupId,
        stagedJobId,
        restagedAs: newStagedJobId,
        error: lastError?.message,
      },
      "Group blocked after exhausted retries, job re-staged",
    );
  }

  /**
   * A transient blob-store failure (network/5xx) means the body is temporarily
   * unreachable — not gone. Re-stage the SAME envelope with backoff so the job
   * retries instead of dropping to replay; the value is still valid and its hold
   * token is unchanged, so there is no re-encode and no holder churn (releasing
   * here would risk reclaiming the blob the re-stage still needs). Bounded by the
   * `/r/` retry suffixes already in the stagedJobId, so a misclassified permanent
   * failure still terminates at the fail-safe (ADR-030 §2).
   */
  private async handleTransientDecode({
    groupId,
    stagedJobId,
    jobDataJson,
    err,
  }: {
    groupId: string;
    stagedJobId: string;
    jobDataJson: string;
    err: TransientBlobStoreError;
  }): Promise<void> {
    const attempt = (stagedJobId.match(/\/r\//g)?.length ?? 0) + 1;
    if (attempt >= JOB_RETRY_CONFIG.maxAttempts) {
      this.logger.error(
        {
          queueName: this.queueName,
          projectId: tenantIdFromGroupId(groupId),
          groupId,
          stagedJobId,
          attempt,
          error: err.message,
        },
        "Blob store unreachable after retries; completing slot to recover via replay",
      );
      await this.scripts.complete({ groupId, stagedJobId });
      this.blobLifecycle.release({ values: [jobDataJson], groupId });
      return;
    }
    const backoffMs = getBackoffMs(attempt);
    await this.scripts.retryRestage({
      groupId,
      stagedJobId,
      newStagedJobId: `${stagedJobId}/r/${attempt}`,
      dispatchAfterMs: Date.now() + backoffMs,
      jobDataJson,
      backoffMs,
    });
    this.logger.warn(
      {
        queueName: this.queueName,
        projectId: tenantIdFromGroupId(groupId),
        groupId,
        stagedJobId,
        attempt,
        backoffMs,
        error: err.message,
      },
      "Blob temporarily unreachable, re-staged with backoff",
    );
  }

  /**
   * Generates a unique staged job ID.
   *
   * Incorporates routing metadata (__jobType/__jobName) when present so that
   * different job types processing the same event (e.g. fold and map projections)
   * get distinct staged job IDs and don't overwrite each other in the staging layer.
   */
  private generateStagedJobId(payload: Payload): string {
    const p = payload as Record<string, unknown>;
    const baseId = (p.id as string) ?? crypto.randomUUID();
    const jobType = p.__jobType as string | undefined;
    const jobName = p.__jobName as string | undefined;
    if (jobType && jobName) {
      return `${baseId}/${jobType}/${jobName}`;
    }
    return baseId;
  }

  /**
   * Adjust concurrency at runtime.
   */
  setConcurrency(n: number): void {
    this.processingQueue.concurrency = n;
  }

  async waitUntilReady(): Promise<void> {
    const bc = this.blockingConnection;
    // The shared connection's readiness is owned by whoever created it.
    if (bc === this.redisConnection) return;
    if (bc.status === "ready") return;
    // `end` is ioredis's terminal state — it fires only when no further
    // reconnection will be attempted. If we already missed the window, fail
    // fast rather than wait for an event that will never come.
    if (bc.status === "end") {
      throw new Error("Blocking Redis connection ended before ready");
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        bc.off("ready", onReady);
        bc.off("end", onEnd);
        bc.off("error", onError);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onEnd = () => {
        cleanup();
        reject(new Error("Blocking Redis connection ended before ready"));
      };
      // Transient reconnect events are EXPECTED while ioredis retries with
      // maxRetriesPerRequest: null — on an unavailable endpoint it emits
      // `error` → `close` → `reconnecting` and can later recover with `ready`.
      // Rejecting on `error`/`close` would turn a recoverable Redis blip into a
      // pipeline-startup failure (the regression this guards). So we do NOT
      // listen for `close` at all, and the `error` listener only absorbs the
      // error (keeping a listener attached so ioredis' emit is never unhandled)
      // and keeps waiting. Only the terminal `end` event fails readiness.
      const onError = (err: unknown) => {
        this.logger.debug(
          {
            queueName: this.queueName,
            error: err instanceof Error ? err.message : String(err),
          },
          "Blocking connection error while awaiting readiness; awaiting reconnect",
        );
      };
      bc.once("ready", onReady);
      bc.once("end", onEnd);
      bc.on("error", onError);
    });
  }

  async close(): Promise<void> {
    this.shutdownRequested = true;
    this.metricsCollector?.stop();
    this.dispatcher?.requestShutdown();
    // Wake the BRPOP so the dispatcher exits immediately
    await this.redisConnection
      .lpush(this.scripts.getSignalKey(), "1")
      .catch(() => undefined);
    this.logger.debug(
      { queueName: this.queueName },
      "Closing group queue processor",
    );

    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.drainAndDisconnect(),
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

      this.logger.debug(
        { queueName: this.queueName },
        "Group queue processor closed successfully",
      );
    } catch (error) {
      this.logger.error(
        {
          queueName: this.queueName,
          error: error instanceof Error ? error.message : String(error),
          queueIdle: this.processingQueue.idle(),
          dispatcherActive: this.dispatcher != null,
        },
        "Error closing group queue processor",
      );
      throw error;
    } finally {
      clearTimeout(shutdownTimer);
    }
  }

  private async drainAndDisconnect(): Promise<void> {
    if (this.dispatcher) {
      await this.dispatcher.waitUntilStopped();
    }

    if (!this.processingQueue.idle()) {
      await this.processingQueue.drained();
    }
    this.processingQueue.pause();

    if (this.blockingConnection !== this.redisConnection) {
      await this.blockingConnection.quit();
      this.logger.debug(
        { queueName: this.queueName },
        "Blocking connection closed",
      );
    }
  }
}

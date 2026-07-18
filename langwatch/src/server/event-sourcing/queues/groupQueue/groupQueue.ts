import { performance } from "node:perf_hooks";
import { createLogger } from "@langwatch/observability";
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
import {
  type ProjectStorageDestination,
  redactStorageUrisInText,
} from "../../../stored-objects/project-storage-destination";
import { isDispatchError } from "../../outbox/dispatchError";
import type {
  DeduplicationConfig,
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
  QueueAuditAdapter,
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
  DecodeFailureError,
  type DecodeFailureReason,
  decodeJobEnvelope,
  encodeJobEnvelope,
  PayloadTooLargeError,
  readEnvelopeDescriptor,
  readJobRoutingMeta,
} from "./jobEnvelope";
import {
  gqGroupsBlockedTotal,
  gqGroupsPoisonParkedTotal,
  gqJobDelayMilliseconds,
  gqJobDurationMilliseconds,
  gqJobsCompletedTotal,
  gqJobsDedupedTotal,
  gqJobsDelayedTotal,
  gqJobsDroppedTotal,
  gqJobsExhaustedTotal,
  gqJobsNonRetryableTotal,
  gqJobsRetriedTotal,
  gqJobsStagedTotal,
  gqRetryAttempt,
  gqRetryBackoffMilliseconds,
  gqRetryEncodeFailuresTotal,
} from "./metrics";
import { GroupQueueMetricsCollector } from "./metricsCollector";
import { RedisJobBlobStore } from "./redisJobBlobStore";
import {
  type DispatchResult,
  type DrainedJob,
  GroupStagingScripts,
  readClaimStrikeThreshold,
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
 * Decides whether a failed job attempt should be retried.
 *
 * Two non-retryable classes:
 * - event-sourcing errors categorized CRITICAL (validation/security/config)
 * - outbox `DispatchError`s explicitly marked `retryable: false` — the
 *   dispatcher rethrows these so the queue must dead-letter rather than
 *   re-fire a dispatch the dispatcher already judged unrecoverable.
 */
export function isRetryableJobError(err: unknown): boolean {
  if (isDispatchError(err) && !err.retryable) return false;
  return categorizeError(err) !== ErrorCategory.CRITICAL;
}

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
 * Why a staged job was discarded. Extends {@link DecodeFailureReason} (what went
 * wrong inside the decoder) with this module's own terminal reasons.
 *
 * `unknown` is a safety valve, not a shrug: an unclassified throw reaching a drop
 * site means a failure mode exists that this enum does not name. A non-zero
 * `reason="unknown"` on `gq_jobs_dropped_total` is a bug to chase, not noise.
 */
type DropReason =
  | DecodeFailureReason
  | "transient_exhausted"
  | "sibling_restage_failed"
  | "retry_encode_failed"
  | "unknown";

/**
 * Classify a caught decode failure by its TYPE.
 *
 * Deliberately not a message-text match: zlib's wording is Node-version-dependent
 * and not ours to own, so an alert built on substrings breaks under a runtime
 * upgrade.
 */
const dropReasonOf = (err: unknown): DecodeFailureReason | "unknown" =>
  err instanceof DecodeFailureError ? err.reason : "unknown";

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
export class GroupQueueProcessor<
  Payload extends Record<string, unknown>,
> implements EventSourcedQueueProcessor<Payload> {
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
  private readonly auditAdapter?: QueueAuditAdapter<Payload>;
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
      auditAdapter,
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
    this.auditAdapter = auditAdapter;
    this.globalConcurrency =
      defOptions?.globalConcurrency ??
      GROUP_QUEUE_CONFIG.defaultGlobalConcurrency;

    // Initialize Lua scripts wrapper
    this.scripts = new GroupStagingScripts(
      this.redisConnection,
      this.queueName,
    );

    // The GQ2 content-addressed blob lifecycle — tiered store, renewable
    // per-holder leases, and the encode/decode/take/release seams.
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
    let shouldSurviveDispatch = false;
    if (dedup) {
      dedupId = dedup.makeId(payload).replaceAll(":", ".");
      dedupTtlMs = dedup.ttlMs ?? DEFAULT_DEDUPLICATION_TTL_MS;
      shouldExtend = dedup.extend !== false;
      shouldReplace = dedup.replace !== false;
      shouldSurviveDispatch = dedup.shouldSurviveDispatch === true;
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
      shouldSurviveDispatch,
    });

    // Blob leases for a dedup squash move INSIDE the stage eval, atomic with
    // the displacement — a post-eval transfer can reorder against a concurrent
    // squash of the same dedup id and leave a phantom lifecycle entry. A genuine
    // new stage still takes its lease here. When the squash DISCARDED the new
    // value instead (replace off or a post-dispatch survive-dispatch squash), it
    // was never staged and gets no lease. A discarded GQ1 private blob was
    // already UNLINKed inside the eval; a GQ2 blob is left to lazy backstop reclaim.
    if (!orphanedValue) {
      await this.blobLifecycle.takeLease(jobDataJson);
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
      // Audit hook (ADR-030 revision): only on the new-stage path, not on
      // dedup-collapse. The adapter's audit row already exists for the
      // first send under this dedup ID.
      await this.runAudit(() =>
        this.auditAdapter?.onEnqueue({
          payload,
          groupKey: groupId,
          dedupKey: dedupId || undefined,
          scheduledAt: new Date(dispatchAfterMs),
          // Mirror the queue's actual retry budget into the audit
          // projection so `ReactorOutbox.maxAttempts` matches when the
          // queue will stop retrying (otherwise the column defaults to
          // 8 and an operator sees `attempts > maxAttempts` once the
          // queue retries 9+ times).
          maxAttempts: JOB_RETRY_CONFIG.maxAttempts,
        }),
      );
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
    const shouldSurviveDispatch = dedup
      ? dedup.shouldSurviveDispatch === true
      : false;

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
          shouldSurviveDispatch,
        };
      }),
    );

    const { newStagedCount, orphanedValues } =
      await this.scripts.stageBatch(jobsToStage);

    // Dedup-squash leases move inside the stage eval (see send()); here we take
    // leases only for genuinely new stages. A squash that discarded the NEW
    // value (orphan === the job's own value) staged nothing and gets no lease.
    await Promise.all(
      jobsToStage.map(async (job, i) => {
        const orphan = orphanedValues[i];
        if (!orphan || orphan.length === 0) {
          await this.blobLifecycle.takeLease(job.jobDataJson);
        }
      }),
    );

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

    // Audit hooks (ADR-030 revision). The Lua's stageBatch returns a count,
    // not a per-payload new/dedup map, so we fire onEnqueue for every
    // payload and let the adapter's idempotency (createMany skipDuplicates)
    // absorb dedup-collapsed duplicates. Index alignment is by position —
    // `jobsToStage[i]` corresponds to `payloads[i]`, so use the loop index
    // rather than `indexOf(job)`: the latter is O(n²) and would mis-associate
    // payloads if two jobs share an object reference.
    if (this.auditAdapter) {
      await this.runAuditAll(
        jobsToStage.map(
          (job, i) => () =>
            this.auditAdapter?.onEnqueue({
              payload: payloads[i]!,
              groupKey: job.groupId,
              dedupKey: job.dedupId || undefined,
              scheduledAt: new Date(job.dispatchAfterMs),
              maxAttempts: JOB_RETRY_CONFIG.maxAttempts,
            }),
        ),
      );
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
   * Best-effort audit-adapter invocation. PG outages log + continue;
   * the queue stays available. See ADR-030 revision for the "audit lags
   * but never blocks dispatch" property.
   */
  private async runAudit(
    op: () => Promise<unknown> | undefined,
  ): Promise<void> {
    if (!this.auditAdapter) return;
    try {
      await op();
    } catch (err) {
      this.logger.warn(
        {
          queueName: this.queueName,
          error: err instanceof Error ? err.message : String(err),
        },
        "Audit adapter hook failed; queue continues, projection lags",
      );
    }
  }

  /**
   * Fan-out variant of {@link runAudit}: fires all hooks concurrently and
   * logs each failure individually. Avoids paying one serial PG round trip
   * per payload/sibling inside the worker slot on large coalesced batches.
   */
  private async runAuditAll(
    ops: Array<() => Promise<unknown> | undefined>,
  ): Promise<void> {
    if (!this.auditAdapter || ops.length === 0) return;
    const results = await Promise.allSettled(
      ops.map((op) => Promise.resolve(op())),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        this.logger.warn(
          {
            queueName: this.queueName,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          },
          "Audit adapter hook failed; queue continues, projection lags",
        );
      }
    }
  }

  /**
   * fastq worker function: poison guard, then the real job processing.
   *
   * The guard records a claim strike BEFORE any decode/parse work and clears
   * it on every code path where the process survives (the finally below -
   * success, retry, exhausted-park, drop-to-replay, graceful drain all pass
   * through it). A job that seizes the event loop never reaches the finally:
   * the liveness probe kills the process, the strike stays behind, and after
   * enough consecutive deaths the next claim parks the group instead of
   * re-running the killer (specs/event-sourcing/poison-group-park-guard.feature).
   */
  private async processWithRetries(dispatched: DispatchResult): Promise<void> {
    const { stagedJobId, groupId, jobDataJson, originalScore } = dispatched;

    const strikeThreshold = readClaimStrikeThreshold();
    if (strikeThreshold > 0) {
      let strikes = 0;
      try {
        strikes = await this.scripts.recordClaimStrike(groupId);
      } catch {
        // Strike accounting is protective, never load-bearing: an unreadable
        // counter must not stop the queue.
      }
      if (strikes > strikeThreshold) {
        await this.parkPoisonGroup({
          groupId,
          stagedJobId,
          jobDataJson,
          originalScore,
          reason: "claim_strikes",
          errorMessage: `Poison guard: ${strikes - 1} consecutive worker deaths while this group was in flight (threshold ${strikeThreshold}). Inspect the staged jobs, then unblock the group to retry.`,
        });
        return;
      }
    }

    try {
      await this.processClaimedJob(dispatched);
    } finally {
      if (strikeThreshold > 0) {
        this.scripts.clearClaimStrikes(groupId).catch(() => {
          // The TTL on the strike key bounds the damage of a failed clear.
        });
      }
    }
  }

  /**
   * Processes a dispatched job with retries, OTEL tracing, heartbeats, and
   * error handling.
   */
  private async processClaimedJob(dispatched: DispatchResult): Promise<void> {
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
      if (err instanceof PayloadTooLargeError) {
        // Over the decode cap: parsing it would seize the event loop. Park the
        // group with the value intact for inspection - do NOT drop to replay
        // (replay would re-materialize the same value) and do NOT parse.
        await this.parkPoisonGroup({
          groupId,
          stagedJobId,
          jobDataJson,
          originalScore,
          reason: "oversized_payload",
          errorMessage: `Poison guard: ${err.message}. The staged value was parked unparsed.`,
        });
        return;
      }
      // Not transient (retry) and not oversized (park): we cannot process this
      // job, now or ever, on this worker. Complete the slot so the group stays
      // live, but name and count the loss — see dropStagedJob.
      await this.dropStagedJob({
        groupId,
        stagedJobId,
        jobDataJson,
        err,
        reason: dropReasonOf(err),
        message: "Failed to parse staged job data",
      });
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
        try {
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
        } catch (err) {
          if (err instanceof TransientBlobStoreError) {
            // A transient blob-store failure on any drained sibling MUST
            // re-stage the whole batch, not silently drop the siblings. Re-stage
            // the siblings via the normal path and route the dispatched job
            // through the same handleTransientDecode as the direct decode
            // failure — the body is unreachable, not gone (ADR-030 §2).
            await this.restageDrainedSiblings(groupId, drainedSiblings);
            await this.handleTransientDecode({
              groupId,
              stagedJobId,
              jobDataJson,
              err,
            });
            return;
          }
          if (err instanceof PayloadTooLargeError) {
            // An oversized drained sibling can't be parsed (it would seize the
            // event loop) and re-dispatch would only re-drain it. Mirror the
            // dispatched-job oversized path: park the group so it stops running
            // this batch until an operator intervenes. Re-stage the drained
            // siblings first (same restage the transient path uses) so the
            // other work, including the oversized value itself, is preserved
            // in staging for inspection, not lost to replay. The dispatched
            // job's value carries the park so the group moves to the blocked set.
            await this.restageDrainedSiblings(groupId, drainedSiblings);
            await this.parkPoisonGroup({
              groupId,
              stagedJobId,
              jobDataJson,
              originalScore,
              reason: "oversized_payload",
              errorMessage: `Poison guard: a coalesced sibling of this group is oversized (${err.message}). The batch was parked unparsed.`,
            });
            return;
          }
          throw err;
        }
      }
    }

    const jobStartTime = performance.now();
    const heartbeat = this.startActiveKeyHeartbeat({
      groupId,
      stagedJobId,
      jobDataJson,
    });
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
              // Audit hook: onLeased fires once per leased payload (including
              // each drained sibling in a coalesced batch). Best-effort —
              // PG outage logs+continues.
              //
              // `leasedUntil` is a soft projection of when the queue's retry
              // layer would reschedule the job if it stalled: now +
              // maxBackoffMs. Adapters use it for stuck-state dashboards.
              const leasedUntil = new Date(
                Date.now() + JOB_RETRY_CONFIG.maxBackoffMs,
              );
              await this.runAuditAll(
                (batchPayloads ?? [payload]).map(
                  (p) => () =>
                    this.auditAdapter?.onLeased({
                      payload: p,
                      attempt,
                      leasedUntil,
                    }),
                ),
              );

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
              await this.blobLifecycle.releaseLease({
                values: [
                  jobDataJson,
                  ...drainedSiblings.map((sibling) => sibling.jobDataJson),
                ],
                groupId,
              });
              gqJobsCompletedTotal.inc(routingLabels);

              // Audit hook: onDispatched fires once per dispatched payload
              // (dispatched + every drained sibling on success).
              const dispatchedAt = new Date();
              await this.runAuditAll(
                (batchPayloads ?? [payload]).map(
                  (p) => () =>
                    this.auditAdapter?.onDispatched({
                      payload: p,
                      at: dispatchedAt,
                      attempt,
                    }),
                ),
              );

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
              const isRetryable = isRetryableJobError(err);

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
                // If the retry re-encode fails (transient blob-store down,
                // payload-too-large from a state-bloat regression), the retry
                // can't proceed and the job is DISCARDED. Retire the old lease
                // explicitly: the body was already read, so keeping a liveness
                // claim buys a later worker nothing. Blob bytes remain for lazy
                // reclaim; what failed here is the re-ENCODE.
                let retryJobData: string;
                try {
                  retryJobData = await this.blobLifecycle.encode({
                    jobData: {
                      ...(payload as Record<string, unknown>),
                      __context: contextMetadata,
                      __attempt: attempt + 1,
                    },
                    groupId,
                  });
                } catch (encodeErr) {
                  this.recordDrop({
                    groupId,
                    stagedJobId,
                    jobDataJson,
                    err: encodeErr,
                    reason: "retry_encode_failed",
                    message:
                      "Retry re-encode failed; releasing old lease and discarding job",
                    // Released below, deliberately: the body was already read, so
                    // keeping it buys a later worker nothing.
                    bodyPreserved: false,
                  });
                  await this.blobLifecycle.releaseLease({
                    values: [jobDataJson],
                    groupId,
                  });
                  await this.scripts.complete({
                    groupId,
                    stagedJobId,
                    jobName,
                    dropped: true,
                  });
                  // Kept alongside gq_jobs_dropped_total: this counter is the
                  // specific "a retry-encode blip lost it" diagnostic, not a
                  // genuine non-retryable process() error. Oncall triaging a
                  // gq_jobs_non_retryable_total spike shouldn't have to grep
                  // logs to figure out which class of failure they're seeing.
                  gqRetryEncodeFailuresTotal.inc(routingLabels);
                  return;
                }

                await this.scripts.retryRestage({
                  groupId,
                  stagedJobId,
                  newStagedJobId,
                  dispatchAfterMs: Date.now() + backoffMs,
                  jobDataJson: retryJobData,
                  backoffMs,
                });
                // Atomically transfer the lease from the dispatched value to the
                // re-staged one. For GQ2 the retry re-encodes to the SAME content
                // hash, so one deadline replaces another in the lease set (the
                // blob stays); mixed/GQ1 falls back to ordered take+release.
                await this.blobLifecycle.transferLease({
                  newValue: retryJobData,
                  oldValue: jobDataJson,
                  groupId,
                });

                // Audit hook: willRetry=true. Fires for the dispatched
                // payload + every drained sibling (they all get re-staged).
                const nextAttemptAt = new Date(Date.now() + backoffMs);
                await this.runAuditAll(
                  (batchPayloads ?? [payload]).map(
                    (p) => () =>
                      this.auditAdapter?.onFailed({
                        payload: p,
                        error: error.message,
                        willRetry: true,
                        nextAttemptAt,
                        attempt,
                      }),
                  ),
                );

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

                // Audit hook: terminal — onDead fires for the dispatched
                // payload + every drained sibling.
                await this.runAuditAll(
                  (batchPayloads ?? [payload]).map(
                    (p) => () =>
                      this.auditAdapter?.onDead({
                        payload: p,
                        lastError: error.message,
                        attempt,
                      }),
                  ),
                );
                await this.blobLifecycle.releaseLease({
                  values: [jobDataJson],
                  groupId,
                });
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
        .catch(() => {
          // best-effort stats write; failures are non-fatal
        });
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
   * Parses a drained sibling's stored JSON into a clean payload. Returns null on
   * parse failure — the job was already removed from staging, so it is DISCARDED
   * here, mirroring the dispatched job's own parse-failure handling.
   *
   * This used to say "recoverable via event replay". It is not, for a reactor
   * job: replay never invokes reactors (see {@link dropStagedJob}). The loss is
   * counted instead of asserted away.
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
    } catch (err) {
      // A transient blob-store error on a sibling MUST NOT drop it to replay —
      // the dispatched job's decode routes transient errors through
      // `handleTransientDecode` so the whole batch can retry (ADR-030 §2).
      // Rethrow so the caller (Promise.all in the batch drain) can bubble it up
      // and re-stage every sibling together, rather than silently dropping
      // hundreds of siblings on a brief S3 blip (2026-06-24 review).
      if (err instanceof TransientBlobStoreError) {
        throw err;
      }
      // An oversized sibling must NOT drop to replay either: replay would
      // re-materialize the same over-cap value and parsing it would seize the
      // event loop. Rethrow so the caller parks the group (reason
      // oversized_payload) with the value intact for inspection, exactly as the
      // dispatched job's own decode does, instead of silently dropping it.
      if (err instanceof PayloadTooLargeError) {
        throw err;
      }
      // Already out of staging, so there is no slot to complete — but the loss is
      // real and is counted like any other (#5538).
      this.recordDrop({
        groupId,
        stagedJobId: sibling.stagedJobId,
        jobDataJson: sibling.jobDataJson,
        err,
        reason: dropReasonOf(err),
        message: "Failed to parse drained sibling job data — dropping",
        // We do not release a sibling's value, so the body outlives the drop
        // unless it was already gone.
        bodyPreserved: !(err instanceof DecodeFailureError
          ? err.reason === "missing_blob"
          : false),
      });
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
        // Renew the sibling's lease (idempotent: it kept the same holder
        // identity through the drain).
        await this.blobLifecycle.takeLease(sibling.jobDataJson);
      } catch (err) {
        // The sibling never made it back into staging, so nothing will dispatch
        // it again — that is a discard, whatever the re-stage intended (#5538).
        this.recordDrop({
          groupId,
          stagedJobId: sibling.stagedJobId,
          jobDataJson: sibling.jobDataJson,
          err,
          reason: "sibling_restage_failed",
          message: "Failed to re-stage drained sibling after batch failure",
          // Not released — the value is intact, it simply never got re-staged.
          bodyPreserved: true,
        });
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
    jobDataJson,
  }: {
    groupId: string;
    stagedJobId: string;
    jobDataJson: string;
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
      void this.blobLifecycle.renewLease(jobDataJson);
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

    // Take the re-staged value's lease; the caller releases the dispatched one
    // after this returns (take-before-release preserves continuous liveness).
    await this.blobLifecycle.takeLease(jobDataJson);

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
   * Give up on a staged job we cannot process — and say so out loud (#5538).
   *
   * The code this replaced justified itself with "recover via event replay". It
   * does not — and the proof is structural, not another comment: `ReplayExecutor`
   * calls the fold's pure `projection.apply()` and writes straight to the store
   * via `store.store()`, never constructing a `ProjectionRouter` — which is the
   * only thing that calls `dispatchToReactors`. Reactors are unreachable from
   * replay BY CONSTRUCTION. (`replay/` contains no reference to a reactor at all,
   * except two that exist to *suppress* re-fires.)
   *
   * `governanceOcsfEventsSync` (OCSF audit) and `gatewayBudgetSync` (billing) are
   * reactors on the `traceSummary` fold — so for them this method IS the terminal
   * event, and the counter below is the only evidence it ever happened. Scoped
   * honestly: fold/map drops genuinely ARE replay-covered (`ReplayService.replay`
   * drives `config.projections` + `config.mapProjections`). The false part is
   * reactor-specific.
   *
   * **Why `complete()`** — there are THREE options here, not two, and an earlier
   * draft of this comment argued a false binary:
   * - `parkPoisonGroup()` blocks the whole group. Right for an oversized payload
   *   (value intact; a raised cap could process it later); wrong here, because a
   *   missing blob never comes back, so parking would freeze that aggregate
   *   forever on a job that can never succeed.
   * - `retryRestage` (the ladder `handleTransientDecode` rides, 40 lines below) is
   *   the third option, and for `body_unreadable` it is arguably the RIGHT one:
   *   `JOB_RETRY_CONFIG`'s own doc says the budget exists to "ride out a rolling
   *   restart… without parking the group", which is precisely the codec-skew case.
   *   Retrying would hand the job to a newer worker that can read it, instead of
   *   leaving bytes nobody re-reads. **Deliberately deferred (#5823), not
   *   overlooked** — it changes delivery behaviour for every unreadable body and
   *   deserves its own change; this one only stops the loss being silent.
   *   Preserving without retrying is admittedly a half-measure: it keeps the body
   *   alive to its TTL backstop and names it, but nothing re-delivers it.
   * - `complete()` — chosen. Liveness is the one thing the old drop got right.
   *
   * Lease release is non-destructive: every terminal drop retires its liveness
   * claim, while Redis expiry or the durable-store lifecycle preserves and later
   * reclaims the shared bytes independently. A body-present codec-skew drop can
   * therefore leave its bytes inspectable without pretending a completed slot is
   * still a live lease holder.
   */
  private async dropStagedJob({
    groupId,
    stagedJobId,
    jobDataJson,
    err,
    reason,
    message,
  }: {
    groupId: string;
    stagedJobId: string;
    jobDataJson: string;
    err: unknown;
    /** Narrower than {@link DropReason}; other discard sites own no active slot. */
    reason: DecodeFailureReason | "transient_exhausted" | "unknown";
    message: string;
  }): Promise<void> {
    const bodyIsGone = reason === "missing_blob";

    this.recordDrop({
      groupId,
      stagedJobId,
      jobDataJson,
      err,
      reason,
      message,
      bodyPreserved: !bodyIsGone,
    });

    // `dropped: true` keeps the group advancing WITHOUT counting a thrown-away
    // job as a completion or clearing the group's stored error (#5538).
    await this.scripts.complete({ groupId, stagedJobId, dropped: true });
    await this.blobLifecycle.releaseLease({ values: [jobDataJson], groupId });
  }

  /**
   * Name and count a job we are throwing away, without deciding its slot.
   *
   * Split from {@link dropStagedJob} because not every discard owns a slot to
   * complete: a drained sibling is already out of staging, so its loss needs the
   * counter and the log but no `complete()`. Every path in this module that
   * discards a job routes through here, so `gq_jobs_dropped_total` is the whole
   * truth about what this queue throws away.
   */
  private recordDrop({
    groupId,
    stagedJobId,
    jobDataJson,
    err,
    reason,
    message,
    bodyPreserved,
  }: {
    groupId: string;
    stagedJobId: string;
    jobDataJson: string;
    err: unknown;
    reason: DropReason;
    message: string;
    /**
     * Whether the staged value's body is still retrievable after this drop.
     *
     * The CALLER states it; this method must not derive it. Only the caller knows
     * whether it released — and `retry_encode_failed` releases deliberately (the
     * body was already read; what failed is the re-encode), so deriving it from
     * `reason` made the log assert `bodyPreserved: true` one line before
     * destroying the body. That is the same defect this whole change exists to
     * remove — a claim that isn't true — so it does not get to live in the
     * structured field oncall filters on.
     */
    bodyPreserved: boolean;
  }): void {
    const { pipelineName, jobType, jobName } = readJobRoutingMeta(jobDataJson);
    const descriptor = readEnvelopeDescriptor(jobDataJson);

    gqJobsDroppedTotal.inc({
      queue_name: this.queueName,
      pipeline_name: pipelineName ?? "unknown",
      job_type: jobType ?? "unknown",
      job_name: jobName ?? "unknown",
      reason,
    });

    this.logger.error(
      {
        queueName: this.queueName,
        projectId: tenantIdFromGroupId(groupId),
        stagedJobId,
        groupId,
        reason,
        pipelineName,
        jobType,
        jobName,
        // Shape only — format, version, blob id. Never the body: it may carry
        // tenant PII, and the whole point is that we could not read it anyway.
        // The header survives what the body does not, so a value we could not
        // decode can still say what it WAS.
        envelopeFormat: descriptor.format,
        envelopeVersion: descriptor.version,
        blobId: descriptor.blobId,
        bodyPreserved,
        err: redactStorageUrisInText(
          err instanceof Error ? err.message : String(err),
        ),
      },
      message,
    );
  }

  /**
   * Claim-side poison park (specs/event-sourcing/poison-group-park-guard.feature):
   * re-stage the SAME staged value (no decode, no re-encode, lease identity
   * unchanged - the transient-decode rationale applies) and move the group to
   * the blocked set with a stored error. The value stays inspectable via the
   * ops peek path; operators recover with the existing unblock/drain surface.
   */
  private async parkPoisonGroup({
    groupId,
    stagedJobId,
    jobDataJson,
    originalScore,
    reason,
    errorMessage,
  }: {
    groupId: string;
    stagedJobId: string;
    jobDataJson: string;
    originalScore: number;
    reason: "claim_strikes" | "oversized_payload";
    errorMessage: string;
  }): Promise<void> {
    const score =
      typeof originalScore === "number" ? originalScore : Date.now();
    await this.scripts.restageAndBlock({
      groupId,
      newStagedJobId: `${stagedJobId}/p/${Date.now()}`,
      score,
      jobDataJson,
      errorMessage,
    });
    gqGroupsPoisonParkedTotal.inc({
      queue_name: this.queueName,
      reason,
    });
    this.logger.error(
      {
        queueName: this.queueName,
        projectId: tenantIdFromGroupId(groupId),
        groupId,
        stagedJobId,
        reason,
      },
      "Poison guard parked group into the blocked set",
    );
  }

  /**
   * A transient blob-store failure (network/5xx) means the body is temporarily
   * unreachable — not gone. Re-stage the SAME envelope with backoff so the job
   * retries instead of dropping to replay; the value is still valid and its lease
   * identity is unchanged, so there is no re-encode or identity churn. The
   * restage renews that lease before returning. Bounded by the
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
      // The retry ladder is out of rungs. This is a discard like any other, and
      // it used to claim replay would recover it — it does not (#5538).
      //
      // Reaching here means every one of
      // `JOB_RETRY_CONFIG.maxAttempts` READS failed — ~2h27m of sustained
      // unreachability (`queues/shared.ts`) — which says the STORE is down, not
      // that the blob is gone. It is most likely still there, so the drop keeps
      // the shared bytes for lazy reclaim while retiring this job's lease.
      await this.dropStagedJob({
        groupId,
        stagedJobId,
        jobDataJson,
        err,
        reason: "transient_exhausted",
        message: `Blob store unreachable after ${attempt} attempts; discarding job (replay does not recover reactor jobs)`,
      });
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
    await this.blobLifecycle.renewLease(jobDataJson);
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
      .catch(() => {
        // best-effort wake; a failed signal only delays dispatcher exit
      });
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

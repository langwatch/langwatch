// biome-ignore-all lint/suspicious/noEmptyBlockStatements: empty blocks here are deliberate no-ops.

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { performance } from "node:perf_hooks";
// Imported rather than read off the global: the constructor destructures a
// `process` handler out of the queue definition, and a class field initializer
// runs inside that same scope — so a bare `process.pid` here resolves to the
// handler's binding and dies in its temporal dead zone.
import { pid } from "node:process";

import { createLogger } from "@langwatch/observability";
import {
  type Attributes,
  context as otelContext,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  TraceFlags,
  trace,
} from "@opentelemetry/api";
import fastq from "fastq";
import { Cluster, Redis as IORedis } from "ioredis";

import type {
  DeduplicationConfig,
  GroupQueueActivity,
  GroupQueueContextMetadata,
  GroupQueueContext,
  GroupQueueFailureClassifier,
  GroupQueuePolicy,
  GroupQueueRuntimeDefinition,
  JobDelivery,
  QueueAuditAdapter,
  QueueSendOptions,
} from "./contracts.ts";
import { GroupQueueDispatcher } from "./dispatcher.ts";
import { EnvelopeBlobLifecycle } from "./envelopeBlobLifecycle.ts";
import { defaultFailureDecision, GroupQueueConfigurationError, GroupQueueError } from "./errors.ts";
import {
  DecodeFailureError,
  type DecodeFailureReason,
  PayloadTooLargeError,
  readEnvelopeDescriptor,
  readJobAttempt,
  readJobPayloadBytes,
  readJobRoutingMeta,
  withJobAttempt,
} from "./jobEnvelope.ts";
import {
  LATENCY_HOUR_BUCKET_TTL_SECONDS,
  LATENCY_MINUTE_BUCKET_TTL_SECONDS,
  LATENCY_SAMPLE_SIZE,
  latencyAllTimeKey,
  latencyBucketField,
  latencyHourBucketKey,
  latencyMinuteBucketKey,
} from "./latency.ts";
import {
  gqBatchBisectionsTotal,
  gqForeignSiblingsRestagedTotal,
  gqGroupAttemptReadFailuresTotal,
  gqGroupsBlockedTotal,
  gqGroupsPoisonParkedTotal,
  gqJobDelayMilliseconds,
  gqJobDurationMilliseconds,
  gqJobsCompletedTotal,
  gqJobsDedupedTotal,
  gqJobsDelayedTotal,
  gqJobsExhaustedTotal,
  gqJobsNonRetryableTotal,
  gqJobsRetriedTotal,
  gqJobsStagedTotal,
  gqReadyScoreImplausibleTotal,
  gqRetryAttempt,
  gqRetryBackoffMilliseconds,
  gqRetryEncodeFailuresTotal,
  recordDroppedJob,
} from "./metrics.ts";
import { GroupQueueMetricsCollector } from "./metricsCollector.ts";
import { getBackoffMs, JOB_RETRY_CONFIG } from "./retry.ts";
import {
  type ProjectStorageDestination,
  redactStorageUrisInText,
  tenantIdFromGroupId,
} from "./storage.ts";

function createBlockingConnection({
  consumerEnabled,
  redisConnection,
}: {
  consumerEnabled: boolean;
  redisConnection: IORedis | Cluster;
}): IORedis | Cluster {
  if (!consumerEnabled) return redisConnection;
  if (redisConnection instanceof IORedis) {
    return redisConnection.duplicate({ maxRetriesPerRequest: null });
  }
  if (redisConnection instanceof Cluster) {
    return redisConnection.duplicate();
  }
  return redisConnection;
}
import { nowInstant, Temporal } from "@langwatch/time";

import { fallbackReadyScore, isPlausibleReadyScore, resolveReadyScore } from "./readyScore.ts";
import {
  DEFAULT_BISECTION_SPLITS_PER_DISPATCH,
  DEFAULT_CONFIRMED_DEATH_THRESHOLD,
  DEFAULT_GROUP_QUARANTINE_THRESHOLD,
  type DispatchResult,
  type DrainedJob,
  GroupStagingScripts,
  WORKER_LIVENESS_REFRESH_MS,
} from "./scripts.ts";
import { type ObjectStore, TransientBlobStoreError } from "./tieredBlobStore.ts";

/** Mutable state shared across one dispatch's bisection descent. */
interface BisectionDispatchState {
  /** True once any sub-batch of this dispatch committed successfully. */
  hasCommitted: boolean;
  /** Splits performed so far — compared against the budget above. */
  splits: number;
}

/**
 * `queueDispatchScopeKey` rides on the metadata index signature, so a context
 * port reports it as `unknown`; this narrows it to the one shape it is.
 */
function scopeKeyOf(metadata: GroupQueueContextMetadata | undefined): string | undefined {
  const value = metadata?.queueDispatchScopeKey;
  return typeof value === "string" ? value : undefined;
}

async function withActiveSpan<T>(
  name: string,
  options: Parameters<ReturnType<typeof trace.getTracer>["startActiveSpan"]>[1],
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer("langwatch.group-queue");
  return tracer.startActiveSpan(name, options, async (span) => {
    try {
      return await operation(span);
    } finally {
      span.end();
    }
  });
}

/**
 * TTL for retry-chain counter; must outlive the longest backoff interval,
 * derived from retry config to prevent fresh-delivery misreads on re-expire.
 */
export const GROUP_ATTEMPT_TTL_SECONDS = Math.ceil((JOB_RETRY_CONFIG.maxBackoffMs / 1000) * 3);

/**
 * A field off an untrusted payload, when it is actually a usable string.
 * Payloads are `Record<string, unknown>` by design, so fields must be checked
 * rather than asserted; anything else reads as absent.
 */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Configuration for the group queue; exported because activeTtlSec sets the
 * floor for poison guard beacon TTL (interdependency tested across modules).
 */
export const GROUP_QUEUE_CONFIG = {
  /** Default global concurrency (max parallel groups) */
  defaultGlobalConcurrency: 100,
  /** TTL for the active key (safety net for crashes), in seconds */
  activeTtlSec: 300,
  /** BRPOP timeout in seconds (fallback polling interval) */
  signalTimeoutSec: 5,
  /** Interval for collecting queue metrics in milliseconds */
  metricsIntervalMs: 15000,
  /** Default maximum time to wait for graceful consumer shutdown. */
  shutdownTimeoutMs: 25_000,
} as const;

/** Default TTL for deduplication in milliseconds */
const DEFAULT_DEDUPLICATION_TTL_MS = 200;

/**
 * Default byte budget for coalesced batches; keeps appends inside ClickHouse
 * async-insert flush budget (ADR-066) and doesn't affect count-limited batches.
 */
export const DEFAULT_COALESCE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The `__*` namespace is reserved for queue machinery except the caller-set
 * `__pipelineName`/`__jobType`/`__jobName`; anything else could collide with
 * the GQ2 content hash and clobber on decode (ADR-029), so it's rejected here.
 */
const CALLER_RESERVED_KEYS = new Set(["__pipelineName", "__jobType", "__jobName"]);

function assertNoReservedKeys(
  payload: Record<string, unknown>,
  queueName: string,
  method: "send" | "sendBatch",
): void {
  for (const key of Object.keys(payload)) {
    if (key.startsWith("__") && !CALLER_RESERVED_KEYS.has(key)) {
      throw new GroupQueueError(
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
 * Why a staged job was discarded; extends {@link DecodeFailureReason} with this
 * module's own terminal reasons. `unknown` is a safety valve, not a shrug: a
 * nonzero `reason="unknown"` on `gq_jobs_dropped_total` is a bug to chase.
 */
type DropReason =
  | DecodeFailureReason
  | "transient_exhausted"
  | "sibling_restage_failed"
  | "retry_encode_failed"
  | "unknown";

/**
 * Classifies a caught decode failure by TYPE, not by message text: zlib's
 * wording is Node-version-dependent, so a substring match would break under a
 * runtime upgrade.
 */
const dropReasonOf = (err: unknown): DecodeFailureReason | "unknown" =>
  err instanceof DecodeFailureError ? err.reason : "unknown";

/**
 * Per-group FIFO with cross-group parallelism: send() stages into Redis,
 * dispatch() hands work to fastq, which runs it with concurrency-limited
 * backpressure, and completion triggers the next dispatch.
 */
export class GroupQueueProcessor<Payload extends Record<string, unknown>> {
  private readonly logger = createLogger("langwatch:group-queue");
  private readonly queueName: string;
  private readonly jobName: string;
  private readonly process: (payload: Payload, delivery?: JobDelivery) => Promise<void>;
  private readonly processBatch?: (payloads: Payload[], delivery?: JobDelivery) => Promise<void>;
  private readonly coalesceMaxBatch?: (payload: Payload) => number | undefined;
  private readonly coalesceMaxBytes?: (payload: Payload) => number | undefined;
  private readonly spanAttributes?: (payload: Payload) => Attributes;
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
  private readonly activity?: GroupQueueActivity<Payload>;
  private readonly contextPort?: GroupQueueContext;
  private readonly failureClassifier?: GroupQueueFailureClassifier;
  private readonly identify: (payload: Payload) => string;
  private readonly shutdownTimeoutMs: number;
  private readonly globalConcurrency: number;
  private readonly consumerEnabled: boolean;
  private readonly dispatchGroupAllowListKey?: string;
  private readonly preflightDrainTimeoutMs: number;
  private readonly dispatcher: GroupQueueDispatcher | null;
  private readonly metricsCollector: GroupQueueMetricsCollector | null;
  /**
   * Consecutive-failure count that quarantines (blocks) a group. Read once at
   * construction; 0 disables the breaker.
   */
  private readonly quarantineFailStreakThreshold: number;

  /**
   * Splits allowed per dispatch before bisection yields to retry/backoff. Read
   * once at construction; 0 disables bisection outright.
   */
  private readonly bisectionSplitBudget: number;

  /**
   * Confirmed worker deaths tolerated before a group is parked. Read once at
   * construction, like the two thresholds above; 0 disables the poison guard.
   */
  private readonly deathThreshold: number;

  private shutdownRequested = false;
  /**
   * Whether `send`/`sendBatch` may still stage work — separate from
   * `shutdownRequested`, since the drain that runs after shutdown still
   * dispatches into this same queue and must not be blocked by it.
   */
  private stagingClosed = false;
  /** Tracks in-flight jobs for active count metrics. */
  private activeJobCount = 0;

  /**
   * Identity this process stamps onto every claim and beacon. Unique per
   * process INSTANCE — a restarted pod must not inherit its predecessor's
   * identity, or that pod's death would misread as "that's me, still running".
   */
  private readonly workerId = `${hostname()}-${pid}-${randomUUID().slice(0, 8)}`;

  /** Beacon refresh timer; stopped before the retirement write in {@link close}. */
  private livenessTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * Whether this worker's own beacon is confirmed in Redis. The guard reads a
   * missing beacon as a death, so while unconfirmed it sits out entirely —
   * a real death goes briefly uncounted, the cheap direction to be wrong in.
   */
  private beaconLive = false;

  /**
   * Resolves once this worker's beacon exists in Redis. Claims await it, so a
   * worker can never own a claim before the beacon that vouches for it exists —
   * closing the window where a peer could misread it as dead.
   */
  private readonly livenessReady: Promise<void>;

  constructor(
    definition: GroupQueueRuntimeDefinition<Payload>,
    redisConnection?: IORedis | Cluster,
    options?: {
      consumerEnabled?: boolean;
      dispatchGroupAllowListKey?: string;
      preflightDrainTimeoutMs?: number;
      objectStoreFor?: (projectId: string) => ObjectStore;
      resolveStorageDestination?: (projectId: string) => Promise<ProjectStorageDestination>;
      activity?: GroupQueueActivity<Payload>;
      context?: GroupQueueContext;
      failures?: GroupQueueFailureClassifier;
      drainTimeoutMs?: number;
      policy?: GroupQueuePolicy;
    },
  ) {
    const {
      name,
      process,
      processBatch,
      coalesceMaxBatch,
      coalesceMaxBytes,
      options: defOptions,
      delay,
      spanAttributes,
      deduplication,
      groupKey,
      identify,
      score,
      auditAdapter,
    } = definition;

    const effectiveConnection = redisConnection ?? null;
    if (!effectiveConnection) {
      throw new GroupQueueConfigurationError(
        "GroupQueueProcessor",
        "Group queue processor requires Redis connection.",
      );
    }

    if (!groupKey) {
      throw new GroupQueueConfigurationError(
        "GroupQueueProcessor",
        "Group queue processor requires a groupKey function in the queue definition.",
      );
    }

    this.redisConnection = effectiveConnection;
    this.consumerEnabled = options?.consumerEnabled ?? true;
    this.dispatchGroupAllowListKey = options?.dispatchGroupAllowListKey;
    this.preflightDrainTimeoutMs = options?.preflightDrainTimeoutMs ?? 60_000;
    // Dedicated connection for BRPOP to avoid blocking the shared connection.
    // Only needed when the dispatcher loop runs (consumer mode).
    // IORedis.duplicate() takes an options override; Cluster.duplicate() takes no
    // args (maxRetriesPerRequest: null is already set inside Cluster's redisOptions).
    this.blockingConnection = createBlockingConnection({
      consumerEnabled: this.consumerEnabled,
      redisConnection: effectiveConnection,
    });
    this.spanAttributes = spanAttributes;
    this.delay = delay;
    this.deduplication = deduplication;
    this.groupKey = groupKey;
    this.identify = identify;
    this.score = score;
    this.queueName = name;
    this.jobName = "queue";
    this.process = process;
    this.processBatch = processBatch;
    this.coalesceMaxBatch = coalesceMaxBatch;
    this.coalesceMaxBytes = coalesceMaxBytes;
    this.auditAdapter = auditAdapter;
    this.globalConcurrency =
      defOptions?.globalConcurrency ?? GROUP_QUEUE_CONFIG.defaultGlobalConcurrency;
    this.activity = options?.activity;
    this.contextPort = options?.context;
    this.failureClassifier = options?.failures;
    this.shutdownTimeoutMs = options?.drainTimeoutMs ?? GROUP_QUEUE_CONFIG.shutdownTimeoutMs;
    this.quarantineFailStreakThreshold =
      options?.policy?.quarantineFailureThreshold ?? DEFAULT_GROUP_QUARANTINE_THRESHOLD;
    this.bisectionSplitBudget =
      options?.policy?.bisectionSplitBudget ?? DEFAULT_BISECTION_SPLITS_PER_DISPATCH;
    this.deathThreshold =
      options?.policy?.confirmedDeathThreshold ?? DEFAULT_CONFIRMED_DEATH_THRESHOLD;

    // Initialize Lua scripts wrapper
    this.scripts = new GroupStagingScripts(this.redisConnection, this.queueName, {
      tenantConcurrencyCap: options?.policy?.tenantConcurrencyCap,
      globalConcurrencyBudget: options?.policy?.globalConcurrencyBudget,
    });

    // The GQ2 content-addressed blob lifecycle — tiered store and the
    // encode/decode/renew/release seams. Staging Lua acquires the leases.
    this.blobLifecycle = new EnvelopeBlobLifecycle({
      redis: this.redisConnection,
      queueName: this.queueName,
      objectStoreFor: options?.objectStoreFor,
      resolveStorageDestination: options?.resolveStorageDestination,
      compression: options?.policy?.compression,
      payloadCodec: options?.policy?.payloadCodec,
    });

    // Advertise this queue in the registry set so the ops dashboard enumerates
    // it via SMEMBERS instead of an O(keyspace) `SCAN MATCH *:gq:ready`.
    // Best-effort: a miss only degrades discovery to the scan fallback.
    void this.scripts.registerQueue().catch((err) => {
      this.logger.debug({ err, queueName: this.queueName }, "queue registry registration failed");
    });

    // fastq promise-based queue: bounds concurrency on this node
    this.processingQueue = fastq.promise(
      this.processWithRetries.bind(this),
      this.globalConcurrency,
    );
    this.processingQueue.saturated = () => {
      this.logger.debug({ queueName: this.queueName }, "Processing queue saturated");
    };

    // Publish the liveness beacon before anything can claim. A consumer that
    // never claims still needs no beacon, so producers skip it entirely.
    this.livenessReady = this.consumerEnabled ? this.startLivenessBeacon() : Promise.resolve();

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
        dispatchGroupAllowListKey: this.dispatchGroupAllowListKey
          ? `${this.dispatchGroupAllowListKey}:candidates`
          : undefined,
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

  private captureContext(): GroupQueueContextMetadata | undefined {
    return this.contextPort?.capture();
  }

  private async runInContext<T>(
    metadata: GroupQueueContextMetadata | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.contextPort ? await this.contextPort.run(metadata, operation) : await operation();
  }

  private failureDecision(error: unknown): {
    retryable: boolean;
    retryAfterMs?: number;
  } {
    return this.failureClassifier?.classify(error) ?? defaultFailureDecision(error);
  }

  /**
   * Resolves a ready score and reports what it had to refuse — every path that
   * writes one goes through here, since scanning the ready set later can't work
   * once the bad value has replaced it. `delay` is excluded: a queue decision.
   */
  private resolveScore(rawScore: unknown, nowMs: number = nowInstant().epochMilliseconds): number {
    const { score, isRejected } = resolveReadyScore({
      score: rawScore,
      nowMs,
    });
    if (isRejected) {
      gqReadyScoreImplausibleTotal.inc({ queue_name: this.queueName });
    }
    return score;
  }

  /**
   * Ready score for a job being put BACK: only the absolute floor applies,
   * since re-judging against a later clock would reject a legitimately old job.
   * Skips the implausible-score counter — already cleared once at staging.
   */
  private restageScore(originalScore: unknown): number {
    return isPlausibleReadyScore(originalScore) ? originalScore : fallbackReadyScore();
  }

  /**
   * Stages a job into the group queue's Redis staging layer.
   */
  async send(payload: Payload, options?: QueueSendOptions<Payload>): Promise<void> {
    if (this.stagingClosed) {
      throw new GroupQueueError(
        this.queueName,
        "send",
        "Cannot send to queue after its drain has finished",
      );
    }
    assertNoReservedKeys(payload as Record<string, unknown>, this.queueName, "send");

    const delay = options?.delay ?? this.delay;
    const dedup = options?.deduplication ?? this.deduplication;

    const groupId = this.groupKey(payload);
    await this.registerPreflightGroup(groupId);
    const stagedJobId = this.generateStagedJobId(payload);
    // Not `?? Date.now()`: a score function returning 0 or NaN (a payload with
    // no usable occurrence time) survives `??` and stages the job at the epoch.
    const score = this.resolveScore(this.score?.(payload));
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
    const capturedContext = this.captureContext();
    const contextMetadata = {
      ...capturedContext,
      queueDispatchScopeKey: scopeKeyOf(capturedContext) ?? this.dispatchGroupAllowListKey,
    };
    const payloadWithContext = {
      ...(payload as Record<string, unknown>),
      __context: contextMetadata,
    };

    // Add span attributes
    const span = trace.getActiveSpan();
    if (span) {
      const customAttributes = this.spanAttributes ? this.spanAttributes(payload) : {};
      span.setAttributes({ ...customAttributes });
    }

    const jobDataJson = await this.blobLifecycle.encode({
      jobData: payloadWithContext,
      groupId,
    });

    const { isNew } = await this.scripts.stage({
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
    await this.activatePreflightGroup(groupId);

    if (isNew) {
      gqJobsStagedTotal.inc({ queue_name: this.queueName });
      if (delay && delay > 0) {
        gqJobsDelayedTotal.inc({ queue_name: this.queueName });
        gqJobDelayMilliseconds.observe({ queue_name: this.queueName }, delay);
      }
      void Promise.resolve(
        this.activity?.staged({
          queue: this.queueName,
          group: groupId,
          payload,
          count: 1,
        }),
      ).catch(() => {});
      // Audit only the new-stage path, not
      // dedup-collapse. The adapter's audit row already exists for the
      // first send under this dedup ID.
      await this.runAudit(() =>
        this.auditAdapter?.onEnqueue({
          payload,
          groupKey: groupId,
          dedupKey: dedupId || undefined,
          scheduledAt: Temporal.Instant.fromEpochMilliseconds(dispatchAfterMs),
          // Mirror the queue's actual retry budget into any attached audit
          // projection so its terminal status agrees with queue behavior.
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

  async sendBatch(payloads: Payload[], options?: QueueSendOptions<Payload>): Promise<void> {
    if (this.stagingClosed) {
      throw new GroupQueueError(
        this.queueName,
        "sendBatch",
        "Cannot send to queue after its drain has finished",
      );
    }

    if (payloads.length === 0) {
      return;
    }
    for (const payload of payloads) {
      assertNoReservedKeys(payload as Record<string, unknown>, this.queueName, "sendBatch");
    }

    const delay = options?.delay ?? this.delay;
    const dedup = options?.deduplication ?? this.deduplication;

    const capturedContext = this.captureContext();
    const contextMetadata = {
      ...capturedContext,
      queueDispatchScopeKey: scopeKeyOf(capturedContext) ?? this.dispatchGroupAllowListKey,
    };
    const now = nowInstant().epochMilliseconds;

    const shouldExtend = dedup ? dedup.extend !== false : true;
    const shouldReplace = dedup ? dedup.replace !== false : true;
    const shouldSurviveDispatch = dedup ? dedup.shouldSurviveDispatch === true : false;

    const jobsToStage = await Promise.all(
      payloads.map(async (payload, index) => {
        const groupId = this.groupKey(payload);
        const stagedJobId = this.generateStagedJobId(payload);
        // Same guard as send(); `now` is shared so a batch that falls back
        // keeps its FIFO order, and so every payload is judged against one
        // clock reading rather than drifting across the batch.
        const score = this.resolveScore(this.score?.(payload), now);
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

    await Promise.all(jobsToStage.map((job) => this.registerPreflightGroup(job.groupId)));

    const { newStagedCount } = await this.scripts.stageBatch(jobsToStage);
    await Promise.all(jobsToStage.map((job) => this.activatePreflightGroup(job.groupId)));

    const dedupedCount = payloads.length - newStagedCount;
    if (newStagedCount > 0) {
      gqJobsStagedTotal.inc({ queue_name: this.queueName }, newStagedCount);
      const effectiveDelay = options?.delay ?? this.delay;
      if (effectiveDelay && effectiveDelay > 0) {
        gqJobsDelayedTotal.inc({ queue_name: this.queueName }, newStagedCount);
        for (let i = 0; i < newStagedCount; i++) {
          gqJobDelayMilliseconds.observe({ queue_name: this.queueName }, effectiveDelay);
        }
      }
      const perGroup = new Map<string, { payload: Payload; count: number }>();
      for (const [index, job] of jobsToStage.entries()) {
        const current = perGroup.get(job.groupId);
        perGroup.set(job.groupId, {
          payload: payloads[index]!,
          count: (current?.count ?? 0) + 1,
        });
      }
      for (const [group, value] of perGroup) {
        void Promise.resolve(
          this.activity?.staged({
            queue: this.queueName,
            group,
            payload: value.payload,
            count: value.count,
          }),
        ).catch(() => {});
      }
    }
    if (dedupedCount > 0) {
      gqJobsDedupedTotal.inc({ queue_name: this.queueName }, dedupedCount);
    }

    // stageBatch returns a count, not a per-payload map, so onEnqueue fires for
    // every payload and the adapter's idempotency (skipDuplicates) absorbs
    // dedup collapses. Index alignment is by position — use the loop index, not
    // indexOf, since duplicate object references would mis-associate payloads.
    if (this.auditAdapter) {
      await this.runAuditAll(
        jobsToStage.map(
          (job, i) => () =>
            this.auditAdapter?.onEnqueue({
              payload: payloads[i]!,
              groupKey: job.groupId,
              dedupKey: job.dedupId || undefined,
              scheduledAt: Temporal.Instant.fromEpochMilliseconds(job.dispatchAfterMs),
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
   * the queue stays available: audit may lag but never blocks dispatch.
   */
  private async runAudit(op: () => Promise<unknown> | undefined): Promise<void> {
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
  private async runAuditAll(ops: (() => Promise<unknown> | undefined)[]): Promise<void> {
    if (!this.auditAdapter || ops.length === 0) return;
    const results = await Promise.allSettled(ops.map((op) => Promise.resolve(op())));
    for (const result of results) {
      if (result.status === "rejected") {
        this.logger.warn(
          {
            queueName: this.queueName,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          },
          "Audit adapter hook failed; queue continues, projection lags",
        );
      }
    }
  }

  /**
   * fastq worker: poison guard, then real processing. A job that seizes the
   * event loop never releases its claim, so the liveness probe kills it and
   * the next claimant finds a provably dead owner (poison-group-park-guard.feature).
   */
  private async processWithRetries(dispatched: DispatchResult): Promise<void> {
    const { stagedJobId, groupId, jobDataJson, originalScore } = dispatched;

    // The beacon must exist before this worker owns a marker, or a peer would
    // read our live claim as an abandoned one.
    await this.livenessReady;

    const { deathThreshold } = this;
    const guardEnabled = deathThreshold > 0 && this.beaconLive;
    if (guardEnabled) {
      let deaths = 0;
      let lastOwnerState = "";
      try {
        ({ deaths, lastOwnerState } = await this.scripts.recordClaim({
          groupId,
          workerId: this.workerId,
          stagedJobId,
        }));
      } catch {
        // Poison accounting is protective, never load-bearing: an unreadable
        // marker must not stop the queue.
      }
      if (deaths >= deathThreshold) {
        await this.parkPoisonGroup({
          groupId,
          stagedJobId,
          jobDataJson,
          originalScore,
          reason: "claim_strikes",
          lastOwnerState,
          errorMessage: `Poison guard: ${deaths} confirmed worker deaths while this group was in flight (threshold ${deathThreshold}). Each was a worker that claimed this group and then stopped heartbeating without shutting down. Inspect the staged jobs, then unblock the group to retry.`,
        });
        return;
      }
    }

    try {
      await this.processClaimedJob(dispatched);
    } finally {
      if (guardEnabled) {
        // Compare-and-delete: this job may have outlived its own active lease
        // (heartbeat failures are warn-and-continue), in which case the group
        // was redispatched and the marker now belongs to someone else. Deleting
        // it blind would erase their ownership AND the group's accrued deaths.
        this.scripts.releaseClaim({ groupId, workerId: this.workerId }).catch(() => {
          // Safe to lose: the marker it would have removed still names this
          // worker, which is alive (and will retire rather than vanish), so
          // the next claim reads it as ordinary rather than as a death.
        });
      }
    }
  }

  /**
   * The definition's own span attributes, keeping only the scalar ones. A
   * throwing definition contributes what it managed to yield and no more.
   */
  private customSpanAttributes(payload: Payload): Record<string, string | number | boolean> {
    const scalars: Record<string, string | number | boolean> = {};
    if (!this.spanAttributes) return scalars;

    try {
      for (const [key, value] of Object.entries(this.spanAttributes(payload))) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          scalars[key] = value;
        }
      }
    } catch {
      // If spanAttributes throws, continue with base attributes
    }

    return scalars;
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

    const contextMetadata = jobData.__context as GroupQueueContextMetadata | undefined;
    const jobAttempt = typeof jobData.__attempt === "number" ? jobData.__attempt : 1;
    // A re-staged sibling carries no __attempt of its own, so fall back to the
    // group's chain counter rather than reading it as a fresh delivery.
    const attempt = Math.max(jobAttempt, await this.readGroupAttempt(groupId));
    // Checked, not asserted: these become Prometheus label values, and `??`
    // would let a non-string through to be stringified into one.
    const pipelineName = nonEmptyString(jobData.__pipelineName) ?? "unknown";
    const jobType = nonEmptyString(jobData.__jobType) ?? "unknown";
    const jobName = nonEmptyString(jobData.__jobName) ?? "unknown";
    const routingLabels = {
      queue_name: this.queueName,
      pipeline_name: pipelineName,
      job_type: jobType,
      job_name: jobName,
    };
    const payload = this.stripInternalFields(jobData);

    // Opt-in batch coalescing drains additional staged DUE jobs from the same
    // group into one handler call; the group's active key makes the drain
    // exclusive. A preflight scope must propagate through every causal chain, so
    // coalescing across two concurrent scopes would drop the second one's fan-out.
    const maxBatch = contextMetadata?.queueDispatchScopeKey
      ? 1
      : (this.coalesceMaxBatch?.(payload) ?? 1);
    let batchPayloads: Payload[] | null = null;
    // Staged-job id per batch member, index-aligned with batchPayloads, so a
    // bisected failure can name the payload it narrowed to.
    let batchJobIds: string[] = [];
    let drainedSiblings: DrainedJob[] = [];
    if (maxBatch > 1 && this.processBatch) {
      // Byte bound (ADR-066 pillar 2): the drain stops before a job that would
      // push the batch past maxBytes, counting the dispatched job's own
      // payload size as the start. Measures payload size, not
      // `jobDataJson.length` — an offloaded body leaves a small reference in
      // the stored value, which would let oversized records through untouched.
      const maxBytes = this.coalesceMaxBytes?.(payload) ?? DEFAULT_COALESCE_MAX_BYTES;
      const initialBytes = readJobPayloadBytes(jobDataJson);
      try {
        drainedSiblings = await this.scripts.drainGroupReady({
          groupId,
          nowMs: nowInstant().epochMilliseconds,
          maxJobs: maxBatch - 1,
          maxBytes,
          initialBytes,
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
      // Mixed-command groups (ADR-066 pillar 2): a drained sibling can belong to a
      // different job than the dispatched one, so only coalesce siblings whose
      // `__jobName` matches; restage the rest. Read names via `readJobRoutingMeta`
      // (null when absent), not the `jobName` local, which defaults to "unknown"
      // and would wrongly match a sibling's null.
      if (drainedSiblings.length > 0) {
        const dispatchedJobName = readJobRoutingMeta(jobDataJson).jobName;
        const matchingSiblings: DrainedJob[] = [];
        const foreignSiblings: DrainedJob[] = [];
        for (const sibling of drainedSiblings) {
          const siblingJobName = readJobRoutingMeta(sibling.jobDataJson).jobName;
          if (siblingJobName === dispatchedJobName) {
            matchingSiblings.push(sibling);
          } else {
            foreignSiblings.push(sibling);
          }
        }
        if (foreignSiblings.length > 0) {
          gqForeignSiblingsRestagedTotal.inc(
            { queue_name: this.queueName },
            foreignSiblings.length,
          );
          await this.restageDrainedSiblings(groupId, foreignSiblings);
        }
        drainedSiblings = matchingSiblings;
      }
      if (drainedSiblings.length > 0) {
        try {
          const parsedSiblings = await Promise.all(
            drainedSiblings.map((sibling) => this.parseDrainedPayload({ sibling, groupId })),
          );
          const liveSiblings: DrainedJob[] = [];
          const siblingPayloads: Payload[] = [];
          const differentlyScoped: DrainedJob[] = [];
          for (const [index, parsed] of parsedSiblings.entries()) {
            if (!parsed) continue;
            const sibling = drainedSiblings[index]!;
            if (parsed.queueDispatchScopeKey !== contextMetadata?.queueDispatchScopeKey) {
              differentlyScoped.push(sibling);
              continue;
            }
            liveSiblings.push(sibling);
            siblingPayloads.push(parsed.payload);
          }
          if (differentlyScoped.length > 0) {
            await this.restageDrainedSiblings(groupId, differentlyScoped);
          }
          drainedSiblings = liveSiblings;
          if (siblingPayloads.length > 0) {
            batchPayloads = [payload, ...siblingPayloads];
            batchJobIds = [stagedJobId, ...liveSiblings.map((sibling) => sibling.stagedJobId)];
          }
        } catch (err) {
          if (err instanceof TransientBlobStoreError) {
            // A transient blob-store failure on any drained sibling MUST
            // re-stage the whole batch, not silently drop the siblings. Re-stage
            // the siblings via the normal path and route the dispatched job
            // through the same handleTransientDecode as the direct decode
            // failure — the body is unreachable, not gone (ADR-029).
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
            // An oversized drained sibling can't be parsed without seizing the event
            // loop, and re-dispatch would only re-drain it — so mirror the oversized
            // path: park the group and re-stage the drained siblings first, preserving
            // them (and the oversized value) for inspection rather than losing them to
            // replay. The dispatched job's value carries the park.
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
    // Idempotent so an outcome path can stop the beat at the moment it decides
    // (see the retry path) while the `finally` still guarantees it is stopped
    // on every other exit.
    let heartbeatStopped = false;
    const heartbeat = this.startActiveKeyHeartbeat({
      groupId,
      stagedJobId,
      jobDataValues: [jobDataJson, ...drainedSiblings.map((sibling) => sibling.jobDataJson)],
      isCancelled: () => heartbeatStopped,
    });
    const stopHeartbeat = (): void => {
      if (heartbeatStopped) return;
      heartbeatStopped = true;
      clearInterval(heartbeat);
    };
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
        // Which source won `Math.max(jobAttempt, groupAttempt)`. Distinguishes
        // a genuine first delivery from a chain whose counter was lost.
        "queue.attempt_source": attempt === 1 ? "fresh" : jobAttempt >= attempt ? "job" : "group",
      };

      Object.assign(spanAttributes, this.customSpanAttributes(payload));

      const executeWithSpan = async () => {
        await withActiveSpan(
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
              span.setAttribute("organization.id", contextMetadata.organizationId);
            }
            if (contextMetadata?.projectId) {
              span.setAttribute("tenant.id", contextMetadata.projectId);
            }
            if (contextMetadata?.userId) {
              span.setAttribute("user.id", contextMetadata.userId);
            }

            try {
              // Audit hook: onLeased fires once per leased payload (including each
              // drained sibling in a coalesced batch); best-effort, so a PG outage
              // logs and continues. `leasedUntil` is a soft projection of when the
              // retry layer would reschedule a stalled job (now + maxBackoffMs),
              // for stuck-state dashboards.
              const leasedUntil = nowInstant().add({
                milliseconds: JOB_RETRY_CONFIG.maxBackoffMs,
              });
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
              await this.runInContext(contextMetadata, async () => {
                if (batchPayloads && this.processBatch) {
                  span.setAttribute("queue.coalesced_batch_size", batchPayloads.length);
                  await this.processBatchBisecting({
                    entries: batchPayloads.map((batchPayload, index) => ({
                      payload: batchPayload,
                      stagedJobId: batchJobIds[index] ?? stagedJobId,
                    })),
                    attempt,
                    routingLabels,
                    span,
                  });
                } else {
                  await this.process(payload, { attempt });
                }
              });

              // Success — complete the group slot. Drained siblings were
              // removed from staging during the drain, so completing the
              // dispatched job is enough to free the group.
              await this.scripts.complete({ groupId, stagedJobId, jobName });

              // PAST THE POINT OF NO RETURN: the slot is completed, so this needs its own
              // catch — the outer one treats a throw as a FAILED job and would re-stage the
              // drained siblings and retry a job whose slot is already completed,
              // delivering the whole batch a second time.
              try {
                // Recorded BEFORE the lease release: the job is already done, so a Redis
                // blip releasing the lease must not cost the completion counter or the
                // dispatch audit — that would report a completed job as never dispatched,
                // violating "audit lags but never blocks". An unreleased blob just waits
                // for its backstop TTL (the lazy-reclaim design).
                gqJobsCompletedTotal.inc(routingLabels);

                // Audit hook: onDispatched fires once per dispatched payload
                // (dispatched + every drained sibling on success).
                const dispatchedAt = nowInstant();
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

                // A success means the group is draining, so it must not carry a stale failure
                // streak toward the quarantine threshold. Ordered after the counter and audit
                // deliberately: this write can blip without costing that bookkeeping, only the
                // streak reset (bounded by its own TTL).
                if (this.quarantineFailStreakThreshold > 0) {
                  await this.scripts.clearGroupFailures(groupId);
                }

                // The chain is over: anything it recorded is no longer live.
                await this.clearGroupAttempt(groupId);

                await this.blobLifecycle.releaseLease({
                  values: [jobDataJson, ...drainedSiblings.map((sibling) => sibling.jobDataJson)],
                  groupId,
                });
              } catch (cleanupErr) {
                // Worth knowing about — an unreleased blob lingers until its
                // backstop TTL — but never worth re-running the job for.
                this.logger.error(
                  {
                    queueName: this.queueName,
                    groupId,
                    stagedJobId,
                    attempt,
                    err: cleanupErr,
                  },
                  "Post-completion cleanup failed; the job itself completed and is NOT retried",
                );
              }
            } catch (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              const decision = this.failureDecision(err);
              const isRetryable = decision.retryable;

              // The batch stores its fold state only once, at the very end, so a
              // failure means nothing was persisted for the drained siblings.
              // Re-stage them so they are re-dispatched (and re-coalesced) on the
              // dispatched job's retry, rather than lost until an event replay.
              if (drainedSiblings.length > 0) {
                await this.restageDrainedSiblings(groupId, drainedSiblings);
              }

              // Group-quarantine circuit breaker: a producer minting fresh jobs faster than
              // they drain never trips the per-job `maxAttempts` cap (every failure is a new
              // attempt-1 job), so the group could churn forever. Count consecutive
              // retryable failures across the group instead; past the threshold, route
              // through the same exhausted-retry path so an operator can inspect and drain it.
              let quarantined = false;
              let quarantineError: Error | undefined;
              if (isRetryable && this.quarantineFailStreakThreshold > 0) {
                const failStreak = await this.scripts.recordGroupFailure(groupId);
                if (failStreak > this.quarantineFailStreakThreshold) {
                  quarantined = true;
                  // Clear the streak as we park: every ops recovery path resets the poison
                  // guard's claim strikes for a fresh run, so the failure streak must not
                  // outlive the park either, or an unblocked group would re-quarantine on its
                  // very next failure. Best-effort — already on the failure path, so a blip
                  // here must not derail parking the group.
                  await this.scripts.clearGroupFailures(groupId).catch(() => {});
                  // Carried into handleExhaustedRetries as the group's stored error so /ops
                  // shows WHY it was blocked (a run of failures), not just the last job's
                  // error. The handler error rides along as `cause` so the blocked record can
                  // persist the throwing location — the quarantine wrapper's own stack names
                  // nothing an investigator can use.
                  quarantineError = new Error(
                    `Poison guard: group quarantined after ${failStreak} consecutive failures (threshold ${this.quarantineFailStreakThreshold}) with no success. Last error: ${error.message}. Inspect the staged jobs, then unblock the group.`,
                    { cause: error },
                  );
                  gqGroupsPoisonParkedTotal.inc({
                    queue_name: this.queueName,
                    reason: "failure_streak",
                  });
                  this.logger.error(
                    {
                      queueName: this.queueName,
                      projectId: tenantIdFromGroupId(groupId),
                      groupId,
                      stagedJobId,
                      failStreak,
                      threshold: this.quarantineFailStreakThreshold,
                      error,
                    },
                    "Group quarantined after a run of failures with no success; blocking it to protect the shared queue",
                  );
                }
              }

              if (isRetryable && attempt < JOB_RETRY_CONFIG.maxAttempts && !quarantined) {
                // Re-stage with backoff — frees the worker slot immediately
                gqJobsRetriedTotal.inc(routingLabels);

                // Honor the failure classifier's retry delay as a FLOOR over
                // exponential backoff. A caller can lengthen but never shorten
                // the wait, so its policy cannot cause a retry storm.
                const backoffMs = Math.max(getBackoffMs(attempt), decision.retryAfterMs ?? 0);
                gqRetryAttempt.observe(routingLabels, attempt);
                gqRetryBackoffMilliseconds.observe(routingLabels, backoffMs);
                // The job keeps the id it was dispatched under (ADR-080). Its
                // staging member was removed at claim time, so re-staging under
                // the same id inserts one that is genuinely absent.
                const newStagedJobId = stagedJobId;
                // If the retry re-encode fails (blob-store down, payload-too-large from a
                // state-bloat regression), the job is DISCARDED and the old lease retired
                // explicitly — the body was already read, so keeping a liveness claim buys a
                // later worker nothing. Blob bytes remain for lazy reclaim.
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
                    message: "Retry re-encode failed; releasing old lease and discarding job",
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

                // STOP THE HEARTBEAT BEFORE THE RE-STAGE IS ISSUED, not after (ADR-080): a
                // refresh would overwrite the re-stage's backoff TTL, stretching a sub-second
                // backoff into a multi-minute stall. Both ordering (the tick's synchronous
                // EVALSHA beats the re-stage) and cancellation (`runCancellable` withdraws the
                // NOSCRIPT fallback hop) are needed to close that window.
                stopHeartbeat();
                const restaged = await this.scripts.retryRestage({
                  groupId,
                  stagedJobId,
                  newStagedJobId,
                  dispatchAfterMs: nowInstant().epochMilliseconds + backoffMs,
                  jobDataJson: retryJobData,
                  backoffMs,
                  // Written inside the same script as the re-stage: the chain is the only
                  // attempt carrier a re-staged SIBLING has (it comes back with no `__attempt`
                  // and no id marker), so a separate write that failed while this succeeded
                  // would hand the next sibling-led claim a fresh budget.
                  attempt: attempt + 1,
                  attemptTtlSec: GROUP_ATTEMPT_TTL_SECONDS,
                });
                // Only transfer once the replacement is staged: retryRestage returns false
                // when the active key is stale and nothing was written, so transferring
                // anyway would release the live owner's protection for an unreferenced
                // value. A crash in between is survivable — the retry re-encodes to the SAME
                // content hash, so the old lease keeps the blob alive until decode renews.
                if (restaged) {
                  // For GQ2 the retry re-encodes to the SAME content hash, so one
                  // deadline replaces another in the lease set (the blob stays);
                  // A replacement keeps the content hash and transfers its lease.
                  await this.blobLifecycle.transferLease({
                    newValue: retryJobData,
                    oldValue: jobDataJson,
                    groupId,
                  });
                }

                // Audit hook: willRetry=true. Fires for the dispatched
                // payload + every drained sibling (they all get re-staged).
                const nextAttemptAt = nowInstant().add({ milliseconds: backoffMs });
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
                    // The whole Error, not `error.message`: the serializer emits
                    // the stack, and for a handler crash the stack IS the
                    // diagnosis — a bare "undefined is not a function" names no
                    // file and no line, and the queue is the only place that
                    // ever sees the throw.
                    error,
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
                      errorCategory: "non_retryable",
                      error,
                    },
                    "Job failed with non-retryable error, skipping retries",
                  );
                }

                await this.handleExhaustedRetries({
                  groupId,
                  stagedJobId,
                  payload,
                  originalScore,
                  // When the group tripped the quarantine breaker, block it with
                  // the descriptive quarantine error rather than the raw job
                  // error, so /ops shows why the group is blocked.
                  lastError: quarantineError ?? error,
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

      // A job is its own trace, associated with its producer by the span link added
      // in `executeWithSpan` — never by parentage: restoring the producer's span as
      // the parent would make every job a child of whatever enqueued it, and
      // handlers enqueuing further jobs from inside that context would let the same
      // trace id propagate transitively across tenants via the shared queue.
      await otelContext.with(ROOT_CONTEXT, executeWithSpan);
    } finally {
      stopHeartbeat();
      this.activeJobCount--;
      const jobDurationMs = performance.now() - jobStartTime;
      gqJobDurationMilliseconds.observe(routingLabels, jobDurationMs);
      // Feed the ops dashboard latency figures: one write covers both the capped
      // circular buffer behind the live P50/P99 tiles and the time-bucketed
      // histograms behind the hour/day/week/all-time windows. Fire-and-forget so an
      // instrumentation hiccup never bubbles into the worker pipeline.
      const completedAtMs = nowInstant().epochMilliseconds;
      const bucketField = latencyBucketField(jobDurationMs);
      const minuteKey = latencyMinuteBucketKey(this.queueName, completedAtMs);
      const hourKey = latencyHourBucketKey(this.queueName, completedAtMs);
      this.redisConnection
        .multi()
        .lpush(`${this.queueName}:gq:stats:latencies-ms`, String(Math.round(jobDurationMs)))
        .ltrim(`${this.queueName}:gq:stats:latencies-ms`, 0, LATENCY_SAMPLE_SIZE - 1)
        .hincrby(minuteKey, bucketField, 1)
        .expire(minuteKey, LATENCY_MINUTE_BUCKET_TTL_SECONDS)
        .hincrby(hourKey, bucketField, 1)
        .expire(hourKey, LATENCY_HOUR_BUCKET_TTL_SECONDS)
        .hincrby(latencyAllTimeKey(this.queueName), bucketField, 1)
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
   * Parses a drained sibling's stored JSON into a clean payload. Returns null
   * on parse failure — the job is DISCARDED, mirroring the dispatched job's own
   * handling; not "recoverable via replay" (replay never invokes subscribers).
   */
  private async parseDrainedPayload({
    sibling,
    groupId,
  }: {
    sibling: DrainedJob;
    groupId: string;
  }): Promise<{
    payload: Payload;
    queueDispatchScopeKey?: string;
  } | null> {
    try {
      const jobData = await this.blobLifecycle.decode({
        value: sibling.jobDataJson,
        groupId,
      });
      const contextMetadata = jobData.__context as GroupQueueContextMetadata | undefined;
      return {
        payload: this.stripInternalFields(jobData),
        queueDispatchScopeKey: scopeKeyOf(contextMetadata),
      };
    } catch (err) {
      // A transient blob-store error on a sibling MUST NOT drop it to replay: rethrow
      // so the caller (the batch drain's Promise.all) bubbles it up and re-stages
      // every sibling together, matching the dispatched job's own transient-decode
      // handling (ADR-029), rather than silently dropping the whole batch.
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
        // Lease release is non-destructive; bytes remain until lazy reclaim.
        bodyPreserved: !(err instanceof DecodeFailureError ? err.reason === "missing_blob" : false),
      });
      await this.blobLifecycle.releaseLease({
        values: [sibling.jobDataJson],
        groupId,
      });
      return null;
    }
  }

  /**
   * Re-stages siblings drained for a batch that ultimately failed, so they are
   * re-dispatched instead of lost. Best-effort: a re-stage failure is logged,
   * not thrown, so it never masks the original processing error.
   */

  /**
   * Per-group retry-chain counter: a re-staged sibling carries no `__attempt`
   * of its own, so without this it would read as a fresh delivery and the fold
   * would think nothing in the chain had applied yet.
   */
  private groupAttemptKey(groupId: string): string {
    return `${this.queueName}:gq:group:${groupId}:attempt`;
  }

  private async readGroupAttempt(groupId: string): Promise<number> {
    try {
      const raw = await this.redisConnection.get(this.groupAttemptKey(groupId));
      const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch (err) {
      // NOT silent. Returning 0 makes a sibling-led retry resolve to attempt 1,
      // which is indistinguishable from a fresh delivery everywhere downstream:
      // the retry budget restarts, and the fold treats it as fresh and discards
      // its record of what the chain already applied.
      gqGroupAttemptReadFailuresTotal.inc({ queue_name: this.queueName });
      this.logger.warn(
        { queueName: this.queueName, groupId, err },
        "Could not read the group retry-chain counter — a sibling-led retry may read as a fresh delivery and re-apply already-folded events",
      );
      return 0;
    }
  }

  private async clearGroupAttempt(groupId: string): Promise<void> {
    try {
      await this.redisConnection.del(this.groupAttemptKey(groupId));
    } catch {
      // The TTL reclaims it.
    }
  }

  /**
   * Halves a coalesced batch on a retryable failure until it succeeds or
   * narrows to one payload, so a poison payload can't fail (and re-fail) the
   * whole batch. See {@link ../adrs/090-coalesced-batch-bisection.md}.
   */
  private async processBatchBisecting({
    entries,
    attempt,
    routingLabels,
    span,
    isNarrowed = false,
    dispatch = { hasCommitted: false, splits: 0 },
  }: {
    /**
     * Carrying the staged job id is why bisection beats a plain retry: without
     * it a narrowed failure's terminal record would anchor to the DISPATCHED
     * job, the wrong job for a failing drained sibling.
     */
    entries: { payload: Payload; stagedJobId: string }[];
    attempt: number;
    routingLabels: Record<string, string>;
    span: Span;
    /** True in a recursive call — i.e. this batch is the product of a split. */
    isNarrowed?: boolean;
    /** Descent state: see adrs/090-coalesced-batch-bisection.md for the semantics. */
    dispatch?: BisectionDispatchState;
  }): Promise<void> {
    if (!this.processBatch) {
      throw new Error("processBatchBisecting called without a batch handler");
    }

    let failure: { err: unknown } | undefined;
    try {
      await this.processBatch(
        entries.map((entry) => entry.payload),
        { attempt, ...(dispatch.hasCommitted ? { isContinuation: true } : {}) },
      );
    } catch (err) {
      failure = { err };
    }

    // Set on BOTH outcomes, before the split recurses: an earlier call MAY have
    // written even if it threw, so treating it as fresh would let the next
    // sub-batch's commit REPLACE the applied set instead of extending it
    // (#6578). Over-setting the flag is always the safe direction.
    dispatch.hasCommitted = true;

    if (failure) {
      await this.splitFailedBatch({
        entries,
        attempt,
        routingLabels,
        span,
        isNarrowed,
        dispatch,
        err: failure.err,
      });
    }
  }

  /**
   * The failure half of {@link processBatchBisecting}: decides whether this
   * batch can usefully be split, and if so runs both halves in order.
   */
  private async splitFailedBatch({
    entries,
    attempt,
    routingLabels,
    span,
    isNarrowed,
    dispatch,
    err,
  }: {
    entries: { payload: Payload; stagedJobId: string }[];
    attempt: number;
    routingLabels: Record<string, string>;
    span: Span;
    isNarrowed: boolean;
    dispatch: BisectionDispatchState;
    err: unknown;
  }): Promise<void> {
    // Fails the same way at every size, so splitting only multiplies the work
    // before reaching the identical verdict.
    if (!this.failureDecision(err).retryable) {
      throw err;
    }

    if (entries.length <= 1) {
      // Smallest attributable unit — report it, then let the existing retry
      // and quarantine path take over.
      this.reportBisectedIsolate({
        entry: isNarrowed ? entries[0] : undefined,
        attempt,
        span,
        err,
      });
      throw err;
    }

    // Call budget bounds an unbounded descent under the group's heartbeat-renewed
    // active key (see adrs/090-coalesced-batch-bisection.md). Past it, the
    // failure propagates un-split and normal retry/backoff takes over.
    if (dispatch.splits >= this.bisectionSplitBudget) {
      this.logger.warn(
        {
          queueName: this.queueName,
          batchSize: entries.length,
          splits: dispatch.splits,
          attempt,
          error: err instanceof Error ? err : new Error(String(err)),
        },
        "Bisection split budget exhausted; failing the remainder to the normal retry path",
      );
      span.addEvent("queue.batch_bisection_budget_exhausted", {
        "queue.batch_size": entries.length,
        "queue.batch_splits": dispatch.splits,
      });
      throw err;
    }
    dispatch.splits += 1;

    const mid = Math.ceil(entries.length / 2);
    gqBatchBisectionsTotal.inc(routingLabels);
    span.addEvent("queue.batch_bisected", {
      "queue.batch_size": entries.length,
      "queue.batch_split_at": mid,
    });
    this.logger.warn(
      {
        queueName: this.queueName,
        batchSize: entries.length,
        splitAt: mid,
        attempt,
        error: err instanceof Error ? err : new Error(String(err)),
      },
      "Coalesced batch failed; splitting in half and retrying each half in order",
    );

    // Sequential and contiguous — see the ordering note on the caller.
    await this.processBatchBisecting({
      entries: entries.slice(0, mid),
      attempt,
      routingLabels,
      span,
      isNarrowed: true,
      dispatch,
    });
    await this.processBatchBisecting({
      entries: entries.slice(mid),
      attempt,
      routingLabels,
      span,
      isNarrowed: true,
      dispatch,
    });
  }

  /**
   * Names the payload a bisection narrowed to. `entry` is undefined when the
   * failing batch of one was never split — reporting it as an isolate would
   * send an investigator hunting for a bisection that never happened.
   */
  private reportBisectedIsolate({
    entry,
    attempt,
    span,
    err,
  }: {
    entry: { payload: Payload; stagedJobId: string } | undefined;
    attempt: number;
    span: Span;
    err: unknown;
  }): void {
    if (!entry) return;
    this.logger.error(
      {
        queueName: this.queueName,
        offendingStagedJobId: entry.stagedJobId,
        attempt,
        error: err instanceof Error ? err : new Error(String(err)),
      },
      "Coalesced batch narrowed to a single failing payload; this staged job is the offender",
    );
    span.setAttribute("queue.batch_offending_job_id", entry.stagedJobId);
  }

  private async restageDrainedSiblings(groupId: string, siblings: DrainedJob[]): Promise<void> {
    for (const sibling of siblings) {
      try {
        await this.scripts.stage({
          stagedJobId: sibling.stagedJobId,
          groupId,
          // Guarded like every other re-stage. An invalid persisted score such
          // as 0 must heal here instead of being preserved indefinitely.
          dispatchAfterMs: this.restageScore(sibling.originalScore),
          dedupId: "",
          dedupTtlMs: 0,
          jobDataJson: sibling.jobDataJson,
        });
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
   * Publishes this worker's liveness beacon and keeps refreshing it — the poison
   * guard's only evidence of a worker death. Refresh failures are tolerated: the
   * TTL is several refreshes wide so a transient Redis error can't look like death.
   */
  private async startLivenessBeacon(): Promise<void> {
    const publish = async () => {
      try {
        await this.scripts.recordWorkerAlive(this.workerId);
        this.beaconLive = true;
      } catch (err) {
        // Stand the guard down until a refresh lands: claims made without a
        // beacon behind them would be read as deaths by every peer.
        this.beaconLive = false;
        this.logger.warn(
          {
            queueName: this.queueName,
            workerId: this.workerId,
            error: err instanceof Error ? err.message : String(err),
          },
          "Failed to publish worker liveness beacon; the poison guard may read this worker as dead if this persists",
        );
      }
    };

    await publish();

    // close() may have run during that first publish, in which case it found no
    // timer to stop and has already written the tombstone. Arming one now would
    // put a refresh AFTER the retirement — restoring a short-lived `alive` that
    // expires into exactly the false death the tombstone exists to prevent.
    if (this.shutdownRequested) return;

    this.livenessTimer = setInterval(() => {
      void publish();
    }, WORKER_LIVENESS_REFRESH_MS);
    // Never hold the process open for a beacon refresh.
    this.livenessTimer.unref?.();
  }

  /**
   * Starts a periodic heartbeat that refreshes the active key TTL during
   * processing. This prevents the safety-net TTL from expiring when a single
   * job attempt takes longer than activeTtlSec.
   */
  private startActiveKeyHeartbeat({
    groupId,
    stagedJobId,
    jobDataValues,
    isCancelled,
  }: {
    groupId: string;
    stagedJobId: string;
    jobDataValues: string[];
    /** True once the job's outcome is decided; see `stopHeartbeat`. */
    isCancelled: () => boolean;
  }): ReturnType<typeof setInterval> {
    const intervalMs = (GROUP_QUEUE_CONFIG.activeTtlSec * 1000) / 3;
    return setInterval(() => {
      this.scripts
        .refreshActiveKey({
          groupId,
          stagedJobId,
          activeTtlSec: GROUP_QUEUE_CONFIG.activeTtlSec,
          isCancelled,
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
      for (const jobDataValue of jobDataValues) {
        void this.blobLifecycle.renewLease(jobDataValue);
      }
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
    contextMetadata: GroupQueueContextMetadata | undefined;
    routingLabels: Record<string, string>;
  }): Promise<void> {
    // The re-staged job keeps its original ready score so an operator sees it
    // where it belongs in the queue - unless that score is not a usable
    // timestamp, in which case re-staging it would park the group at the epoch
    // for as long as it stays blocked.
    const score = this.restageScore(originalScore);

    // Re-stage under the id the job was dispatched under (ADR-080), so the
    // staged job an operator inspects is named by the id its producer knows.
    const newStagedJobId = stagedJobId;
    const jobDataJson = await this.blobLifecycle.encode({
      jobData: {
        ...(payload as Record<string, unknown>),
        __context: contextMetadata,
      },
      groupId,
    });

    // The quarantine breaker wraps the handler error to explain WHY the group
    // is blocked; the wrapper's stack is queue control flow. The persisted
    // stack must be the handler's — that is the only place the throwing
    // location survives once the job stops retrying.
    const handlerError = lastError?.cause instanceof Error ? lastError.cause : lastError;

    // Atomically: block the group, re-stage the job, update ready score, store error
    await this.scripts.restageAndBlock({
      groupId,
      newStagedJobId,
      score,
      jobDataJson,
      errorMessage: lastError?.message,
      errorStack: handlerError?.stack,
    });

    gqGroupsBlockedTotal.inc(routingLabels);
    gqJobsExhaustedTotal.inc(routingLabels);

    this.logger.error(
      {
        queueName: this.queueName,
        groupId,
        stagedJobId,
        restagedAs: newStagedJobId,
        error: lastError,
        // Explicit rather than relying on the serializer to walk the cause
        // chain: when the quarantine breaker wrapped the handler error, this
        // is the stack that names the throwing line.
        handlerStack: handlerError === lastError ? undefined : handlerError?.stack,
      },
      "Group blocked after exhausted retries, job re-staged",
    );
  }

  /**
   * Give up on a staged job we cannot process (#5538) — not "recoverable via
   * replay" (subscribers are unreachable from replay by construction).
   * `complete()` was chosen deliberately: adrs/091-terminal-drop-completes-the-slot.md.
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
   * Name and count a job we are throwing away, without deciding its slot (not
   * every discard owns one to complete). Every discard path routes through
   * here, so this is the whole truth behind `gq_jobs_dropped_total`.
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
     * Whether the body is still retrievable after this drop. The CALLER states
     * it; this method must not derive it from `reason` (see
     * adrs/091-terminal-drop-completes-the-slot.md for why that was unsafe).
     */
    bodyPreserved: boolean;
  }): void {
    const { pipelineName, jobType, jobName } = readJobRoutingMeta(jobDataJson);
    const descriptor = readEnvelopeDescriptor(jobDataJson);

    recordDroppedJob({
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
        // Redacted text, not the raw Error: drop errors can quote storage
        // URIs, and the stack's first line repeats the message — so both go
        // through the same redaction.
        err: redactStorageUrisInText(err instanceof Error ? err.message : String(err)),
        errStack:
          err instanceof Error && err.stack ? redactStorageUrisInText(err.stack) : undefined,
      },
      message,
    );
  }

  /**
   * Claim-side poison park (specs/poison-group-park-guard.feature): re-stages
   * the SAME staged value under the SAME lease identity (no decode/re-encode)
   * and moves the group to the blocked set; operators recover via unblock/drain.
   */
  private async parkPoisonGroup({
    groupId,
    stagedJobId,
    jobDataJson,
    originalScore,
    reason,
    errorMessage,
    lastOwnerState,
  }: {
    groupId: string;
    stagedJobId: string;
    jobDataJson: string;
    originalScore: number;
    reason: "claim_strikes" | "oversized_payload";
    errorMessage: string;
    /**
     * What the parking claim found the previous owner to be — the field that
     * tells a crash-loop apart from a Redis outage that expired healthy beacons
     * (both park with the same count/message). Absent for oversized-payload parks.
     */
    lastOwnerState?: string;
  }): Promise<void> {
    // Same reasoning as handleExhaustedRetries: keep the original score when it
    // is a real timestamp, otherwise the parked group reads as decades old.
    const score = this.restageScore(originalScore);
    await this.scripts.restageAndBlock({
      groupId,
      // Parked under the id it was dispatched under (ADR-080). This used to
      // append a wall-clock marker, which made a parked job impossible to find
      // by the id its producer knows and grew the value on every park.
      newStagedJobId: stagedJobId,
      score,
      jobDataJson,
      errorMessage,
    });
    // Release the marker as the group is parked: leaving it would let the death
    // count survive, so an operator who unblocked inside the marker's TTL would
    // see it re-park on the very next claim. Unconditional here, unlike the
    // healthy-path release, since the group is leaving the dispatch path.
    await this.scripts.discardClaim(groupId).catch(() => {
      // The marker's TTL bounds a failed clear; unblock clears it outright.
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
        // "gone" on every death is the crash-loop signature. A park whose
        // observations were mostly "alive"/"retired" points at beacon weather
        // (a Redis outage expiring healthy beacons), not at this group.
        lastOwnerState,
      },
      "Poison guard parked group into the blocked set",
    );
  }

  /**
   * A transient blob-store failure means the body is unreachable, not gone: re-stage
   * the SAME envelope (unchanged lease identity) with the higher of the envelope and
   * group attempt counts, since this path can't read the body to trust it (ADR-080).
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
    const attempt =
      Math.max(readJobAttempt(jobDataJson) ?? 0, await this.readGroupAttempt(groupId)) + 1;
    if (attempt >= JOB_RETRY_CONFIG.maxAttempts) {
      // The retry ladder is out of rungs — a discard like any other, not
      // recoverable via replay (#5538). Reaching here means every read failed
      // (~2h27m of sustained unreachability), which says the STORE is down, not
      // that the blob is gone — so the drop keeps the shared bytes for lazy
      // reclaim while retiring this job's lease.
      await this.dropStagedJob({
        groupId,
        stagedJobId,
        jobDataJson,
        err,
        reason: "transient_exhausted",
        message: `Blob store unreachable after ${attempt} attempts; discarding job (replay does not recover subscriber jobs)`,
      });
      return;
    }
    const backoffMs = getBackoffMs(attempt);
    // Advance BOTH carriers. The header rewrite reuses the body string byte for
    // byte, so the content hash and the lease identity are untouched — a value
    // whose machinery does not live in the header comes back unchanged, and the
    // chain below is then the only thing keeping the ladder finite.
    const restaged = await this.scripts.retryRestage({
      groupId,
      stagedJobId,
      newStagedJobId: stagedJobId,
      dispatchAfterMs: nowInstant().epochMilliseconds + backoffMs,
      jobDataJson: withJobAttempt({ value: jobDataJson, attempt }),
      backoffMs,
      attempt,
      attemptTtlSec: GROUP_ATTEMPT_TTL_SECONDS,
    });
    // The script writes the chain in the same step, so a value whose machinery
    // does not live in the header still advances — that write is what keeps
    // this ladder finite. It returns false only when another worker owns the
    // slot, in which case nothing was written and this job is no longer ours.
    if (!restaged) return;
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
   * Generates a unique staged job ID, incorporating routing metadata
   * (`__jobType`/`__jobName`) when present so different job types processing
   * the same event don't overwrite each other's staged entry.
   */
  private generateStagedJobId(payload: Payload): string {
    const p = payload as Record<string, unknown>;
    // Every field here is `unknown`: a cast would only silence the compiler, so
    // each part is CHECKED (an object or number would stringify into a malformed
    // Redis key) and anything not a usable string is treated as absent. The
    // fallback is a KSUID, k-sortable like every other id, to match Redis key
    // ordering.
    const baseId = nonEmptyString(this.identify(payload)) ?? randomUUID();
    const jobType = nonEmptyString(p.__jobType);
    const jobName = nonEmptyString(p.__jobName);
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
      // Transient reconnect events are EXPECTED (ioredis retries with
      // maxRetriesPerRequest: null, emitting `error` → `close` → `reconnecting`
      // before a possible `ready`). Rejecting on `error`/`close` would turn a
      // recoverable Redis blip into a pipeline-startup failure, so only the
      // terminal `end` event fails readiness; `error` just logs and waits.
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

  private async registerPreflightGroup(groupId: string): Promise<void> {
    const key = scopeKeyOf(this.captureContext()) ?? this.dispatchGroupAllowListKey;
    if (!key) return;
    await this.registerPreflightGroups(() => [groupId]);
  }

  async registerPreflightGroups(
    resolveGroupIds: () => readonly (string | undefined)[],
  ): Promise<void> {
    const key = scopeKeyOf(this.captureContext()) ?? this.dispatchGroupAllowListKey;
    if (!key) return;
    const groupIds = resolveGroupIds();
    const unresolved = groupIds.find(
      (groupId) => groupId === "__unknown__" || groupId === "__legacy_outbox__",
    );
    if (unresolved) {
      throw new GroupQueueError(
        this.queueName,
        "registerPreflightGroups",
        `Migration preflight refused unresolved group ${unresolved}`,
      );
    }
    if (groupIds.some((groupId) => !groupId)) {
      throw new GroupQueueError(
        this.queueName,
        "registerPreflightGroups",
        "Migration preflight refused a pipeline with custom group routing",
      );
    }
    if (!key.startsWith(`${this.queueName}:gq:`)) {
      throw new GroupQueueError(
        this.queueName,
        "registerPreflightGroups",
        "Migration preflight refused a dispatch scope outside the canonical queue slot",
      );
    }
    await this.scripts.registerPreflightTargets({
      targetKey: key,
      groupIds: groupIds as readonly string[],
    });
  }

  private async activatePreflightGroup(groupId: string): Promise<void> {
    const key = scopeKeyOf(this.captureContext()) ?? this.dispatchGroupAllowListKey;
    if (!key) return;
    await this.registerPreflightGroups(() => [groupId]);
  }

  async waitUntilPreflightIdle(): Promise<void> {
    const key = this.dispatchGroupAllowListKey;
    if (!key) {
      throw new GroupQueueError(
        this.queueName,
        "waitUntilPreflightIdle",
        "Queue has no preflight allow-list",
      );
    }
    const deadline = nowInstant().epochMilliseconds + this.preflightDrainTimeoutMs;
    while (true) {
      const state = await this.scripts.inspectPreflightTargets(key);
      const settled = state.pending === 0 && state.active === 0;
      if (settled) this.assertPreflightTargetsSucceeded(state);
      if (settled && this.processingQueue.idle()) return;
      if (nowInstant().epochMilliseconds >= deadline) return this.settlePastDrainTimeout(state);
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Work that never drained leaves its tenants held for a later pass, so the
   * barrier starts past it; work that FAILED still refuses, because no later
   * pass clears a fault. specs/migration/system-migrations-runner.feature.
   */
  private settlePastDrainTimeout(state: {
    pending: number;
    active: number;
    failed: number;
    blocked: number;
    groups: number;
  }): void {
    this.assertPreflightTargetsSucceeded(state);
    this.logger.warn(
      {
        queueName: this.queueName,
        pending: state.pending,
        active: state.active,
        groups: state.groups,
        timeoutMs: this.preflightDrainTimeoutMs,
      },
      "Migration preflight stopped waiting for work that had not drained and is starting anyway; the tenants it covers stay held for a later pass, and these counts are for operator triage",
    );
  }

  private assertPreflightTargetsSucceeded(state: { failed: number; blocked: number }): void {
    if (state.failed === 0 && state.blocked === 0) return;
    throw new GroupQueueError(
      this.queueName,
      "waitUntilPreflightIdle",
      `Preflight queue has ${state.failed} failed and ${state.blocked} blocked target groups`,
    );
  }

  async close(): Promise<void> {
    this.shutdownRequested = true;
    this.metricsCollector?.stop();
    this.dispatcher?.requestShutdown();
    // Wake the BRPOP so the dispatcher exits immediately
    await this.redisConnection.lpush(this.scripts.getSignalKey(), "1").catch(() => {
      // best-effort wake; a failed signal only delays dispatcher exit
    });

    // A planned shutdown is not a worker death (poison-group-park-guard spec):
    // one tombstone covers every claim this worker holds, however the drain
    // ends. Stop the beacon FIRST — a refresh landing after the tombstone would
    // restore a short-lived `alive` that then expires into a false death.
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = undefined;
    }
    if (this.consumerEnabled) {
      try {
        await this.scripts.retireWorker(this.workerId);
      } catch (err) {
        this.logger.warn(
          {
            queueName: this.queueName,
            workerId: this.workerId,
            error: err instanceof Error ? err.message : String(err),
          },
          "Failed to record worker retirement; groups this worker held may book a spurious death",
        );
      }
    }

    this.logger.debug({ queueName: this.queueName }, "Closing group queue processor");

    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.drainAndDisconnect(),
        new Promise<never>((_, reject) => {
          shutdownTimer = setTimeout(
            () =>
              reject(
                new GroupQueueError(
                  this.queueName,
                  "close",
                  `Shutdown timed out after ${this.shutdownTimeoutMs}ms`,
                ),
              ),
            this.shutdownTimeoutMs,
          );
        }),
      ]);

      this.logger.debug({ queueName: this.queueName }, "Group queue processor closed successfully");
    } catch (error) {
      this.logger.warn(
        {
          queueName: this.queueName,
          error,
          queueIdle: this.processingQueue.idle(),
          dispatcherActive: this.dispatcher != null,
        },
        "Error closing group queue processor",
      );
      throw error;
    } finally {
      clearTimeout(shutdownTimer);
      // Here, not at the top of close(): until this point the drain was still
      // running jobs whose fan-out has to be allowed to stage. Past it the
      // shared transports are about to go, so staging more is pointless. The
      // timeout path lands here too — a drain that overran was abandoned, not
      // finished, and either way nothing further should be staged.
      this.stagingClosed = true;
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
      this.logger.debug({ queueName: this.queueName }, "Blocking connection closed");
    }
  }
}

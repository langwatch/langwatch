// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { performance } from "node:perf_hooks";
// Imported rather than read off the global: the constructor destructures a
// `process` handler out of the queue definition, and a class field initializer
// runs inside that same scope — so a bare `process.pid` here resolves to the
// handler's binding and dies in its temporal dead zone.
import { pid } from "node:process";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  context as otelContext,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  TraceFlags,
  trace,
} from "@opentelemetry/api";
import fastq from "fastq";
import { Cluster, Redis as IORedis } from "ioredis";
import { getLangWatchTracer } from "langwatch";
import type { SemConvAttributes } from "langwatch/observability";
import { isDispatchError } from "~/server/event-sourcing/queues/dispatchError";
import { SHUTDOWN_BUDGET } from "~/server/shutdown/budget";
import {
  LATENCY_HOUR_BUCKET_TTL_SECONDS,
  LATENCY_MINUTE_BUCKET_TTL_SECONDS,
  LATENCY_SAMPLE_SIZE,
  latencyAllTimeKey,
  latencyBucketField,
  latencyHourBucketKey,
  latencyMinuteBucketKey,
} from "~/shared/ops/latency";
import { KSUID_RESOURCES } from "~/utils/constants";
import { tryGetApp } from "../../../app-layer/app";
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
import {
  type ProjectStorageDestination,
  redactStorageUrisInText,
} from "../../../stored-objects/project-storage-destination";
import type {
  DeduplicationConfig,
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
  JobDelivery,
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
  PayloadTooLargeError,
  readEnvelopeDescriptor,
  readJobAttempt,
  readJobPayloadBytes,
  readJobRoutingMeta,
  withJobAttempt,
} from "./jobEnvelope";
import { legacyStagedJobAttempt } from "./legacyStagedJobAttempt";
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
  gqJobsDroppedTotal,
  gqJobsExhaustedTotal,
  gqJobsNonRetryableTotal,
  gqJobsRetriedTotal,
  gqJobsStagedTotal,
  gqReadyScoreImplausibleTotal,
  gqRetryAttempt,
  gqRetryBackoffMilliseconds,
  gqRetryEncodeFailuresTotal,
} from "./metrics";
import { GroupQueueMetricsCollector } from "./metricsCollector";
import {
  fallbackReadyScore,
  isPlausibleReadyScore,
  resolveReadyScore,
} from "./readyScore";
import {
  type DispatchResult,
  type DrainedJob,
  GroupStagingScripts,
  readBisectionSplitBudget,
  readConfirmedDeathThreshold,
  readGroupQuarantineThreshold,
  WORKER_LIVENESS_REFRESH_MS,
} from "./scripts";
import { type ObjectStore, TransientBlobStoreError } from "./tieredBlobStore";

/** Mutable state shared across one dispatch's bisection descent. */
interface BisectionDispatchState {
  /** True once any sub-batch of this dispatch committed successfully. */
  hasCommitted: boolean;
  /** Splits performed so far — compared against the budget above. */
  splits: number;
}

/**
 * How long the group's retry-chain counter survives without a refresh.
 *
 * It is re-set on every retry, so it only has to outlive ONE backoff — but it
 * MUST outlive the longest one. Derived from the retry config rather than
 * picked: a fixed 600s is exactly `maxBackoffMs`, so from roughly attempt 12
 * the counter would expire during the wait, the retry would read as a fresh
 * delivery, and the fold would re-apply the batch it had already folded.
 * Pinned by retryChainInvariants.unit.test.ts.
 */
export const GROUP_ATTEMPT_TTL_SECONDS = Math.ceil(
  (JOB_RETRY_CONFIG.maxBackoffMs / 1000) * 3,
);

/**
 * A field off an untrusted payload, when it is actually a usable string.
 *
 * The queue's payloads are `Record<string, unknown>` by design — it routes for
 * every pipeline and does not know their shapes — so the machinery fields it
 * DOES read have to be checked rather than asserted. Anything that is not a
 * non-empty string reads as absent.
 */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Configuration for the group queue.
 *
 * Exported because `activeTtlSec` and the heartbeat interval derived from it
 * set the floor on how soon a dead worker's group is redispatched, and the
 * poison guard's beacon TTL has to stay under that floor to be able to observe
 * the death at all. The two constants live in different modules, so the
 * inequality between them is pinned by a test rather than by proximity.
 */
export const GROUP_QUEUE_CONFIG = {
  /** Default global concurrency (max parallel groups) */
  defaultGlobalConcurrency: Number(process.env.GLOBAL_QUEUE_CONCURRENCY) || 100,
  /** TTL for the active key (safety net for crashes), in seconds */
  activeTtlSec: 300,
  /** BRPOP timeout in seconds (fallback polling interval) */
  signalTimeoutSec: 5,
  /** Interval for collecting queue metrics in milliseconds */
  metricsIntervalMs: 15000,
  /**
   * Maximum time to wait for graceful shutdown in milliseconds.
   *
   * The innermost of the four nested shutdown clocks — see
   * server/shutdown/budget.ts, which derives App.close's backstop, the
   * entrypoint watchdog and the required terminationGracePeriodSeconds from
   * this one number. Do not hardcode a value here: an increase that the outer
   * clocks do not hear about is an increase the pod never gets to use.
   */
  shutdownTimeoutMs: SHUTDOWN_BUDGET.queueDrainMs,
} as const;

/** Default TTL for deduplication in milliseconds */
const DEFAULT_DEDUPLICATION_TTL_MS = 200;

/**
 * Default byte budget for a coalesced batch when a queue enables coalescing but
 * supplies no `coalesceMaxBytes` resolver (ADR-066 pillar 2).
 *
 * 4 MiB keeps a coalesced multi-row append inside the ClickHouse async-insert
 * flush budget, so producer-side coalescing collapses many tiny appends into one
 * insert without ever assembling an insert large enough to stall the flush. It
 * is generous enough that the fold/map batches that predate ADR-066 stay bounded
 * by their count limit (`coalesceMaxBatch`) in practice, so their behaviour is
 * unchanged — the byte bound only ever binds first for a genuinely large burst.
 */
export const DEFAULT_COALESCE_MAX_BYTES = 4 * 1024 * 1024;

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

/** Resolve retry delay with a receiver Retry-After as a floor, never a cap. */
export function retryBackoffMsFor({
  attempt,
  error,
}: {
  attempt: number;
  error: unknown;
}): number {
  const retryAfterMs = isDispatchError(error) ? error.retryAfterMs : undefined;
  return Math.max(getBackoffMs(attempt), retryAfterMs ?? 0);
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
  private readonly process: (
    payload: Payload,
    delivery?: JobDelivery,
  ) => Promise<void>;
  private readonly processBatch?: (
    payloads: Payload[],
    delivery?: JobDelivery,
  ) => Promise<void>;
  private readonly coalesceMaxBatch?: (payload: Payload) => number | undefined;
  private readonly coalesceMaxBytes?: (payload: Payload) => number | undefined;
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
  /**
   * Consecutive-failure count that quarantines (blocks) a group. Read once at
   * construction; 0 disables the breaker. See {@link readGroupQuarantineThreshold}.
   */
  private readonly quarantineFailStreakThreshold =
    readGroupQuarantineThreshold();

  /**
   * Splits allowed per dispatch before bisection yields to retry/backoff. Read
   * once at construction; 0 disables bisection outright, which restores the
   * pre-bisection behaviour without a deploy. See
   * {@link readBisectionSplitBudget}.
   */
  private readonly bisectionSplitBudget = readBisectionSplitBudget();

  /**
   * Confirmed worker deaths tolerated before a group is parked. Read once at
   * construction, like the two thresholds above; 0 disables the poison guard.
   * See {@link readConfirmedDeathThreshold}.
   */
  private readonly deathThreshold = readConfirmedDeathThreshold();

  private shutdownRequested = false;
  /**
   * Whether `send`/`sendBatch` may still stage work.
   *
   * NOT the same thing as `shutdownRequested`, and the difference is the whole
   * point. Shutdown is requested at the START of close(), while the drain that
   * follows is still running jobs — and those jobs store events and dispatch
   * them onward, into this same queue, because the projection, subscriber, map
   * and fold queues are all facades over it. Gating sends on
   * `shutdownRequested` meant the queue refused the work its own drain was
   * producing, and nothing above retried it: every rollout quietly dropped a
   * burst of projection dispatches (prod, 2026-08-24).
   *
   * Accepting them is safe. `send` stages into Redis over `redisConnection`,
   * which the drain leaves alone — only the blocking connection is closed here,
   * and the shared connections go afterwards, in App.close. Staged work is
   * durable and shared, so anything staged during a drain is picked up by
   * another pod rather than lost with this one.
   *
   * So the gate closes when the drain is over, however it ended.
   */
  private stagingClosed = false;
  /** Tracks in-flight jobs for active count metrics. */
  private activeJobCount = 0;

  /**
   * Identity this process stamps onto every claim it takes, and the subject of
   * the liveness beacon the poison guard reads. Unique per process INSTANCE —
   * a restarted pod must never inherit the identity of the one it replaced, or
   * its predecessor's death would resolve to "that's me, still running".
   */
  private readonly workerId =
    `${hostname()}-${pid}-${randomUUID().slice(0, 8)}`;

  /** Beacon refresh timer; stopped before the retirement write in {@link close}. */
  private livenessTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * Whether this worker's beacon is known to have reached Redis.
   *
   * The guard reads a missing beacon as a death, so a worker that stamps claim
   * markers it cannot vouch for hands every peer a false death — the exact
   * failure this design removes, re-entered through the beacon write instead of
   * the release. While the beacon is unconfirmed the guard sits out entirely:
   * a real death then goes uncounted, which is the cheap direction to be wrong
   * in. Parking a healthy group is the expensive one.
   */
  private beaconLive = false;

  /**
   * Resolves once this worker's beacon exists in Redis. Claims await it, so a
   * worker can never own a claim marker before the beacon that vouches for it —
   * the window in between is exactly the one where a peer would misread this
   * live process as a dead one.
   */
  private readonly livenessReady: Promise<void>;

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
      coalesceMaxBytes,
      options: defOptions,
      delay,
      spanAttributes,
      deduplication,
      groupKey,
      score,
      auditAdapter,
    } = definition;

    // `tryGetApp`, not `getApp`: this is a constructor, and EventSourcing
    // builds queues while the composition root is still assembling — so an App
    // may legitimately not exist yet. The caller that matters always passes a
    // connection; falling through to the ConfigurationError below states the
    // real problem, where `getApp()` would raise a boot-order error instead.
    const effectiveConnection = redisConnection ?? tryGetApp()?.redis ?? null;
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
    this.coalesceMaxBytes = coalesceMaxBytes;
    this.auditAdapter = auditAdapter;
    this.globalConcurrency =
      defOptions?.globalConcurrency ??
      GROUP_QUEUE_CONFIG.defaultGlobalConcurrency;

    // Initialize Lua scripts wrapper
    this.scripts = new GroupStagingScripts(
      this.redisConnection,
      this.queueName,
    );

    // The GQ2 content-addressed blob lifecycle — tiered store and the
    // encode/decode/renew/release seams. Staging Lua acquires the leases.
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

    // fastq promise-based queue: bounds concurrency on this node
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

    // Publish the liveness beacon before anything can claim. A consumer that
    // never claims still needs no beacon, so producers skip it entirely.
    this.livenessReady = this.consumerEnabled
      ? this.startLivenessBeacon()
      : Promise.resolve();

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
   * Resolves a ready score and reports what it had to refuse.
   *
   * Every path that writes a ready score goes through here, so the counter is
   * raised at the one moment the information exists. Counting it later, by
   * scanning the ready set for out-of-range scores, cannot work: by then the
   * bad value has already been replaced by this function and the scan finds
   * nothing while the broken producer carries on.
   *
   * `delay` is deliberately NOT part of this. Deferral is a queue decision
   * added to the resolved score by the caller; only the producer's own claim
   * about when the work occurred is judged here.
   */
  private resolveScore(rawScore: unknown, nowMs: number = Date.now()): number {
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
   * Ready score for a job the queue is putting BACK - an exhausted retry, a
   * poison park, a drained sibling after a failed batch.
   *
   * Only the absolute check applies, not the two-sided one. The score was
   * already judged against the producer's clock when the job was first staged,
   * and re-judging it against a later clock would rewrite a legitimately old
   * job (a long retry chain, a batch exported a day late) for no reason. What
   * is still worth catching is a value that is not a timestamp at all, i.e. a
   * row staged before this guard existed.
   *
   * All three re-stage paths share this so they cannot disagree. They used to:
   * the exhausted-retry path re-scored an unusable value while drained siblings
   * kept theirs verbatim, so one failure could move the failed job to now and
   * leave its siblings at 0 - and on unblock the siblings dispatched ahead of
   * the job they were drained behind.
   *
   * Deliberately does NOT raise `gq_ready_score_implausible_total`, which
   * counts producers, not us. `originalScore` is always a value this queue
   * wrote and then read back out of Redis, and staging already required it to
   * clear MIN_PLAUSIBLE_EPOCH_MS - an ABSOLUTE floor, so a score that cleared
   * it once clears it for ever. This check can therefore only ever fire for a
   * row staged before the guard existed, or one corrupted in Redis. Neither is
   * a broken score function, and counting them here would dilute the one
   * signal that is with our own bookkeeping.
   */
  private restageScore(originalScore: unknown): number {
    return isPlausibleReadyScore(originalScore)
      ? originalScore
      : fallbackReadyScore();
  }

  /**
   * Stages a job into the group queue's Redis staging layer.
   */
  async send(
    payload: Payload,
    options?: QueueSendOptions<Payload>,
  ): Promise<void> {
    if (this.stagingClosed) {
      throw new QueueError(
        this.queueName,
        "send",
        "Cannot send to queue after its drain has finished",
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

  async sendBatch(
    payloads: Payload[],
    options?: QueueSendOptions<Payload>,
  ): Promise<void> {
    if (this.stagingClosed) {
      throw new QueueError(
        this.queueName,
        "sendBatch",
        "Cannot send to queue after its drain has finished",
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

    const { newStagedCount } = await this.scripts.stageBatch(jobsToStage);

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
   * The guard stamps this worker's identity onto the group's claim BEFORE any
   * decode/parse work, and releases it on every path where the process survives
   * (the finally below — success, retry, exhausted-park, drop-to-replay and
   * graceful drain all pass through it). A job that seizes the event loop never
   * reaches the finally: the liveness probe kills the process, its beacon stops,
   * and the next worker to claim the group finds a marker whose owner is
   * provably gone. Enough confirmed deaths and the claim parks the group instead
   * of re-running the killer (specs/event-sourcing/poison-group-park-guard.feature).
   *
   * Nothing here has to special-case shutdown. A claim held by a process that
   * exits gracefully resolves through that process's retirement tombstone, and
   * a release that never reaches Redis resolves through its still-live beacon —
   * so neither needs the strike to be withheld, swept, or re-checked the way the
   * count-and-subtract guard did.
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
        this.scripts
          .releaseClaim({ groupId, workerId: this.workerId })
          .catch(() => {
            // Safe to lose: the marker it would have removed still names this
            // worker, which is alive (and will retire rather than vanish), so
            // the next claim reads it as ordinary rather than as a death.
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
    const jobAttempt =
      typeof jobData.__attempt === "number" ? jobData.__attempt : 1;
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

    // Opt-in batch coalescing: if this job type supports it, drain additional
    // already-staged DUE jobs from the same group and fold them alongside the
    // dispatched one in a single handler call. The group's active key (held by
    // this job) guarantees no other worker dequeues from the group meanwhile,
    // so the drain is exclusive. Drained siblings are re-staged on failure so
    // they are not lost. When disabled (maxBatch <= 1) this is a no-op and the
    // per-job path below is unchanged.
    const maxBatch = this.coalesceMaxBatch?.(payload) ?? 1;
    let batchPayloads: Payload[] | null = null;
    // Staged-job id per batch member, index-aligned with batchPayloads, so a
    // bisected failure can name the payload it narrowed to.
    let batchJobIds: string[] = [];
    let drainedSiblings: DrainedJob[] = [];
    if (maxBatch > 1 && this.processBatch) {
      // Byte bound (ADR-066 pillar 2): the drain also stops before a job that
      // would push the batch past maxBytes, counting the dispatched job's own
      // payload size as the starting point. Whichever of the count/byte bound
      // binds first wins; an oversized dispatched job (initialBytes already at
      // or over the budget) drains no siblings and processes on its own.
      //
      // Payload size, not `jobDataJson.length`: an offloaded body leaves a small
      // reference in the stored value, so measuring the value would let 256
      // megabyte-sized records through a 4 MiB budget untouched.
      const maxBytes =
        this.coalesceMaxBytes?.(payload) ?? DEFAULT_COALESCE_MAX_BYTES;
      const initialBytes = readJobPayloadBytes(jobDataJson);
      try {
        drainedSiblings = await this.scripts.drainGroupReady({
          groupId,
          nowMs: Date.now(),
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
      // Mixed-command groups (ADR-066 pillar 2): with `serializeByAggregate` the
      // group key namespace is shared across command types, so a drained sibling
      // can belong to a DIFFERENT job than the dispatched one. Fold/map groups
      // are single-`__jobName` by construction, so for them this is a no-op. Only
      // coalesce siblings whose `__jobName` matches the dispatched job's; restage
      // the rest untouched (via the same path a failed batch uses) so they run as
      // their own dispatches — a payload is never handed to another job's handler.
      //
      // Read the dispatched job's name the SAME way as each sibling
      // (`readJobRoutingMeta`, null when absent), so a queue that sets no
      // `__jobName` at all (every job null) still matches and coalesces — rather
      // than the `jobName` local, which defaults absent to "unknown" and would
      // mismatch a sibling's null.
      if (drainedSiblings.length > 0) {
        const dispatchedJobName = readJobRoutingMeta(jobDataJson).jobName;
        const matchingSiblings: DrainedJob[] = [];
        const foreignSiblings: DrainedJob[] = [];
        for (const sibling of drainedSiblings) {
          const siblingJobName = readJobRoutingMeta(
            sibling.jobDataJson,
          ).jobName;
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
            drainedSiblings.map((sibling) =>
              this.parseDrainedPayload({ sibling, groupId }),
            ),
          );
          const liveSiblings = drainedSiblings.filter(
            (_, index) => parsedSiblings[index] !== null,
          );
          const siblingPayloads = parsedSiblings.filter(
            (parsed) => parsed !== null,
          ) as Payload[];
          drainedSiblings = liveSiblings;
          if (siblingPayloads.length > 0) {
            batchPayloads = [payload, ...siblingPayloads];
            batchJobIds = [
              stagedJobId,
              ...liveSiblings.map((sibling) => sibling.stagedJobId),
            ];
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
    // Idempotent so an outcome path can stop the beat at the moment it decides
    // (see the retry path) while the `finally` still guarantees it is stopped
    // on every other exit.
    let heartbeatStopped = false;
    const heartbeat = this.startActiveKeyHeartbeat({
      groupId,
      stagedJobId,
      jobDataValues: [
        jobDataJson,
        ...drainedSiblings.map((sibling) => sibling.jobDataJson),
      ],
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
        "queue.attempt_source":
          attempt === 1 ? "fresh" : jobAttempt >= attempt ? "job" : "group",
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

              // PAST THE POINT OF NO RETURN. The slot is completed, so the job
              // is done whatever happens next — everything below is cleanup and
              // bookkeeping. It gets its own catch because the outer one treats
              // a throw as a FAILED job: it re-stages the drained siblings and
              // schedules a retry of a job whose slot has already been
              // completed, delivering the whole batch a second time. A blob
              // release failing on a brief S3 blip was enough to trigger it.
              try {
                // Recorded BEFORE the lease release, and the order matters: the
                // job is already done, so a Redis blip releasing the lease must
                // not cost us the completion counter or the dispatch audit —
                // that would leave the audit projection reporting a completed
                // job as never dispatched, the exact opposite of the "audit lags
                // but never blocks" property. An unreleased blob just waits for
                // its backstop TTL, which is the lazy-reclaim design anyway.
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

                // A success means the group is draining, so it must not carry a
                // stale failure streak toward the quarantine threshold. Ordered
                // after the counter and the audit deliberately: this is a Redis
                // write on a job that is already done, so a blip here must cost
                // the streak reset (bounded by its TTL) rather than the
                // bookkeeping above.
                if (this.quarantineFailStreakThreshold > 0) {
                  await this.scripts.clearGroupFailures(groupId);
                }

                // The chain is over: anything it recorded is no longer live.
                await this.clearGroupAttempt(groupId);

                await this.blobLifecycle.releaseLease({
                  values: [
                    jobDataJson,
                    ...drainedSiblings.map((sibling) => sibling.jobDataJson),
                  ],
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
              const category = categorizeError(err);
              const isRetryable = isRetryableJobError(err);

              // The batch stores its fold state only once, at the very end, so a
              // failure means nothing was persisted for the drained siblings.
              // Re-stage them so they are re-dispatched (and re-coalesced) on the
              // dispatched job's retry, rather than lost until an event replay.
              if (drainedSiblings.length > 0) {
                await this.restageDrainedSiblings(groupId, drainedSiblings);
              }

              // Group-quarantine circuit breaker (prod incident 2026-07-20). A
              // producer that mints fresh jobs for ONE group faster than they
              // drain never trips the per-JOB `maxAttempts` cap — every failure
              // is a new attempt-1 job — so the group churns indefinitely and can
              // starve the shared queue. Count consecutive retryable failures
              // across the group's jobs (cleared on any success); once the streak
              // crosses the threshold, route this job through the SAME
              // exhausted-retry path that blocks the group, so it stops
              // dispatching and an operator can inspect + drain it.
              let quarantined = false;
              let quarantineError: Error | undefined;
              if (isRetryable && this.quarantineFailStreakThreshold > 0) {
                const failStreak =
                  await this.scripts.recordGroupFailure(groupId);
                if (failStreak > this.quarantineFailStreakThreshold) {
                  quarantined = true;
                  // Clear the streak as we park. Every ops recovery path
                  // (unblock / drain / dead-letter) resets the poison guard's
                  // claim strikes so a recovered group gets a FRESH run; the
                  // failure streak must not outlive the park either, or an
                  // operator who unblocks would see the group re-quarantine on
                  // its very next failure instead of getting that fresh run.
                  // Best-effort: we are already on the failure path, so a blip
                  // clearing it must not derail parking the group.
                  await this.scripts
                    .clearGroupFailures(groupId)
                    .catch(() => {});
                  // Carried into handleExhaustedRetries as the group's stored
                  // error so /ops shows WHY it was blocked (a run of failures),
                  // not just the last job's error.
                  // The handler error rides along as `cause` so the blocked
                  // record can persist the throwing location — the quarantine
                  // wrapper's own stack starts in queue control flow and names
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

              if (
                isRetryable &&
                attempt < JOB_RETRY_CONFIG.maxAttempts &&
                !quarantined
              ) {
                // Re-stage with backoff — frees the worker slot immediately
                gqJobsRetriedTotal.inc(routingLabels);

                // Honor a receiver's Retry-After (ADR-040 §5) as a FLOOR over
                // the exponential backoff: a DispatchError may carry a
                // retryAfterMs hint, which can lengthen but never shorten the
                // wait (so it can't cause a retry storm).
                const backoffMs = retryBackoffMsFor({ attempt, error: err });
                gqRetryAttempt.observe(routingLabels, attempt);
                gqRetryBackoffMilliseconds.observe(routingLabels, backoffMs);
                // The job keeps the id it was dispatched under (ADR-080). Its
                // staging member was removed at claim time, so re-staging under
                // the same id inserts one that is genuinely absent.
                const newStagedJobId = stagedJobId;
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

                // STOP THE HEARTBEAT BEFORE THE RE-STAGE IS ISSUED, not after
                // it returns (ADR-080).
                //
                // The re-stage sets the active key's TTL to the backoff window;
                // a heartbeat REFRESH sets it to the full activeTtlSec and
                // pushes the group's ready score out to match, which would
                // stretch a sub-second backoff into a multi-minute stall.
                //
                // Two things close that window, and BOTH are needed:
                //
                //  - Ordering. A tick issues its EVALSHA synchronously, so any
                //    beat already in flight was sent AHEAD of the re-stage on
                //    the same connection and is served before it — its TTL is
                //    then overwritten by the re-stage's.
                //  - Cancellation. `runCancellable` withdraws the NOSCRIPT
                //    fallback, which is the one hop that is issued AFTER an
                //    await and could otherwise land behind the re-stage on a
                //    cold script cache. Ordering alone does not cover it.
                //
                // This used to be handled by the id: the re-stage rotated the
                // active key to a NEW id, so a late beat naming the old one no
                // longer matched. With the id reused that guard is gone.
                stopHeartbeat();
                const restaged = await this.scripts.retryRestage({
                  groupId,
                  stagedJobId,
                  newStagedJobId,
                  dispatchAfterMs: Date.now() + backoffMs,
                  jobDataJson: retryJobData,
                  backoffMs,
                  // Written inside the same script as the re-stage. The chain is
                  // the only attempt carrier a re-staged SIBLING has — it comes
                  // back with its original envelope and no `__attempt`, and the
                  // id no longer carries a marker either — so a separate write
                  // that failed while this succeeded would hand the next
                  // sibling-led claim a fresh budget.
                  attempt: attempt + 1,
                  attemptTtlSec: GROUP_ATTEMPT_TTL_SECONDS,
                });
                // Only transfer once the replacement is actually staged.
                // retryRestage returns false when the active key is stale —
                // another worker owns this slot now — and nothing was written.
                // Transferring anyway would take a lease for a value no staged
                // job references (a phantom holding its blob for the full lease
                // window) AND release the old one, dropping the live owner's
                // protection. The publication and the transfer are still two
                // round trips, so a crash between them leaves the replacement
                // leaseless; that is survivable because the retry re-encodes to
                // the SAME content hash, so the not-yet-released old lease keeps
                // the blob alive until decode renews. Folding the transfer into
                // the staging Lua is the real fix — tracked separately, it needs
                // the blocked-restage path too.
                if (restaged) {
                  // For GQ2 the retry re-encodes to the SAME content hash, so one
                  // deadline replaces another in the lease set (the blob stays);
                  // mixed/GQ1 falls back to ordered take+release.
                  await this.blobLifecycle.transferLease({
                    newValue: retryJobData,
                    oldValue: jobDataJson,
                    groupId,
                  });
                }

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
                      errorCategory: category,
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

      // A job is its own trace, associated with its producer by the span link
      // added in `executeWithSpan` — never by parentage.
      //
      // Restoring the producer's span as the PARENT made every job a child of
      // whatever enqueued it. Handlers enqueue further jobs from inside that
      // restored context, so `getJobContextMetadata()` captured the job span
      // and the next hop inherited the same trace id, transitively and without
      // bound. One request's trace accreted the entire downstream fan-out; via
      // the shared global queue that fan-out spans tenants, so a single trace
      // id showed up on jobs for unrelated projects.
      //
      // ROOT_CONTEXT also detaches from whatever ambient span the dispatcher
      // loop happens to be in, which is what previously swept unparented Redis
      // spans into the same trace.
      await otelContext.with(ROOT_CONTEXT, executeWithSpan);
    } finally {
      stopHeartbeat();
      this.activeJobCount--;
      const jobDurationMs = performance.now() - jobStartTime;
      gqJobDurationMilliseconds.observe(routingLabels, jobDurationMs);
      // Feed the ops dashboard latency figures. Two shapes, one write: the
      // capped circular buffer behind the live P50/P99 tiles (LRANGE'd every
      // 2s, sized by the same shared constant the tiles quote), and the
      // time-bucketed histograms behind the hour/day/week/all-time windows
      // (merged by the elected snapshot writer on its detail cycle).
      // Fire-and-forget so an instrumentation hiccup never bubbles into the
      // worker pipeline.
      const completedAtMs = Date.now();
      const bucketField = latencyBucketField(jobDurationMs);
      const minuteKey = latencyMinuteBucketKey(this.queueName, completedAtMs);
      const hourKey = latencyHourBucketKey(this.queueName, completedAtMs);
      this.redisConnection
        .multi()
        .lpush(
          `${this.queueName}:gq:stats:latencies-ms`,
          String(Math.round(jobDurationMs)),
        )
        .ltrim(
          `${this.queueName}:gq:stats:latencies-ms`,
          0,
          LATENCY_SAMPLE_SIZE - 1,
        )
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
   * Parses a drained sibling's stored JSON into a clean payload. Returns null on
   * parse failure — the job was already removed from staging, so it is DISCARDED
   * here, mirroring the dispatched job's own parse-failure handling.
   *
   * This used to say "recoverable via event replay". It is not, for a subscriber
   * job: replay never invokes subscribers (see {@link dropStagedJob}). The loss is
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
        // Lease release is non-destructive; bytes remain until lazy reclaim.
        bodyPreserved: !(err instanceof DecodeFailureError
          ? err.reason === "missing_blob"
          : false),
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
   * re-dispatched instead of lost. Each is staged with its original score and
   * raw job data (context metadata preserved). Best-effort: a re-stage failure
   * is logged, not thrown, so it never masks the original processing error.
   */
  /**
   * Per-group retry-chain counter.
   *
   * The per-JOB `__attempt` is stamped into the job data, but a re-staged
   * sibling is re-queued with its ORIGINAL data and no `__attempt` of its own.
   * If such a sibling leads the next batch the attempt reads as 1 — a fresh
   * delivery — which both restarts the retry budget and tells the fold that
   * nothing in this chain has been applied yet. This counter is what makes a
   * sibling-led retry still look like a retry.
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
   * Runs a coalesced batch, halving it on a retryable failure until it either
   * succeeds or the failure is attributable to a single payload.
   *
   * Why this exists: a coalesced batch is all-or-nothing, so without bisection
   * ONE unprocessable payload fails the whole batch, and the retry re-drains
   * the same siblings into the same batch — the poison payload takes up to
   * `coalesceMaxBatch - 1` healthy payloads down with it on every attempt until
   * the group blocks. Recovery from a *size*-driven failure (a batch too heavy
   * for a downstream query's memory budget) was equally undirected: it only
   * succeeded if the retry happened to re-assemble a lighter set.
   *
   * One split handles both, because both are "this set of payloads fails but a
   * smaller set might not": a too-heavy batch halves until it fits, and a
   * poison payload halves until it is alone, at which point the throw is
   * attributable to it and the existing retry / quarantine path takes over.
   *
   * Ordering is preserved: the halves are CONTIGUOUS and awaited in sequence,
   * never concurrently, because a fold derives fields from arrival order (the
   * same invariant that makes splitting a group across lanes unsafe).
   *
   * That invariant also sets the limit of what this can do. A throw propagates
   * immediately, so payloads AFTER the offender are not attempted — stepping
   * over it would apply them across a gap the fold cannot see, producing wrong
   * values silently. So bisection recovers everything BEFORE the offender and
   * names it; it does not rescue what queued behind it. Doing that needs an
   * explicit decision about the gap, which is the side-lining work in #6482.
   *
   * Re-running a payload that already applied is safe — fold redelivery is
   * idempotent via the store's applied-event-id set (#6016) — but ONLY because
   * every sub-batch call after the first successful commit carries
   * `delivery.isContinuation`, which tells the fold commit to EXTEND that set
   * rather than replace it. Without the flag, each sub-batch commit would erase
   * the ids the earlier sub-batches recorded, and a retry after a failed later
   * sub-batch would re-apply the committed prefix (#6578).
   *
   * Non-retryable failures are NOT split: they will fail identically at every
   * size, so bisecting one only multiplies the work before the same verdict.
   *
   * Work within one locked attempt is BOUNDED. Splitting happens while this
   * job holds the group's active key (heartbeat-renewed), so an unbounded
   * descent — a handler that only accepts singletons turns a full batch into
   * ~2N sequential calls — would hold the group lock and a worker slot for the
   * whole walk instead of yielding to retry/backoff. After
   * the split budget is spent the current failure propagates
   * un-split: committed prefixes stay committed, the failed remainder re-stages
   * through the normal failure path, and backoff takes over.
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
     * Payloads paired with the staged job each came from, so a failure that
     * narrows to one payload can name it. Carrying the id is the whole reason
     * bisection is worth more than a retry: without it the throw is anonymous
     * and the terminal record anchors to the DISPATCHED job, which for a failing
     * drained sibling is the wrong job entirely.
     */
    entries: { payload: Payload; stagedJobId: string }[];
    attempt: number;
    routingLabels: Record<string, string>;
    span: Span;
    /** True in a recursive call — i.e. this batch is the product of a split. */
    isNarrowed?: boolean;
    /**
     * State shared across the whole descent of ONE dispatch, deliberately
     * mutable: `hasCommitted` flips once the first sub-batch commits (every later
     * call is a continuation and must carry the flag — see JobDelivery), and
     * `splits` is the call budget that bounds work under the group lock.
     */
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

    // Set on BOTH outcomes, and before the split recurses. The flag means "an
    // earlier call in this descent MAY have written", which is what a later
    // commit needs to know — a handler that stored and then threw (a subscriber
    // failing after the fold committed) has written just as surely as one that
    // returned. Treating that as a fresh delivery lets the next sub-batch's
    // commit REPLACE the applied set the failed call recorded (#6578). The
    // flag only ever turns a replace into a merge, so over-setting it is the
    // safe direction and under-setting it is what double-applies.
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
   * The failure half of {@link processBatchBisecting}: decide whether this
   * batch can usefully be made smaller, and if so run both halves in order.
   *
   * Split out so each half of the decision stays readable on its own — the
   * happy path is one call, and everything about *why* a failure does or does
   * not warrant a split lives here.
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
    if (!isRetryableJobError(err)) {
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

    // Call budget: splitting runs under the group's heartbeat-renewed active
    // key, so a batch degrading toward singletons must not walk the whole tree
    // (~2N sequential handler calls for N payloads) inside one locked attempt.
    // Past the budget the failure propagates un-split: committed prefixes stay
    // committed, the remainder re-stages via the normal failure path, and
    // exponential backoff takes over. The budget comfortably covers the useful
    // descents — isolating one poison payload in a 256 batch costs 8 splits,
    // converging to sub-batches of 8 costs 31 — and cuts off only the
    // pathological walk where backoff is the right behaviour anyway.
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
   * Names the payload a bisection narrowed to, so the offender is attributable
   * rather than "something in that batch".
   *
   * `entry` is undefined when the failing batch of one was never split — an
   * un-split single is just a job that failed, and reporting it as an isolate
   * would send an investigator hunting for a bisection that never happened.
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

  private async restageDrainedSiblings(
    groupId: string,
    siblings: DrainedJob[],
  ): Promise<void> {
    for (const sibling of siblings) {
      try {
        await this.scripts.stage({
          stagedJobId: sibling.stagedJobId,
          groupId,
          // Guarded like every other re-stage. Unvalidated, a legacy row at 0
          // was rewritten at 0 on every batch failure and never healed, and
          // because the exhausted-retry path DID re-score, one failure could
          // leave the siblings ordered ahead of the job they were drained
          // behind.
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
   * Publishes this worker's liveness beacon and keeps refreshing it.
   *
   * The beacon is the poison guard's only evidence of a worker death: a claim
   * marker whose owner has no beacon is a process that was working and is now
   * gone. Refresh failures are logged and otherwise tolerated — the TTL is
   * several refreshes wide precisely so a transient Redis error cannot make a
   * live worker look dead.
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
    contextMetadata: JobContextMetadata | undefined;
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
    const handlerError =
      lastError?.cause instanceof Error ? lastError.cause : lastError;

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
        handlerStack:
          handlerError === lastError ? undefined : handlerError?.stack,
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
   * only thing that calls `dispatchToSubscribers`. Subscribers are unreachable from
   * replay BY CONSTRUCTION. (`replay/` contains no reference to a subscriber at all,
   * except two that exist to *suppress* re-fires.)
   *
   * `governanceOcsfEventsSync` (OCSF audit) and `governanceKpisSync` are
   * subscribers on the `traceSummary` fold — so for them this method IS the terminal
   * event, and the counter below is the only evidence it ever happened. Scoped
   * honestly: fold/map drops genuinely ARE replay-covered (`ReplayService.replay`
   * drives `config.projections` + `config.mapProjections`). The false part is
   * subscriber-specific.
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
        // Redacted text, not the raw Error: drop errors can quote storage
        // URIs, and the stack's first line repeats the message — so both go
        // through the same redaction.
        err: redactStorageUrisInText(
          err instanceof Error ? err.message : String(err),
        ),
        errStack:
          err instanceof Error && err.stack
            ? redactStorageUrisInText(err.stack)
            : undefined,
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
    lastOwnerState,
  }: {
    groupId: string;
    stagedJobId: string;
    jobDataJson: string;
    originalScore: number;
    reason: "claim_strikes" | "oversized_payload";
    errorMessage: string;
    /**
     * What the parking claim found the previous owner to be. A crash-loop and a
     * Redis outage that expired healthy beacons both park with the same count
     * and the same message; this is the field that tells them apart. Absent for
     * the oversized-payload park, which consults no owner.
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
    // Release the marker as the group is parked. Leaving it meant the death
    // count survived the park, so an operator who unblocked inside the marker's
    // TTL had the group re-park on its very next claim — and whether it did
    // depended on how long they took to press the button.
    // Unconditional, unlike the release on the healthy path: the group is
    // leaving the dispatch path, and a marker left at the threshold would
    // re-park it on the operator's very next unblock.
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
   * A transient blob-store failure (network/5xx) means the body is temporarily
   * unreachable — not gone. Re-stage the SAME envelope with backoff so the job
   * retries instead of dropping to replay; the value is still valid and its lease
   * identity is unchanged, so there is no re-encode or identity churn. The
   * restage renews that lease before returning.
   *
   * The ladder is bounded by a count this path can reach WITHOUT the body it
   * cannot read (ADR-080): the attempt on the message's header, the group's
   * retry chain, and — only for a job staged before that change, where neither
   * can answer — a legacy retry segment on the id. It takes the highest of the
   * three, because a redelivery can overwrite the waiting job's message with a
   * fresh attempt-1 envelope, and it WRITES the chain on every rung, because a
   * message that cannot carry an attempt would otherwise never advance and a
   * misclassified permanent failure would retry forever instead of terminating
   * at the fail-safe (ADR-030 §2).
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
      Math.max(
        readJobAttempt(jobDataJson) ?? 0,
        await this.readGroupAttempt(groupId),
        legacyStagedJobAttempt(stagedJobId),
      ) + 1;
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
      dispatchAfterMs: Date.now() + backoffMs,
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
   * Generates a unique staged job ID.
   *
   * Incorporates routing metadata (__jobType/__jobName) when present so that
   * different job types processing the same event (e.g. fold and map projections)
   * get distinct staged job IDs and don't overwrite each other in the staging layer.
   */
  private generateStagedJobId(payload: Payload): string {
    const p = payload as Record<string, unknown>;
    // Every field here is `unknown` — the payload is a caller's object, and this
    // id becomes a Redis key. A cast would only silence the compiler: `??`
    // catches null/undefined but not a number or an object, either of which
    // would stringify into a malformed key (`[object Object]/subscriber/…`).
    // So each part is CHECKED, and anything that is not a usable string is
    // treated as absent.
    //
    // `p.id` is the event id this job was sent for. The fallback stands in for
    // one, so it is a KSUID like every other id the platform mints — and being
    // k-sortable it keeps the Redis key ordering the real ids already have.
    const baseId =
      nonEmptyString(p.id) ?? generate(KSUID_RESOURCES.EVENT).toString();
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

    // A planned shutdown is not a worker death (poison-group-park-guard spec:
    // "graceful shutdown mid-job does not count as a poison strike"). One
    // tombstone answers for every claim this worker holds, however the drain
    // ends: jobs it completes, jobs the shutdown budget abandons, and jobs the
    // platform's SIGKILL cuts short all leave markers that resolve to "retired".
    //
    // Stop the beacon FIRST — a refresh landing after the tombstone would
    // restore a short-lived `alive` that then expires into a false death. And
    // do this while the event loop is provably alive: a worker whose loop a
    // poison job seized never reaches here, so real crash-loops still count.
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
      this.logger.debug(
        { queueName: this.queueName },
        "Blocking connection closed",
      );
    }
  }
}

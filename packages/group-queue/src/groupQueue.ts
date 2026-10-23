// biome-ignore-all lint/suspicious/noEmptyBlockStatements: empty blocks here are deliberate no-ops.
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { performance } from "node:perf_hooks";
// Imported rather than read off the global: the constructor destructures a
// `process` handler out of the queue definition, and a class field initializer
// runs inside that same scope — so a bare `process.pid` here resolves to the
// handler's binding and dies in its temporal dead zone.
import { pid } from "node:process";

import { createLogger, type Logger } from "@langwatch/observability";
import {
  type Attributes,
  context as otelContext,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  trace,
} from "@opentelemetry/api";
import fastq from "fastq";
import { Cluster, Redis as IORedis } from "ioredis";

import { AdaptiveSlots } from "./adaptiveSlots.ts";
import {
  boundedStageBatches,
  mapInSlices,
  SEND_EACH_MAX_BYTES,
  SEND_EACH_MAX_JOBS,
  SEND_EACH_PREPARE_CONCURRENCY,
} from "./boundedStaging.ts";
import type {
  DeduplicationConfig,
  GroupQueueActivity,
  GroupQueueContextMetadata,
  GroupQueueContext,
  GroupQueueFailureClassifier,
  GroupQueuePolicy,
  GroupQueueRuntimeDefinition,
  JobDelivery,
  ListedRun,
  QueueAuditAdapter,
  QueueSendOptions,
  QueueSendResult,
} from "./contracts.ts";
import { deadLetterJob, type ExhaustedOutcome } from "./deadLetter.ts";
import { GroupQueueDispatcher } from "./dispatcher.ts";
import { EnvelopeBlobLifecycle } from "./envelopeBlobLifecycle.ts";
import {
  defaultFailureDecision,
  GroupQueueConfigurationError,
  GroupQueueError,
  HandBackGroupQueueError,
  QueueStagingClosedError,
} from "./errors.ts";
import { runGroupBatch } from "./groupBatchRun.ts";
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
import { JobLatencyStats } from "./jobLatencyStats.ts";
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
  gqJobsRetriedTotal,
  gqJobsStagedTotal,
  gqReadyScoreImplausibleTotal,
  gqRetryAttempt,
  gqRetryBackoffMilliseconds,
  gqRetryEncodeFailuresTotal,
  recordDroppedJob,
  recordNonRetryableJob,
} from "./metrics.ts";
import { GroupQueueMetricsCollector } from "./metricsCollector.ts";
import {
  type MintStorageUri,
  type ObjectStore,
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
import { ScriptCallBatcher } from "./scriptCallBatcher.ts";
import {
  activeKeyHeartbeatMs,
  DEFAULT_BISECTION_SPLITS_PER_DISPATCH,
  DEFAULT_CONFIRMED_DEATH_THRESHOLD,
  DEFAULT_GROUP_QUARANTINE_THRESHOLD,
  type DispatchResult,
  type DispatchedWork,
  type DrainedJob,
  groupBatchRouteKey,
  type GroupCompletion,
  type GroupRetryRestage,
  GroupStagingScripts,
  type PreflightTargetsState,
  type StageBatchJob,
  type StagedJobOutcome,
  type StageSettling,
  WORKER_LIVENESS_REFRESH_MS,
} from "./scripts.ts";
import { TransientBlobStoreError } from "./tieredBlobStore.ts";

/** Mutable state shared across one dispatch's bisection descent. */
interface BisectionDispatchState {
  /** True once any sub-batch of this dispatch committed successfully. */
  hasCommitted: boolean;
  /** Splits performed so far — compared against the budget above. */
  splits: number;
  /** The staged job a split narrowed the failure to, when one was isolated. */
  offender?: string;
}

/**
 * `queueDispatchScopeKey` rides on the metadata index signature, so a context
 * port reports it as `unknown`; this narrows it to the one shape it is.
 */
function scopeKeyOf(metadata: GroupQueueContextMetadata | undefined): string | undefined {
  const value = metadata?.queueDispatchScopeKey;
  return typeof value === "string" ? value : undefined;
}

/** The listed run's candidates a job was sent under, where COMPLETE puts a group with work back. */
function listedCandidatesOf(metadata: GroupQueueContextMetadata | undefined): {
  candidatesKey?: string;
} {
  const scopeKey = scopeKeyOf(metadata);
  return scopeKey ? { candidatesKey: `${scopeKey}:candidates` } : {};
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

export const JOB_RETRY_CONFIG = {
  maxAttempts: 25,
  /** An overloaded server is not the job's fault: about six more hours at the backoff cap. */
  maxOverloadedAttempts: 61,
  backoffBaseMs: 500,
  maxBackoffMs: 600_000,
} as const;

/**
 * The attempts a failure may use: an overload names a retry delay and gets the longer budget.
 * An ordinary failure gets its own rungs on top of the overload retries already spent.
 */
export function attemptBudgetOf({
  decision,
  overloadAttempts,
}: {
  decision: { retryAfterMs?: number };
  overloadAttempts: number;
}): number {
  if (decision.retryAfterMs !== undefined) return JOB_RETRY_CONFIG.maxOverloadedAttempts;
  return Math.min(
    JOB_RETRY_CONFIG.maxAttempts + overloadAttempts,
    JOB_RETRY_CONFIG.maxOverloadedAttempts,
  );
}

/** Carried in job data only once an overload retry was spent, so other jobs encode unchanged. */
function overloadAttemptsField(count: number): { __overloadAttempts?: number } {
  return count > 0 ? { __overloadAttempts: count } : {};
}

export function getBackoffMs(attempt: number): number {
  return Math.min(
    JOB_RETRY_CONFIG.backoffBaseMs * Math.pow(2, attempt - 1),
    JOB_RETRY_CONFIG.maxBackoffMs,
  );
}

/**
 * TTL for retry-chain counter; must outlive the longest backoff interval,
 * derived from retry config to prevent fresh-delivery misreads on re-expire.
 */
export const GROUP_ATTEMPT_TTL_SECONDS = Math.ceil((JOB_RETRY_CONFIG.maxBackoffMs / 1000) * 3);

/** Whether a job no worker has handled yet is handed back again, or has waited long enough. */
export function handBackOutcome({
  handedBackSince,
  now,
}: {
  handedBackSince: number | undefined;
  now: number;
}): { kind: "hand-back"; since: number } | { kind: "spend-attempt"; since: number } {
  const since = handedBackSince ?? now;
  return now - since < HAND_BACK_CONFIG.windowMs
    ? { kind: "hand-back", since }
    : { kind: "spend-attempt", since };
}

/** What a refusal over a list's groups names: the operation, and whose work it was. */
type TargetsFault = Readonly<{ operation: string; work: string }>;

/** How often a listed run waiting for room counts its outstanding jobs, at least. */
const LIST_ROOM_POLL_MS = 250;

const PREFLIGHT_FAULT: TargetsFault = {
  operation: "waitUntilPreflightIdle",
  work: "Migration preflight work",
};

/** The groups a preflight refusal names, capped so one wide fan-out stays a log line. */
function namedGroups({ groupIds, total }: { groupIds: readonly string[]; total: number }): string {
  if (groupIds.length === 0) return `${total} group(s)`;
  const undisclosed = total - groupIds.length;
  return undisclosed > 0 ? `${groupIds.join(", ")} and ${undisclosed} more` : groupIds.join(", ");
}

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
  /**
   * Max parallel groups per consumer: the previous release's 100 (Alex, 2026-10-13).
   * GLOBAL_QUEUE_CONCURRENCY raises it; a bench reached 1,474 jobs/s at 1,000.
   * Slots grow above it while that raises throughput, to at most 1,000 (Alex, 2026-10-20).
   */
  defaultGlobalConcurrency: 100,
  /** TTL for the active key (safety net for crashes), in seconds */
  activeTtlSec: 300,
  /** BRPOP timeout in seconds (fallback polling interval) */
  signalTimeoutSec: 5,
  /**
   * How long a fresh group collects jobs before it is claimable, unless it already holds a
   * full batch: a trace's spans arrive milliseconds apart. Policy `settleWindowMs` overrides.
   */
  settleWindowMs: 10,
  /**
   * Most ready groups of one handler and tenant one call carries (ARCHITECTURE §9), and the
   * bytes their coalesced payloads share: one full coalesced group's budget. Policy overrides.
   */
  groupBatchMaxGroups: 16,
  groupBatchMaxBytes: 4 * 1024 * 1024,
  /** Interval for collecting queue metrics in milliseconds */
  metricsIntervalMs: 15000,
  /** Default maximum time to wait for graceful consumer shutdown. */
  shutdownTimeoutMs: 25_000,
} as const;

/**
 * A handed-back job waits `delayMs`; past `windowMs` it spends attempts. Each worker that handed it
 * back passes its group over for `passOverMs`, two signal waits (#9148). The re-stage holds the
 * group ~3s, leaving a peer ~7s against its 5s wait: a longer `delayMs` needs a longer pass-over.
 */
export const HAND_BACK_CONFIG = {
  delayMs: 1_000,
  windowMs: 30 * 60_000,
  passOverMs: 2 * GROUP_QUEUE_CONFIG.signalTimeoutSec * 1000,
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
const CALLER_RESERVED_KEYS = new Set(["__pipelineName", "__jobType", "__jobName", "__routing"]);

function assertNoReservedKeys(
  payload: Record<string, unknown>,
  queueName: string,
  method: "send" | "sendBatch" | "sendEach",
): void {
  for (const key of Object.keys(payload)) {
    if (key.startsWith("__") && !CALLER_RESERVED_KEYS.has(key)) {
      throw new GroupQueueError({
        queueName,
        operation: method,
        message: `Payload key "${key}" is in the reserved __* namespace (queue machinery). User payloads must not start with "__" except __pipelineName / __jobType / __jobName.`,
      });
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
  "__handedBackSince",
  "__overloadAttempts",
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

function attemptSource({
  attempt,
  jobAttempt,
}: {
  attempt: number;
  jobAttempt: number;
}): "fresh" | "job" | "group" {
  if (attempt === 1) return "fresh";
  return jobAttempt >= attempt ? "job" : "group";
}

function countStagedPerGroup<Payload>({
  jobsToStage,
  payloads,
}: {
  jobsToStage: readonly { groupId: string }[];
  payloads: readonly Payload[];
}): Map<string, { payload: Payload; count: number }> {
  const perGroup = new Map<string, { payload: Payload; count: number }>();
  for (const [index, job] of jobsToStage.entries()) {
    const current = perGroup.get(job.groupId);
    perGroup.set(job.groupId, {
      payload: payloads[index]!,
      count: (current?.count ?? 0) + 1,
    });
  }
  return perGroup;
}

/** One claimed job, decoded, with the batch it coalesced. */
type ClaimedJob<Payload> = {
  groupId: string;
  stagedJobId: string;
  jobDataJson: string;
  originalScore: number;
  claimToken: string;
  payload: Payload;
  contextMetadata: GroupQueueContextMetadata | undefined;
  attempt: number;
  jobAttempt: number;
  /** When a worker first handed this job back for want of a handler; absent if none has. */
  handedBackSince: number | undefined;
  /** Retries this job spent on failures that named a retry delay (an overloaded server). */
  overloadAttempts: number;
  jobName: string;
  routingLabels: { queue_name: string; pipeline_name: string; job_type: string; job_name: string };
  batchPayloads: Payload[] | null;
  batchJobIds: string[];
  drainedSiblings: DrainedJob[];
};

type CoalescedBatch<Payload> =
  | { kind: "handled" }
  | {
      kind: "batch";
      batch: Pick<ClaimedJob<Payload>, "batchPayloads" | "batchJobIds" | "drainedSiblings">;
    };

/**
 * Per-group FIFO with cross-group parallelism: send() stages into Redis,
 * dispatch() hands work to fastq, which runs it with concurrency-limited
 * backpressure, and completion triggers the next dispatch.
 */
export class GroupQueueProcessor<Payload extends Record<string, unknown>, Destination = unknown> {
  private readonly logger: Logger;
  private readonly queueName: string;
  private readonly jobName: string;
  private readonly process: (payload: Payload, delivery?: JobDelivery) => Promise<void>;
  private readonly processBatch?: (payloads: Payload[], delivery?: JobDelivery) => Promise<void>;
  private readonly processGroups?: GroupQueueRuntimeDefinition<Payload>["processGroups"];
  private readonly groupBatchRoutes?: GroupQueueRuntimeDefinition<Payload>["groupBatchRoutes"];
  private readonly groupBatchMaxGroups: number;
  private readonly groupBatchMaxBytes: number;
  private readonly coalesceMaxBatch?: (payload: Payload) => number | undefined;
  private readonly coalesceMaxBytes?: (payload: Payload) => number | undefined;
  private readonly settleWindowMs: number;
  private readonly onExhausted?: (payload: Payload) => ExhaustedOutcome;
  private readonly spanAttributes?: (payload: Payload) => Attributes;
  private readonly processingQueue: fastq.queueAsPromised<DispatchedWork, void>;
  private readonly delay?: number;
  private readonly deduplication?: DeduplicationConfig<Payload>;
  private readonly groupKey: (payload: Payload) => string;
  private readonly score?: (payload: Payload) => number;
  private readonly auditAdapter?: QueueAuditAdapter<Payload>;
  private readonly redisConnection: IORedis | Cluster;
  private readonly latencyStats: JobLatencyStats;
  private readonly blockingConnection: IORedis | Cluster;
  private readonly scripts: GroupStagingScripts;
  /** Completions and retries finishing together share one round trip; a lone one goes alone. */
  private readonly completions = new ScriptCallBatcher<GroupCompletion, boolean>({
    one: (completion) => this.scripts.complete(completion),
    many: (completions) => this.scripts.completeMany(completions),
  });
  private readonly retries = new ScriptCallBatcher<GroupRetryRestage, boolean>({
    one: (retry) => this.scripts.retryRestage(retry),
    many: (retries) => this.scripts.retryRestageMany(retries),
  });
  private readonly blobLifecycle: EnvelopeBlobLifecycle<Destination>;
  private readonly activity?: GroupQueueActivity<Payload>;
  private readonly contextPort?: GroupQueueContext;
  private readonly failureClassifier?: GroupQueueFailureClassifier;
  private readonly identify: (payload: Payload) => string;
  private readonly shutdownTimeoutMs: number;
  private readonly globalConcurrency: number;
  private readonly adaptiveSlots: AdaptiveSlots;
  private readonly consumerEnabled: boolean;
  private readonly dispatchGroupAllowListKey?: string;
  private readonly dispatchListed: boolean;
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
      /** Runs only the groups on the lists `runListedWork` opens, from any process. */
      dispatchListed?: boolean;
      preflightDrainTimeoutMs?: number;
      objectStoreFor?: (projectId: string) => ObjectStore;
      resolveStorageDestination?: (projectId: string) => Promise<Destination>;
      mintUri?: MintStorageUri<Destination>;
      activity?: GroupQueueActivity<Payload>;
      context?: GroupQueueContext;
      failures?: GroupQueueFailureClassifier;
      drainTimeoutMs?: number;
      policy?: GroupQueuePolicy;
      logger?: Logger;
    },
  ) {
    this.logger = options?.logger ?? createLogger("langwatch:group-queue");
    const {
      name,
      process,
      processBatch,
      processGroups,
      groupBatchRoutes,
      coalesceMaxBatch,
      coalesceMaxBytes,
      onExhausted,
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
    this.dispatchListed = options?.dispatchListed ?? false;
    this.preflightDrainTimeoutMs = options?.preflightDrainTimeoutMs ?? 300_000;
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
    this.latencyStats = new JobLatencyStats({ redis: effectiveConnection, queueName: name });
    this.jobName = "queue";
    this.process = process;
    this.processBatch = processBatch;
    this.processGroups = processGroups;
    this.groupBatchRoutes = groupBatchRoutes;
    this.groupBatchMaxGroups =
      options?.policy?.groupBatchMaxGroups ?? GROUP_QUEUE_CONFIG.groupBatchMaxGroups;
    this.groupBatchMaxBytes =
      options?.policy?.groupBatchMaxBytes ?? GROUP_QUEUE_CONFIG.groupBatchMaxBytes;
    this.coalesceMaxBatch = coalesceMaxBatch;
    this.coalesceMaxBytes = coalesceMaxBytes;
    this.settleWindowMs = options?.policy?.settleWindowMs ?? GROUP_QUEUE_CONFIG.settleWindowMs;
    this.onExhausted = onExhausted;
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
      // Every outcome script releases this worker's poison-guard marker in its own step.
      ...(this.deathThreshold > 0 ? { claimMarkerOwner: this.workerId } : {}),
    });

    // The GQ2 content-addressed blob lifecycle — tiered store and the
    // encode/decode/renew/release seams. Staging Lua acquires the leases.
    this.blobLifecycle = new EnvelopeBlobLifecycle<Destination>({
      redis: this.redisConnection,
      queueName: this.queueName,
      objectStoreFor: options?.objectStoreFor,
      resolveStorageDestination: options?.resolveStorageDestination,
      mintUri: options?.mintUri,
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
      (work: DispatchedWork) => this.processMeasured(work),
      this.globalConcurrency,
    );
    this.adaptiveSlots = new AdaptiveSlots({
      floor: this.globalConcurrency,
      busy: () => this.processingQueue.running() + this.processingQueue.length(),
      onChange: (slots) => {
        this.processingQueue.concurrency = slots;
      },
    });
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
        globalConcurrency: () => this.adaptiveSlots.current(),
        activeTtlSec: GROUP_QUEUE_CONFIG.activeTtlSec,
        signalTimeoutSec: GROUP_QUEUE_CONFIG.signalTimeoutSec,
        settleWindowMs: this.settleWindowMs,
        logger: this.logger,
        dispatchGroupAllowListKey: this.dispatchGroupAllowListKey
          ? `${this.dispatchGroupAllowListKey}:candidates`
          : undefined,
        listedGroupsKeys: this.dispatchListed
          ? () => this.scripts.findOpenGroupLists(nowInstant().epochMilliseconds)
          : undefined,
        groupBatch: () => this.groupBatching(),
        claimGuardWorkerId: () => this.claimGuardWorkerId(),
        workerId: this.workerId,
      });
      this.dispatcher.start();
      this.adaptiveSlots.start();

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

  /** Who the dispatch script stamps on each claim's poison-guard marker; none while unvouched. */
  private claimGuardWorkerId(): string | undefined {
    return this.deathThreshold > 0 && this.beaconLive ? this.workerId : undefined;
  }

  /** The claim's cross-group batching; none without a group handler or routes to batch. */
  private groupBatching(): { maxGroups: number; routes: readonly string[] } | undefined {
    if (!this.processGroups || !this.groupBatchRoutes || this.groupBatchMaxGroups <= 1) {
      return undefined;
    }
    return {
      maxGroups: this.groupBatchMaxGroups,
      routes: this.groupBatchRoutes().map(groupBatchRouteKey),
    };
  }

  private captureContext(): GroupQueueContextMetadata | undefined {
    return this.contextPort?.capture();
  }

  private async runInContext<T>(
    metadata: GroupQueueContextMetadata | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.contextPort ? this.contextPort.run(metadata, operation) : operation();
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

  /** A fresh send's settling window, ended early once its group holds a full batch. */
  private settlingFor(payload: Payload): StageSettling {
    const maxBatch = this.coalesceMaxBatch?.(payload);
    const coalesces = maxBatch !== undefined && Number.isSafeInteger(maxBatch) && maxBatch > 1;
    return { windowMs: this.settleWindowMs, maxBatch: coalesces ? maxBatch : 1 };
  }

  /** The context every job of one send call carries, with its dispatch scope. */
  private sendContext(): GroupQueueContextMetadata {
    const capturedContext = this.captureContext();
    return {
      ...capturedContext,
      queueDispatchScopeKey: scopeKeyOf(capturedContext) ?? this.dispatchGroupAllowListKey,
    };
  }

  /**
   * One payload made ready to stage as a single send stages it: its own score, delay, dedup
   * flags, settling and encoded body. `send` and `sendEach` share it, so the two agree.
   */
  private async prepareSend({
    payload,
    options,
    contextMetadata,
    operation,
  }: {
    payload: Payload;
    options: QueueSendOptions<Payload> | undefined;
    contextMetadata: GroupQueueContextMetadata;
    operation: "send" | "sendEach";
  }): Promise<StageBatchJob & { delay: number | undefined }> {
    assertNoReservedKeys(payload as Record<string, unknown>, this.queueName, operation);
    const delay = options?.delay ?? this.delay;
    const dedup = options?.deduplication ?? this.deduplication;

    const groupId = this.groupKey(payload);
    const stagedJobId = this.generateStagedJobId(payload);
    // Not `?? Date.now()`: a score function returning 0 or NaN (a payload with
    // no usable occurrence time) survives `??` and stages the job at the epoch.
    const score = this.resolveScore(this.score?.(payload));

    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes({ ...(this.spanAttributes ? this.spanAttributes(payload) : {}) });
    }

    const jobDataJson = await this.blobLifecycle.encode({
      jobData: { ...(payload as Record<string, unknown>), __context: contextMetadata },
      groupId,
    });
    return {
      stagedJobId,
      groupId,
      dispatchAfterMs: score + (delay ?? 0),
      dedupId: dedup ? dedup.makeId(payload).replaceAll(":", ".") : "",
      dedupTtlMs: dedup ? (dedup.ttlMs ?? DEFAULT_DEDUPLICATION_TTL_MS) : 0,
      jobDataJson,
      shouldExtend: dedup ? dedup.extend !== false : true,
      shouldReplace: dedup ? dedup.replace !== false : true,
      shouldSurviveDispatch: dedup ? dedup.shouldSurviveDispatch === true : false,
      settle: this.settlingFor(payload),
      delay,
    };
  }

  /** Refuses a send once the drain has finished; work produced during the drain still stages. */
  private assertStagingOpen(operation: "send" | "sendBatch" | "sendEach"): void {
    if (this.stagingClosed) {
      throw new QueueStagingClosedError({ queueName: this.queueName, operation });
    }
  }

  /**
   * Stages a job into the group queue's Redis staging layer.
   */
  async send(payload: Payload, options?: QueueSendOptions<Payload>): Promise<void> {
    this.assertStagingOpen("send");
    const job = await this.prepareSend({
      payload,
      options,
      contextMetadata: this.sendContext(),
      operation: "send",
    });
    const { groupId, stagedJobId, delay } = job;
    await this.registerPreflightGroup(groupId);

    const { isNew } = await this.scripts.stage(job);
    await this.activatePreflightGroup(groupId);

    if (isNew) {
      gqJobsStagedTotal.inc({ queue_name: this.queueName });
      if (delay && delay > 0) {
        gqJobsDelayedTotal.inc({ queue_name: this.queueName });
        gqJobDelayMilliseconds.observe(delay, { queue_name: this.queueName });
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
      await this.runAudit(() => this.auditEnqueue({ payload, job }));
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

  /** The audit row a newly staged job opens, mirroring the queue's actual retry budget. */
  private auditEnqueue({
    payload,
    job,
  }: {
    payload: Payload;
    job: StageBatchJob;
  }): Promise<unknown> | undefined {
    return this.auditAdapter?.onEnqueue({
      payload,
      groupKey: job.groupId,
      dedupKey: job.dedupId || undefined,
      scheduledAt: Temporal.Instant.fromEpochMilliseconds(job.dispatchAfterMs),
      maxAttempts: JOB_RETRY_CONFIG.maxAttempts,
    });
  }

  /**
   * Stages each payload as {@link send} would, keeping its own score, delay, dedup and audit,
   * in bounded batches of one script call each, in input order. Unlike `sendBatch` it adds
   * nothing to scores. One answer per payload, at its position (specs/send-each.feature).
   */
  async sendEach(
    payloads: readonly Payload[],
    options?: QueueSendOptions<Payload>,
  ): Promise<QueueSendResult[]> {
    this.assertStagingOpen("sendEach");
    const contextMetadata = this.sendContext();
    const results: QueueSendResult[] = [];
    for (let start = 0; start < payloads.length; start += SEND_EACH_MAX_JOBS) {
      const window = payloads.slice(start, start + SEND_EACH_MAX_JOBS);
      const prepared = await mapInSlices({
        items: window,
        concurrency: SEND_EACH_PREPARE_CONCURRENCY,
        run: (payload, offset) =>
          this.prepareSend({ payload, options, contextMetadata, operation: "sendEach" }).then(
            (job) => ({ ...job, position: start + offset, payload }),
            (error: unknown) => {
              results[start + offset] = { status: "rejected", error };
              return undefined;
            },
          ),
      });
      const jobs = prepared.filter((job) => job !== undefined);
      for (const batch of boundedStageBatches({
        jobs,
        maxJobs: SEND_EACH_MAX_JOBS,
        maxBytes: SEND_EACH_MAX_BYTES,
      })) {
        const answers = await this.stageEachBatch(batch);
        for (const [index, job] of batch.entries()) {
          results[job.position] = answers[index] ?? { status: "staged" };
        }
      }
    }
    return payloads.map(
      (_, index) =>
        results[index] ?? { status: "unknown", error: new Error("Payload was never staged") },
    );
  }

  /**
   * One bounded batch of prepared sends: registered before and after as `send` registers its
   * job, then staged in one script call. A refused registration stages nothing; any failure
   * after the call starts leaves the batch unknown, since Redis may have applied it.
   */
  private async stageEachBatch(
    batch: readonly (StageBatchJob & { delay: number | undefined; payload: Payload })[],
  ): Promise<QueueSendResult[]> {
    const groupIds = () => [...new Set(batch.map((job) => job.groupId))];
    try {
      await this.registerPreflightGroups(groupIds);
    } catch (error) {
      return batch.map(() => ({ status: "rejected", error }));
    }
    let outcomes: StagedJobOutcome[];
    try {
      ({ outcomes } = await this.scripts.stageBatch(batch));
      await this.registerPreflightGroups(groupIds);
    } catch (error) {
      return batch.map(() => ({ status: "unknown", error }));
    }

    const staged = batch.filter((_, index) => outcomes[index] !== "deduplicated");
    this.recordStagedEach(staged);
    const dedupedCount = batch.length - staged.length;
    if (dedupedCount > 0) {
      gqJobsDedupedTotal.inc({ queue_name: this.queueName }, dedupedCount);
    }
    await this.runAuditAll(
      staged.map((job) => () => this.auditEnqueue({ payload: job.payload, job })),
    );
    this.logger.debug(
      { queueName: this.queueName, count: batch.length, dedupedCount },
      "Batch of single sends staged",
    );
    return batch.map((_, index) =>
      outcomes[index] === "deduplicated" ? { status: "deduplicated" } : { status: "staged" },
    );
  }

  /** The metrics and activity `send` records for each newly staged job, per group at once. */
  private recordStagedEach(
    staged: readonly (StageBatchJob & { delay: number | undefined; payload: Payload })[],
  ): void {
    if (staged.length === 0) return;
    gqJobsStagedTotal.inc({ queue_name: this.queueName }, staged.length);
    for (const job of staged) {
      if (job.delay && job.delay > 0) {
        gqJobsDelayedTotal.inc({ queue_name: this.queueName });
        gqJobDelayMilliseconds.observe(job.delay, { queue_name: this.queueName });
      }
    }
    for (const [group, value] of countStagedPerGroup({
      jobsToStage: staged,
      payloads: staged.map((job) => job.payload),
    })) {
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

  private recordStaged({
    newStagedCount,
    effectiveDelay,
    jobsToStage,
    payloads,
  }: {
    newStagedCount: number;
    effectiveDelay: number | undefined;
    jobsToStage: readonly { groupId: string }[];
    payloads: readonly Payload[];
  }): void {
    gqJobsStagedTotal.inc({ queue_name: this.queueName }, newStagedCount);
    if (effectiveDelay && effectiveDelay > 0) {
      gqJobsDelayedTotal.inc({ queue_name: this.queueName }, newStagedCount);
      for (let i = 0; i < newStagedCount; i++) {
        gqJobDelayMilliseconds.observe(effectiveDelay, { queue_name: this.queueName });
      }
    }
    for (const [group, value] of countStagedPerGroup({ jobsToStage, payloads })) {
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

  async sendBatch(payloads: Payload[], options?: QueueSendOptions<Payload>): Promise<void> {
    this.assertStagingOpen("sendBatch");

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
          settle: this.settlingFor(payload),
        };
      }),
    );

    // One registration per batch, before and after staging, as send() makes for its one job.
    const stagedGroupIds = () => [...new Set(jobsToStage.map((job) => job.groupId))];
    await this.registerPreflightGroups(stagedGroupIds);

    const { newStagedCount } = await this.scripts.stageBatch(jobsToStage);
    await this.registerPreflightGroups(stagedGroupIds);

    const dedupedCount = payloads.length - newStagedCount;
    if (newStagedCount > 0) {
      this.recordStaged({
        newStagedCount,
        effectiveDelay: options?.delay ?? this.delay,
        jobsToStage,
        payloads,
      });
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
    const results = await Promise.allSettled(ops.map(async (op) => op()));
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
   * The fastq worker: each slot's work, timed so the slot count can follow throughput.
   * A cross-group batch finishes once per group, the unit failures are counted in.
   */
  private async processMeasured(work: DispatchedWork): Promise<void> {
    const started = performance.now();
    const units = "groups" in work ? Math.max(work.groups.length, 1) : 1;
    try {
      await this.processWithRetries(work);
    } finally {
      const durationMs = performance.now() - started;
      for (let unit = 0; unit < units; unit += 1) this.adaptiveSlots.jobFinished({ durationMs });
    }
  }

  /**
   * Poison guard, then real processing. A job that seizes the
   * event loop never releases its claim, so the liveness probe kills it and
   * the next claimant finds a provably dead owner (poison-group-park-guard.feature).
   */
  private async processWithRetries(work: DispatchedWork): Promise<void> {
    if ("groups" in work) return this.processGroupBatch(work.groups);
    const dispatched = work;
    // The beacon must exist before this worker owns a marker, or a peer would
    // read our live claim as an abandoned one.
    await this.livenessReady;
    // The dispatch script read the counter inside the claim; only an older reply makes us ask.
    const groupAttempt = this.groupAttemptOf(dispatched);
    if ((await this.guardClaim(dispatched)) === "parked") return;
    // No release here: every outcome script releases the marker in the same step.
    await this.processClaimedJob(dispatched, groupAttempt);
  }

  private groupAttemptOf(dispatched: DispatchResult): Promise<number> {
    return dispatched.groupAttempt === undefined
      ? this.readGroupAttempt(dispatched.groupId)
      : Promise.resolve(dispatched.groupAttempt);
  }

  /** The poison guard's claim record: `parked` when the group crossed its death threshold. */
  private async guardClaim(
    dispatched: DispatchResult,
  ): Promise<"unguarded" | "guarded" | "parked"> {
    const { stagedJobId, groupId, jobDataJson, originalScore, claimToken } = dispatched;
    const { deathThreshold } = this;
    if (!(deathThreshold > 0)) return "unguarded";
    // The dispatch script wrote the marker with the claim; only a claim made before the beacon
    // was confirmed (or by an older reply) records it here, as it always did.
    const recorded =
      dispatched.claimGuard ?? (this.beaconLive ? await this.recordClaim(dispatched) : undefined);
    if (!recorded) return "unguarded";
    const { deaths, lastOwnerState } = recorded;
    if (deaths < deathThreshold) return "guarded";
    await this.parkPoisonGroup({
      groupId,
      stagedJobId,
      jobDataJson,
      originalScore,
      claimToken,
      reason: "claim_strikes",
      lastOwnerState,
      errorMessage: `Poison guard: ${deaths} confirmed worker deaths while this group was in flight (threshold ${deathThreshold}). Each was a worker that claimed this group and then stopped heartbeating without shutting down. Inspect the staged jobs, then unblock the group to retry.`,
    });
    return "parked";
  }

  /** The marker recorded in its own round trip, for a claim the dispatch script did not stamp. */
  private async recordClaim(
    dispatched: DispatchResult,
  ): Promise<{ deaths: number; lastOwnerState: string }> {
    try {
      return await this.scripts.recordClaim({
        groupId: dispatched.groupId,
        workerId: this.workerId,
        stagedJobId: dispatched.stagedJobId,
        claimToken: dispatched.claimToken,
      });
    } catch {
      // Poison accounting is protective, never load-bearing: an unreadable
      // marker must not stop the queue.
      return { deaths: 0, lastOwnerState: "" };
    }
  }

  /**
   * Ready groups of one handler and tenant claimed together: each is guarded, decoded and
   * coalesced alone (its drain takes a share of the batch's bytes), then they run as one call.
   */
  private async processGroupBatch(claims: DispatchResult[]): Promise<void> {
    await this.livenessReady;
    const guards = await Promise.all(claims.map((claim) => this.guardClaim(claim)));
    const live = claims.filter((_, index) => guards[index] !== "parked");
    const byteShare = Math.max(1, Math.floor(this.groupBatchMaxBytes / Math.max(live.length, 1)));
    const prepared = await Promise.all(
      live.map((dispatched) =>
        this.prepareClaimedJob({
          dispatched,
          groupAttempt: this.groupAttemptOf(dispatched),
          byteShare,
        }),
      ),
    );
    const jobs = prepared.flat();
    if (jobs.length <= 1 || !this.processGroups) {
      await Promise.all(jobs.map((job) => this.runClaimedJob(job)));
      return;
    }
    await this.runGroupJobs(jobs);
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
  private async processClaimedJob(
    dispatched: DispatchResult,
    groupAttempt?: Promise<number>,
  ): Promise<void> {
    const [job] = await this.prepareClaimedJob({ dispatched, groupAttempt });
    if (!job) return;
    await this.runClaimedJob(job);
  }

  /** The claim decoded and coalesced; none when it was retried, parked or dropped instead. */
  private async prepareClaimedJob({
    dispatched,
    groupAttempt,
    byteShare,
  }: {
    dispatched: DispatchResult;
    groupAttempt?: Promise<number>;
    /** A cross-group batch's share of its byte budget, bounding this group's drain. */
    byteShare?: number;
  }): Promise<ClaimedJob<Payload>[]> {
    const [jobData] = await this.decodeClaimedJob(dispatched);
    if (!jobData) return [];
    return this.claimedJobFrom({ dispatched, jobData, groupAttempt, byteShare });
  }

  /**
   * Renews the group's active key while its job runs. Idempotent stop, so an outcome
   * path can stop the beat when it decides (the retry path) and a `finally` still can.
   */
  private startJobHeartbeat(job: ClaimedJob<Payload>): () => void {
    let heartbeatStopped = false;
    const heartbeat = this.startActiveKeyHeartbeat({
      groupId: job.groupId,
      stagedJobId: job.stagedJobId,
      claimToken: job.claimToken,
      jobDataValues: [
        job.jobDataJson,
        ...job.drainedSiblings.map((sibling) => sibling.jobDataJson),
      ],
      isCancelled: () => heartbeatStopped,
    });
    return (): void => {
      if (heartbeatStopped) return;
      heartbeatStopped = true;
      clearInterval(heartbeat);
    };
  }

  /**
   * One heartbeat for a cross-group batch: every live group's lease in one round trip, each
   * fenced by its own token. A group's stop takes it out (the retry path stops before its
   * re-stage, as the single heartbeat does); the timer ends with the last one.
   */
  private startGroupBatchHeartbeat(
    jobs: readonly ClaimedJob<Payload>[],
  ): ReadonlyMap<ClaimedJob<Payload>, () => void> {
    const beating = new Set(jobs);
    const { activeTtlSec } = GROUP_QUEUE_CONFIG;
    const timer = setInterval(
      () => this.beatGroupBatch({ due: [...beating], beating, activeTtlSec }),
      activeKeyHeartbeatMs({ activeTtlSec }),
    );
    return new Map(
      jobs.map((job) => [
        job,
        (): void => {
          if (!beating.delete(job)) return;
          if (beating.size === 0) clearInterval(timer);
        },
      ]),
    );
  }

  /** One beat of {@link startGroupBatchHeartbeat}: renew every due lease, warn per failure. */
  private beatGroupBatch({
    due,
    beating,
    activeTtlSec,
  }: {
    due: ClaimedJob<Payload>[];
    beating: ReadonlySet<ClaimedJob<Payload>>;
    activeTtlSec: number;
  }): void {
    void this.scripts
      .heartbeatMany({
        activeTtlSec,
        heartbeats: due.map((job) => ({
          groupId: job.groupId,
          stagedJobId: job.stagedJobId,
          claimToken: job.claimToken,
          isCancelled: () => !beating.has(job),
        })),
      })
      .then(
        (results) =>
          results.forEach((result, index) => {
            if (result.status !== "rejected") return;
            this.warnHeartbeat({ job: due[index], error: result.reason });
          }),
        (error: unknown) => {
          for (const job of due) this.warnHeartbeat({ job, error });
        },
      );
    for (const job of due) {
      const values = [job.jobDataJson, ...job.drainedSiblings.map((d) => d.jobDataJson)];
      for (const value of values) void this.blobLifecycle.renewLease(value);
    }
  }

  private warnHeartbeat({
    job,
    error,
  }: {
    job: ClaimedJob<Payload> | undefined;
    error: unknown;
  }): void {
    this.logger.warn(
      {
        queueName: this.queueName,
        groupId: job?.groupId,
        stagedJobId: job?.stagedJobId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to heartbeat active key during processing",
    );
  }

  private async runClaimedJob(job: ClaimedJob<Payload>): Promise<void> {
    const jobStartTime = performance.now();
    const stopHeartbeat = this.startJobHeartbeat(job);
    this.activeJobCount++;

    try {
      // A job is its own trace, linked to its producer and never parented by it:
      // parentage would let one trace id propagate across tenants via the queue.
      await otelContext.with(ROOT_CONTEXT, () => this.runClaimedJobSpan({ job, stopHeartbeat }));
    } finally {
      stopHeartbeat();
      this.activeJobCount--;
      const jobDurationMs = performance.now() - jobStartTime;
      gqJobDurationMilliseconds.observe(jobDurationMs, job.routingLabels);
      this.latencyStats.record(jobDurationMs);
    }
  }

  /** Claimed groups run as one call: every lease renewed, every outcome its own group's. */
  private async runGroupJobs(jobs: ClaimedJob<Payload>[]): Promise<void> {
    const jobStartTime = performance.now();
    const stops = this.startGroupBatchHeartbeat(jobs);
    this.activeJobCount += jobs.length;
    try {
      await otelContext.with(ROOT_CONTEXT, () => this.runGroupJobsSpan({ jobs, stops }));
    } finally {
      for (const stop of stops.values()) stop();
      this.activeJobCount -= jobs.length;
      const jobDurationMs = performance.now() - jobStartTime;
      for (const job of jobs) {
        gqJobDurationMilliseconds.observe(jobDurationMs, job.routingLabels);
        this.latencyStats.record(jobDurationMs);
      }
    }
  }

  /** The batch's consumer span, linked to every group's producer. */
  private async runGroupJobsSpan({
    jobs,
    stops,
  }: {
    jobs: ClaimedJob<Payload>[];
    stops: ReadonlyMap<ClaimedJob<Payload>, () => void>;
  }): Promise<void> {
    const [first] = jobs;
    if (!first) return;
    await withActiveSpan(
      `${this.queueName}/${this.jobName}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          "queue.name": this.queueName,
          "queue.job_name": this.jobName,
          "queue.group_batch_size": jobs.length,
          "queue.group_id": first.groupId,
          ...this.customSpanAttributes(first.payload),
        },
      },
      async (span) => {
        for (const job of jobs) this.linkProducerSpan(span, job.contextMetadata);
        const leasedUntil = nowInstant().add({ milliseconds: JOB_RETRY_CONFIG.maxBackoffMs });
        await this.runAuditAll(
          jobs.flatMap((job) =>
            (job.batchPayloads ?? [job.payload]).map(
              (payload) => () =>
                this.auditAdapter?.onLeased({ payload, attempt: job.attempt, leasedUntil }),
            ),
          ),
        );
        // One tenant per batch (the claim keys batches by tenant), so the first context serves.
        await this.runInContext(first.contextMetadata, () =>
          this.runGroupBatchIn({ jobs, stops, span }),
        );
      },
    );
  }

  /** The descent over one batch: each group's handler call, outcome and bisection state. */
  private runGroupBatchIn({
    jobs,
    stops,
    span,
  }: {
    jobs: ClaimedJob<Payload>[];
    stops: ReadonlyMap<ClaimedJob<Payload>, () => void>;
    span: Span;
  }): Promise<void> {
    const bisections = new Map<ClaimedJob<Payload>, BisectionDispatchState>();
    const routingLabels = jobs[0]?.routingLabels;
    return runGroupBatch({
      jobs,
      runAll: (set, isContinuation) =>
        this.processGroups!(
          set.map((job) => ({
            payloads: job.batchPayloads ?? [job.payload],
            delivery: {
              attempt: job.attempt,
              jobId: job.stagedJobId,
              ...(job.batchPayloads ? { jobIds: job.batchJobIds } : {}),
              ...(isContinuation(job) ? { isContinuation: true } : {}),
            },
          })),
        ),
      runOne: async (job, isContinuation) => {
        const dispatch: BisectionDispatchState = { hasCommitted: isContinuation, splits: 0 };
        bisections.set(job, dispatch);
        await this.runJobHandler({ job, span, dispatch });
      },
      succeed: async (set) => {
        await Promise.all(set.map((job) => this.completeClaimedJob(job)));
      },
      fail: (job, err) =>
        this.failClaimedJob({
          job,
          err,
          span,
          stopHeartbeat: stops.get(job) ?? (() => {}),
          offender: bisections.get(job)?.offender,
        }),
      splitsOnFailure: (err) => this.failureDecision(err).retryAfterMs === undefined,
      onSplit: ({ size, splitAt, error }) => {
        if (routingLabels) gqBatchBisectionsTotal.inc(routingLabels);
        span.addEvent("queue.group_batch_bisected", {
          "queue.group_batch_size": size,
          "queue.group_batch_split_at": splitAt,
        });
        this.logger.warn(
          {
            queueName: this.queueName,
            groupBatchSize: size,
            splitAt,
            error: error instanceof Error ? error : new Error(String(error)),
          },
          "Cross-group batch failed; splitting its groups in half and running each half in order",
        );
      },
    });
  }

  /** The handler over one claimed job: its coalesced batch bisecting, or its single payload. */
  private async runJobHandler({
    job,
    span,
    dispatch,
  }: {
    job: ClaimedJob<Payload>;
    span: Span;
    dispatch: BisectionDispatchState;
  }): Promise<void> {
    const { payload, attempt, stagedJobId, routingLabels, batchPayloads, batchJobIds } = job;
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
        dispatch,
      });
      return;
    }
    await this.process(payload, {
      attempt,
      jobId: stagedJobId,
      ...(dispatch.hasCommitted ? { isContinuation: true } : {}),
    });
  }

  /** The stored job data, or none when the value was retried, parked or dropped instead. */
  private async decodeClaimedJob(dispatched: DispatchResult): Promise<Record<string, unknown>[]> {
    const { stagedJobId, groupId, jobDataJson, originalScore, claimToken } = dispatched;
    // Parse the stored job data
    try {
      return [
        await this.blobLifecycle.decode({
          value: jobDataJson,
          groupId,
        }),
      ];
    } catch (err) {
      if (err instanceof TransientBlobStoreError) {
        // The body is temporarily unreachable, not gone — retry, don't drop.
        await this.handleTransientDecode({
          groupId,
          stagedJobId,
          jobDataJson,
          claimToken,
          err,
        });
        return [];
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
          claimToken,
          reason: "oversized_payload",
          errorMessage: `Poison guard: ${err.message}. The staged value was parked unparsed.`,
        });
        return [];
      }
      // Not transient (retry) and not oversized (park): we cannot process this
      // job, now or ever, on this worker. Complete the slot so the group stays
      // live, but name and count the loss — see dropStagedJob.
      await this.dropStagedJob({
        groupId,
        stagedJobId,
        jobDataJson,
        claimToken,
        err,
        reason: dropReasonOf(err),
        message: "Failed to parse staged job data",
      });
      return [];
    }
  }

  /** The claimed job with its coalesced batch; none when a sibling forced a retry or park. */
  private async claimedJobFrom({
    dispatched,
    jobData,
    groupAttempt,
    byteShare,
  }: {
    dispatched: DispatchResult;
    jobData: Record<string, unknown>;
    /** The group's chain counter, when the caller already asked for it. */
    groupAttempt?: Promise<number>;
    byteShare?: number;
  }): Promise<ClaimedJob<Payload>[]> {
    const { stagedJobId, groupId, jobDataJson, originalScore, claimToken } = dispatched;
    const contextMetadata = jobData.__context as GroupQueueContextMetadata | undefined;
    const jobAttempt = typeof jobData.__attempt === "number" ? jobData.__attempt : 1;
    // A re-staged sibling carries no __attempt of its own, so fall back to the
    // group's chain counter rather than reading it as a fresh delivery.
    const attempt = Math.max(jobAttempt, await (groupAttempt ?? this.readGroupAttempt(groupId)));
    const handedBackSince =
      typeof jobData.__handedBackSince === "number" ? jobData.__handedBackSince : undefined;
    const overloadAttempts =
      typeof jobData.__overloadAttempts === "number" ? jobData.__overloadAttempts : 0;
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
    // exclusive. Only siblings sent under the same dispatch scope join the batch
    // (coalescedBatch restages the rest), so every scope's fan-out stays its own.
    const maxBatch = this.coalesceMaxBatch?.(payload) ?? 1;
    const base = {
      groupId,
      stagedJobId,
      jobDataJson,
      originalScore,
      claimToken,
      payload,
      contextMetadata,
      attempt,
      jobAttempt,
      handedBackSince,
      overloadAttempts,
      jobName,
      routingLabels,
    };
    if (maxBatch <= 1 || !this.processBatch) {
      return [{ ...base, batchPayloads: null, batchJobIds: [], drainedSiblings: [] }];
    }
    const drained = await this.drainMatchingSiblings({ dispatched, payload, maxBatch, byteShare });
    const batch = await this.coalescedBatch({ dispatched, payload, contextMetadata, drained });
    return batch.kind === "handled" ? [] : [{ ...base, ...batch.batch }];
  }

  /**
   * Drains due siblings of the same job into the batch. Byte bound (ADR-066
   * pillar 2): the drain stops before a job that would push the batch past
   * maxBytes; siblings of another job are restaged, not coalesced.
   */
  private async drainMatchingSiblings({
    dispatched,
    payload,
    maxBatch,
    byteShare,
  }: {
    dispatched: DispatchResult;
    payload: Payload;
    maxBatch: number;
    byteShare?: number;
  }): Promise<DrainedJob[]> {
    const { groupId, jobDataJson, claimToken } = dispatched;
    let drainedSiblings: DrainedJob[] = [];
    const ownMaxBytes = this.coalesceMaxBytes?.(payload) ?? DEFAULT_COALESCE_MAX_BYTES;
    const maxBytes = byteShare === undefined ? ownMaxBytes : Math.min(ownMaxBytes, byteShare);
    const initialBytes = readJobPayloadBytes(jobDataJson);
    try {
      drainedSiblings = await this.scripts.drainGroupReady({
        groupId,
        nowMs: nowInstant().epochMilliseconds,
        maxJobs: maxBatch - 1,
        maxBytes,
        initialBytes,
        claimToken,
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
        gqForeignSiblingsRestagedTotal.inc({ queue_name: this.queueName }, foreignSiblings.length);
        await this.restageDrainedSiblings({ groupId, siblings: foreignSiblings, claimToken });
      }
      drainedSiblings = matchingSiblings;
    }
    return drainedSiblings;
  }

  /** Parses drained siblings into the batch; a transient or oversized one retries or parks. */
  private async coalescedBatch({
    dispatched,
    payload,
    contextMetadata,
    drained,
  }: {
    dispatched: DispatchResult;
    payload: Payload;
    contextMetadata: GroupQueueContextMetadata | undefined;
    drained: DrainedJob[];
  }): Promise<CoalescedBatch<Payload>> {
    const { stagedJobId, groupId, jobDataJson, originalScore, claimToken } = dispatched;
    const drainedSiblings = drained;
    if (drainedSiblings.length === 0) {
      return { kind: "batch", batch: { batchPayloads: null, batchJobIds: [], drainedSiblings } };
    }
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
        await this.restageDrainedSiblings({ groupId, siblings: differentlyScoped, claimToken });
      }
      if (siblingPayloads.length === 0) {
        return {
          kind: "batch",
          batch: { batchPayloads: null, batchJobIds: [], drainedSiblings: liveSiblings },
        };
      }
      return {
        kind: "batch",
        batch: {
          batchPayloads: [payload, ...siblingPayloads],
          batchJobIds: [stagedJobId, ...liveSiblings.map((sibling) => sibling.stagedJobId)],
          drainedSiblings: liveSiblings,
        },
      };
    } catch (err) {
      if (err instanceof TransientBlobStoreError) {
        // A transient blob-store failure on any drained sibling MUST
        // re-stage the whole batch, not silently drop the siblings. Re-stage
        // the siblings via the normal path and route the dispatched job
        // through the same handleTransientDecode as the direct decode
        // failure — the body is unreachable, not gone (ADR-029).
        await this.restageDrainedSiblings({ groupId, siblings: drainedSiblings, claimToken });
        await this.handleTransientDecode({
          groupId,
          stagedJobId,
          jobDataJson,
          claimToken,
          err,
        });
        return { kind: "handled" };
      }
      if (err instanceof PayloadTooLargeError) {
        // An oversized drained sibling can't be parsed without seizing the event
        // loop, and re-dispatch would only re-drain it — so mirror the oversized
        // path: park the group and re-stage the drained siblings first, preserving
        // them (and the oversized value) for inspection rather than losing them to
        // replay. The dispatched job's value carries the park.
        await this.restageDrainedSiblings({ groupId, siblings: drainedSiblings, claimToken });
        await this.parkPoisonGroup({
          groupId,
          stagedJobId,
          jobDataJson,
          originalScore,
          claimToken,
          reason: "oversized_payload",
          errorMessage: `Poison guard: a coalesced sibling of this group is oversized (${err.message}). The batch was parked unparsed.`,
        });
        return { kind: "handled" };
      }
      throw err;
    }
  }

  /** The job's consumer span: lease audit, the handler run, then its outcome. */
  private async runClaimedJobSpan({
    job,
    stopHeartbeat,
  }: {
    job: ClaimedJob<Payload>;
    stopHeartbeat: () => void;
  }): Promise<void> {
    const { groupId, stagedJobId, payload, contextMetadata, attempt, jobAttempt, batchPayloads } =
      job;
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
      "queue.attempt_source": attemptSource({ attempt, jobAttempt }),
    };

    Object.assign(spanAttributes, this.customSpanAttributes(payload));

    const bisection: BisectionDispatchState = { hasCommitted: false, splits: 0 };
    await withActiveSpan(
      spanName,
      {
        kind: SpanKind.CONSUMER,
        attributes: spanAttributes,
      },
      async (span) => {
        this.linkProducerSpan(span, contextMetadata);
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
          await this.runInContext(contextMetadata, () =>
            this.runJobHandler({ job, span, dispatch: bisection }),
          );

          await this.completeClaimedJob(job);
        } catch (err) {
          await this.failClaimedJob({
            job,
            err,
            span,
            stopHeartbeat,
            offender: bisection.offender,
          });
        }
      },
    );
  }

  /** Links the job's span to the request that produced it, with its business context. */
  private linkProducerSpan(
    span: Span,
    contextMetadata: GroupQueueContextMetadata | undefined,
  ): void {
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
  }

  /** Completes the group slot, then does the bookkeeping that must never re-run the job. */
  private async completeClaimedJob(job: ClaimedJob<Payload>): Promise<void> {
    const {
      groupId,
      stagedJobId,
      jobDataJson,
      claimToken,
      payload,
      attempt,
      jobName,
      routingLabels,
      batchPayloads,
      drainedSiblings,
    } = job;
    // Success — complete the group slot. Drained siblings were
    // removed from staging during the drain, so completing the
    // dispatched job is enough to free the group.
    const completed = await this.completions.call({
      groupId,
      stagedJobId,
      jobName,
      claimToken,
      // A success ends the group's retry chain: no stale streak or attempt outlives it.
      endsRetryChain: true,
      ...listedCandidatesOf(job.contextMetadata),
    });
    if (!completed) {
      // Another worker recovered this claim after our active key lapsed and runs the job
      // now; its lease and the group's chain are that worker's (claimed-job-recovery.feature).
      this.logger.warn(
        { queueName: this.queueName, groupId, stagedJobId, attempt },
        "Job finished after its claim was recovered by another worker; leaving the completion to that worker",
      );
      return;
    }

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
  }

  /** A handler failure: restage the drained siblings, then retry, quarantine or block. */
  private async failClaimedJob({
    job,
    err,
    span,
    stopHeartbeat,
    offender,
  }: {
    job: ClaimedJob<Payload>;
    err: unknown;
    span: Span;
    stopHeartbeat: () => void;
    offender: string | undefined;
  }): Promise<void> {
    const { groupId, attempt, drainedSiblings } = job;
    const error = err instanceof Error ? err : new Error(String(err));
    const decision = this.failureDecision(err);
    const isRetryable = decision.retryable;

    // The batch stores its fold state only once, at the very end, so a
    // failure means nothing was persisted for the drained siblings.
    // Re-stage them so they are re-dispatched (and re-coalesced) on the
    // dispatched job's retry, rather than lost until an event replay.
    if (drainedSiblings.length > 0) {
      await this.restageDrainedSiblings({
        groupId,
        siblings: drainedSiblings,
        claimToken: job.claimToken,
      });
    }

    if (err instanceof HandBackGroupQueueError) {
      const outcome = handBackOutcome({
        handedBackSince: job.handedBackSince,
        now: nowInstant().epochMilliseconds,
      });
      if (outcome.kind === "hand-back") {
        await this.handBackClaimedJob({ job, error, since: outcome.since, stopHeartbeat });
        return;
      }
      this.logger.error(
        {
          queueName: this.queueName,
          groupId,
          stagedJobId: job.stagedJobId,
          attempt,
          handedBackSince: outcome.since,
          windowMs: HAND_BACK_CONFIG.windowMs,
          error,
        },
        "No worker has run this job since it was first handed back; spending its attempts so it surfaces",
      );
    }
    this.adaptiveSlots.jobFailed();

    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    const [quarantineError] = await this.quarantineErrors({ job, error, isRetryable });
    const budget = attemptBudgetOf({ decision, overloadAttempts: job.overloadAttempts });
    if (isRetryable && attempt < budget && !quarantineError) {
      await this.retryClaimedJob({ job, error, decision, stopHeartbeat });
      return;
    }
    await this.exhaustClaimedJob({ job, error, isRetryable, quarantineError, span, offender });
  }

  /**
   * Group-quarantine circuit breaker: a producer minting fresh jobs faster than
   * they drain never trips `maxAttempts`, so consecutive retryable failures are
   * counted across the group. Answers the quarantine error once past the threshold.
   */
  private async quarantineErrors({
    job,
    error,
    isRetryable,
  }: {
    job: ClaimedJob<Payload>;
    error: Error;
    isRetryable: boolean;
  }): Promise<Error[]> {
    const { groupId, stagedJobId } = job;
    // Group-quarantine circuit breaker: a producer minting fresh jobs faster than
    // they drain never trips the per-job `maxAttempts` cap (every failure is a new
    // attempt-1 job), so the group could churn forever. Count consecutive
    // retryable failures across the group instead; past the threshold, route
    // through the same exhausted-retry path so an operator can inspect and drain it.
    if (!isRetryable || this.quarantineFailStreakThreshold <= 0) return [];
    {
      const failStreak = await this.scripts.recordGroupFailure(groupId);
      if (failStreak > this.quarantineFailStreakThreshold) {
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
        const quarantineError = new Error(
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
        return [quarantineError];
      }
    }
    return [];
  }

  /** Re-stage with backoff, which frees the worker slot immediately. */
  private async retryClaimedJob({
    job,
    error,
    decision,
    stopHeartbeat,
  }: {
    job: ClaimedJob<Payload>;
    error: Error;
    decision: { retryable: boolean; retryAfterMs?: number };
    stopHeartbeat: () => void;
  }): Promise<void> {
    const {
      groupId,
      stagedJobId,
      jobDataJson,
      claimToken,
      payload,
      contextMetadata,
      attempt,
      jobName,
      routingLabels,
      batchPayloads,
    } = job;
    // Re-stage with backoff — frees the worker slot immediately
    gqJobsRetriedTotal.inc(routingLabels);

    // Honor the failure classifier's retry delay as a FLOOR over
    // exponential backoff. A caller can lengthen but never shorten
    // the wait, so its policy cannot cause a retry storm.
    const backoffMs = Math.max(getBackoffMs(attempt), decision.retryAfterMs ?? 0);
    gqRetryAttempt.observe(attempt, routingLabels);
    gqRetryBackoffMilliseconds.observe(backoffMs, routingLabels);
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
          ...(job.handedBackSince === undefined ? {} : { __handedBackSince: job.handedBackSince }),
          ...overloadAttemptsField(
            job.overloadAttempts + (decision.retryAfterMs === undefined ? 0 : 1),
          ),
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
      const completed = await this.scripts.complete({
        groupId,
        stagedJobId,
        jobName,
        dropped: true,
        claimToken,
        ...listedCandidatesOf(contextMetadata),
      });
      // A recovering worker's job carries this value and its lease; only the owner releases it.
      if (completed) await this.blobLifecycle.releaseLease({ values: [jobDataJson], groupId });
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
    const restaged = await this.retries.call({
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
      claimToken,
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
        maxAttempts: attemptBudgetOf({ decision, overloadAttempts: job.overloadAttempts }),
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
  }

  /**
   * Returns a job this worker has no handler for to the queue unspent: same attempt, no failure
   * streak, no audit. This worker passes the group over meanwhile, so a peer takes it first.
   */
  private async handBackClaimedJob({
    job,
    error,
    since,
    stopHeartbeat,
  }: {
    job: ClaimedJob<Payload>;
    error: Error;
    since: number;
    stopHeartbeat: () => void;
  }): Promise<void> {
    const { groupId, stagedJobId, jobDataJson, claimToken, payload, contextMetadata } = job;
    const { attempt, jobName } = job;
    let handBackJobData: string;
    try {
      handBackJobData = await this.blobLifecycle.encode({
        jobData: {
          ...(payload as Record<string, unknown>),
          __context: contextMetadata,
          __attempt: attempt,
          __handedBackSince: since,
          ...overloadAttemptsField(job.overloadAttempts),
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
        message: "Hand-back re-encode failed; releasing old lease and discarding job",
        bodyPreserved: false,
      });
      const completed = await this.scripts.complete({
        groupId,
        stagedJobId,
        jobName,
        dropped: true,
        claimToken,
        ...listedCandidatesOf(contextMetadata),
      });
      if (completed) await this.blobLifecycle.releaseLease({ values: [jobDataJson], groupId });
      return;
    }
    // Before the re-stage, as on the retry path: a heartbeat tick would overwrite its TTL.
    stopHeartbeat();
    const restaged = await this.scripts.retryRestage({
      groupId,
      stagedJobId,
      newStagedJobId: stagedJobId,
      dispatchAfterMs: nowInstant().epochMilliseconds + HAND_BACK_CONFIG.delayMs,
      jobDataJson: handBackJobData,
      backoffMs: HAND_BACK_CONFIG.delayMs,
      attempt,
      attemptTtlSec: GROUP_ATTEMPT_TTL_SECONDS,
      claimToken,
      passOver: { workerId: this.workerId, ttlMs: HAND_BACK_CONFIG.passOverMs },
    });
    if (restaged) {
      await this.blobLifecycle.transferLease({
        newValue: handBackJobData,
        oldValue: jobDataJson,
        groupId,
      });
    }
    this.logger.warn(
      {
        queueName: this.queueName,
        groupId,
        stagedJobId,
        attempt,
        handedBackSince: since,
        error,
      },
      "No handler for this job in this worker; handed it back without using an attempt",
    );
  }

  /** Out of retries, non-retryable, or quarantined: block the group (or dead-letter) and audit. */
  private async exhaustClaimedJob({
    job,
    error,
    isRetryable,
    quarantineError,
    span,
    offender,
  }: {
    job: ClaimedJob<Payload>;
    error: Error;
    isRetryable: boolean;
    quarantineError: Error | undefined;
    span: Span;
    offender: string | undefined;
  }): Promise<void> {
    const { groupId, stagedJobId, jobDataJson, payload, attempt, routingLabels } = job;
    span.setAttribute("error", true);
    span.setAttribute("error.message", error.message);

    if (!isRetryable) {
      recordNonRetryableJob({ labels: routingLabels, error });
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

    // When the group tripped the quarantine breaker, block it with the descriptive quarantine
    // error rather than the raw job error, so /ops shows why the group is blocked.
    const lastError = quarantineError ?? error;
    const { deadPayloads, claimLost } =
      this.onExhausted?.(payload) === "dead-letter"
        ? await this.deadLetterClaimedJob({ job, lastError, offender })
        : await this.blockClaimedJob({ job, lastError });

    // Audit hook: terminal — onDead fires for every payload that died.
    await this.runAuditAll(
      deadPayloads.map(
        (p) => () =>
          this.auditAdapter?.onDead({
            payload: p,
            lastError: error.message,
            attempt,
          }),
      ),
    );
    // The recovering worker's job carries this value and its lease (claimed-job-recovery.feature).
    if (claimLost) return;
    await this.blobLifecycle.releaseLease({
      values: [jobDataJson],
      groupId,
    });
  }

  /**
   * Blocks the group with the job re-staged; every payload of the batch counts as dead,
   * unless the claim was lost.
   */
  private async blockClaimedJob({
    job,
    lastError,
  }: {
    job: ClaimedJob<Payload>;
    lastError: Error;
  }): Promise<{ deadPayloads: Payload[]; claimLost: boolean }> {
    const blocked = await this.handleExhaustedRetries({
      groupId: job.groupId,
      stagedJobId: job.stagedJobId,
      payload: job.payload,
      originalScore: job.originalScore,
      claimToken: job.claimToken,
      lastError,
      contextMetadata: job.contextMetadata,
      routingLabels: job.routingLabels,
    });
    // A job whose claim was recovered did not die: the recovering worker runs it.
    if (!blocked) return { deadPayloads: [], claimLost: true };
    return { deadPayloads: job.batchPayloads ?? [job.payload], claimLost: false };
  }

  /**
   * Dead-letters the failed job, or only a batch's isolated offender (the rest re-staged), then
   * completes the slot so the group drains on. Ops redrives the dead letter. Answers the payloads
   * that died. Ruling: dev/docs/ARCHITECTURE.md §9 (Alex, 2026-09-30).
   */
  private async deadLetterClaimedJob({
    job,
    lastError,
    offender,
  }: {
    job: ClaimedJob<Payload>;
    lastError: Error;
    offender: string | undefined;
  }): Promise<{ deadPayloads: Payload[]; claimLost: boolean }> {
    const { groupId, stagedJobId, payload, contextMetadata, jobName, routingLabels } = job;
    const score = this.restageScore(job.originalScore);
    const batchJobIds = job.batchJobIds.length > 0 ? job.batchJobIds : [stagedJobId];
    const deadJobIds = offender ? [offender] : batchJobIds;
    // Re-encoded without its spent `__attempt`, as the block path does: the claimed job is no
    // longer staged, so this value is what the dead letter or the re-stage keeps.
    const freshValue = await this.blobLifecycle.encode({
      jobData: { ...payload, __context: contextMetadata },
      groupId,
    });
    const handlerError = lastError.cause instanceof Error ? lastError.cause : lastError;
    const refusedJobIds: string[] = [];
    for (const jobId of deadJobIds) {
      const outcome = await deadLetterJob({
        redis: this.redisConnection,
        keyPrefix: `${this.queueName}:gq:`,
        groupId,
        jobId,
        score,
        jobDataJson: jobId === stagedJobId ? freshValue : "",
        errorMessage: lastError.message,
        errorStack: handlerError.stack ?? "",
        claimToken: job.claimToken,
      });
      if (outcome === "claim-lost") refusedJobIds.push(jobId);
    }
    if (!deadJobIds.includes(stagedJobId)) {
      await this.scripts.stage({
        stagedJobId,
        groupId,
        dispatchAfterMs: score,
        dedupId: "",
        dedupTtlMs: 0,
        jobDataJson: freshValue,
        claimToken: job.claimToken,
      });
    }
    const payloads = job.batchPayloads ?? [payload];
    // A job refused for a lost claim did not die: the recovering worker runs it.
    const deadPayloads = payloads.filter((_, index) => {
      const jobId = batchJobIds[index] ?? stagedJobId;
      return deadJobIds.includes(jobId) && !refusedJobIds.includes(jobId);
    });
    const completed = await this.scripts.complete({
      groupId,
      stagedJobId,
      jobName,
      dropped: true,
      claimToken: job.claimToken,
      // The chain is over for this group: the next job starts with a fresh budget and streak.
      endsRetryChain: true,
      ...listedCandidatesOf(contextMetadata),
    });
    if (!completed) {
      // The recovering worker now owns the group's chain, its failures and its attempt count.
      this.logger.warn(
        {
          queueName: this.queueName,
          groupId,
          stagedJobId,
          deadJobIds,
          refusedJobIds,
          error: lastError,
        },
        "Job exhausted after its claim was recovered by another worker; leaving the group to that worker",
      );
      return { deadPayloads, claimLost: true };
    }
    gqJobsExhaustedTotal.inc(routingLabels);
    this.logger.error(
      {
        queueName: this.queueName,
        groupId,
        stagedJobId,
        deadJobIds,
        error: lastError,
        handlerStack: handlerError === lastError ? undefined : handlerError.stack,
      },
      "Job dead-lettered after exhausted retries; its group drains on",
    );
    return { deadPayloads, claimLost: false };
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

  private async readGroupAttempt(groupId: string): Promise<number> {
    try {
      const raw = await this.redisConnection.get(this.scripts.groupAttemptKey(groupId));
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
        {
          attempt,
          jobIds: entries.map((entry) => entry.stagedJobId),
          ...(dispatch.hasCommitted ? { isContinuation: true } : {}),
        },
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
    // Non-retryable fails the same way at every size. A named retry delay means
    // the server is overloaded: a split re-runs the work on it at once, so the
    // whole batch backs off through the retry path instead.
    // A hand-back is no failure: splitting cannot route a job this worker has no handler for.
    if (err instanceof HandBackGroupQueueError) throw err;
    const decision = this.failureDecision(err);
    if (!decision.retryable || decision.retryAfterMs !== undefined) {
      throw err;
    }

    if (entries.length <= 1) {
      // Smallest attributable unit — report it, then let the existing retry
      // and quarantine path take over.
      if (isNarrowed) dispatch.offender = entries[0]?.stagedJobId;
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

  private async restageDrainedSiblings({
    groupId,
    siblings,
    claimToken,
  }: {
    groupId: string;
    siblings: DrainedJob[];
    claimToken: string;
  }): Promise<void> {
    for (const sibling of siblings) {
      try {
        const { claimLost } = await this.scripts.stage({
          stagedJobId: sibling.stagedJobId,
          groupId,
          // Guarded like every other re-stage. An invalid persisted score such
          // as 0 must heal here instead of being preserved indefinitely.
          dispatchAfterMs: this.restageScore(sibling.originalScore),
          dedupId: "",
          dedupTtlMs: 0,
          jobDataJson: sibling.jobDataJson,
          claimToken,
        });
        if (claimLost) {
          // The recovering worker already put every sibling this claim held back on the group.
          this.logger.warn(
            { queueName: this.queueName, groupId, stagedJobId: sibling.stagedJobId },
            "Drained siblings not re-staged: their claim was recovered by another worker",
          );
          return;
        }
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
          "Failed to publish worker liveness beacon; if this persists, dispatch reclaims this worker's claims and the poison guard counts them as deaths",
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
    claimToken,
    jobDataValues,
    isCancelled,
  }: {
    groupId: string;
    stagedJobId: string;
    claimToken: string;
    jobDataValues: string[];
    /** True once the job's outcome is decided; see `stopHeartbeat`. */
    isCancelled: () => boolean;
  }): ReturnType<typeof setInterval> {
    const intervalMs = activeKeyHeartbeatMs({ activeTtlSec: GROUP_QUEUE_CONFIG.activeTtlSec });
    return setInterval(() => {
      this.scripts
        .refreshActiveKey({
          groupId,
          stagedJobId,
          activeTtlSec: GROUP_QUEUE_CONFIG.activeTtlSec,
          isCancelled,
          claimToken,
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
    claimToken,
    lastError,
    contextMetadata,
    routingLabels,
  }: {
    groupId: string;
    stagedJobId: string;
    payload: Payload;
    originalScore: number;
    claimToken: string;
    lastError: Error | undefined;
    contextMetadata: GroupQueueContextMetadata | undefined;
    routingLabels: Record<string, string>;
  }): Promise<boolean> {
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
    const blocked = await this.scripts.restageAndBlock({
      groupId,
      newStagedJobId,
      score,
      jobDataJson,
      errorMessage: lastError?.message,
      errorStack: handlerError?.stack,
      claimToken,
    });
    if (!blocked) {
      this.logger.warn(
        { queueName: this.queueName, groupId, stagedJobId, error: lastError },
        "Job exhausted its retries after its claim was recovered by another worker; not blocking the group",
      );
      return false;
    }

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
    return true;
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
    claimToken,
    err,
    reason,
    message,
  }: {
    groupId: string;
    stagedJobId: string;
    jobDataJson: string;
    claimToken: string;
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
    const completed = await this.scripts.complete({
      groupId,
      stagedJobId,
      dropped: true,
      claimToken,
    });
    // A recovering worker's job carries this value and its lease; only the owner releases it.
    if (completed) await this.blobLifecycle.releaseLease({ values: [jobDataJson], groupId });
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
    claimToken,
    reason,
    errorMessage,
    lastOwnerState,
  }: {
    groupId: string;
    stagedJobId: string;
    jobDataJson: string;
    originalScore: number;
    claimToken: string;
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
    const parked = await this.scripts.restageAndBlock({
      groupId,
      // Parked under the id it was dispatched under (ADR-080). This used to
      // append a wall-clock marker, which made a parked job impossible to find
      // by the id its producer knows and grew the value on every park.
      newStagedJobId: stagedJobId,
      score,
      jobDataJson,
      errorMessage,
      claimToken,
    });
    if (!parked) {
      this.logger.warn(
        { queueName: this.queueName, groupId, stagedJobId, reason },
        "Poison guard could not park the group: its claim was recovered by another worker",
      );
      return;
    }
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
    claimToken,
    err,
  }: {
    groupId: string;
    stagedJobId: string;
    jobDataJson: string;
    claimToken: string;
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
        claimToken,
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
      claimToken,
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

  /** Stops claiming jobs; claimed ones run to completion. Idempotent; a producer ignores it. */
  pause(): void {
    this.dispatcher?.pause();
  }

  /** Claims again after `pause`, starting with the backlog staged meanwhile. Idempotent. */
  resume(): void {
    this.dispatcher?.resume();
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
      throw new GroupQueueError({
        queueName: this.queueName,
        operation: "registerPreflightGroups",
        message: `Migration preflight refused unresolved group ${unresolved}`,
      });
    }
    if (groupIds.some((groupId) => !groupId)) {
      throw new GroupQueueError({
        queueName: this.queueName,
        operation: "registerPreflightGroups",
        message: "Migration preflight refused a pipeline with custom group routing",
      });
    }
    if (!key.startsWith(`${this.queueName}:gq:`)) {
      throw new GroupQueueError({
        queueName: this.queueName,
        operation: "registerPreflightGroups",
        message: "Migration preflight refused a dispatch scope outside the canonical queue slot",
      });
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
      throw new GroupQueueError({
        queueName: this.queueName,
        operation: "waitUntilPreflightIdle",
        message: "Queue has no preflight allow-list",
      });
    }
    const unsettled = await this.waitForTargets({
      key,
      timeoutMs: this.preflightDrainTimeoutMs,
      fault: { operation: "waitUntilPreflightIdle", work: "Migration preflight work" },
      onHeld: (state) => this.logHeldFromBefore(state),
    });
    if (unsettled) this.settlePastDrainTimeout(unsettled);
  }

  /**
   * Runs `work` and the jobs it causes on a list a `dispatchListed` consumer runs ahead of any
   * backlog; returns once all have run, else names the failed or blocked groups, or the waiting
   * ones once they stand still for `timeoutMs`. Spec: specs/upgrade/background-steps.feature.
   */
  async runListedWork<Result>({
    name,
    timeoutMs,
    work,
  }: {
    name: string;
    timeoutMs: number;
    work: (list?: ListedRun) => Promise<Result>;
  }): Promise<Result> {
    const listKey = `${this.queueName}:gq:listed:${name}`;
    await this.scripts.openGroupList({ listKey, nowMs: nowInstant().epochMilliseconds });
    try {
      const scope = { ...this.captureContext(), queueDispatchScopeKey: listKey };
      const fault = { operation: "runListedWork", work: `Queue work of ${name}` };
      const list: ListedRun = {
        waitForRoom: ({ maxOutstanding, signal }) =>
          this.waitForListRoom({ name, listKey, timeoutMs, fault, maxOutstanding, signal }),
      };
      const result = await this.runInContext(scope, () => work(list));
      const unsettled = await this.waitForTargets({
        key: listKey,
        timeoutMs,
        fault,
        whileDraining: true,
      });
      if (unsettled) this.refuseUnsettledList({ name, timeoutMs, state: unsettled, fault });
      return result;
    } finally {
      await this.scripts.closeGroupList(listKey);
    }
  }

  /**
   * Holds a listed run's work until at most `maxOutstanding` of its jobs wait or run, so a step
   * sends its next page only once its last has mostly run. Fails as the closing wait does when the
   * count stands still for `timeoutMs`. Spec: specs/upgrade/background-steps.feature.
   */
  private async waitForListRoom({
    name,
    listKey,
    timeoutMs,
    fault,
    maxOutstanding,
    signal,
  }: {
    name: string;
    listKey: string;
    timeoutMs: number;
    fault: TargetsFault;
    maxOutstanding: number;
    signal?: AbortSignal;
  }): Promise<void> {
    let deadline = nowInstant().epochMilliseconds + timeoutMs;
    let lastLook: number | undefined;
    while (!signal?.aborted) {
      const lookStartedMs = nowInstant().epochMilliseconds;
      const outstanding = await this.scripts.countListedOutstanding(listKey);
      if (outstanding <= maxOutstanding) return;
      const nowMs = nowInstant().epochMilliseconds;
      if (outstanding !== lastLook) {
        lastLook = outstanding;
        deadline = nowMs + timeoutMs;
      } else if (nowMs >= deadline) {
        const state = await this.scripts.inspectPreflightTargets(listKey);
        this.refuseUnsettledList({ name, timeoutMs, state, fault });
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(LIST_ROOM_POLL_MS, nowMs - lookStartedMs)),
      );
    }
  }

  /**
   * Polls a list's groups until they settle (undefined) or the deadline passes (their state).
   * `whileDraining` moves the deadline on whenever the outstanding jobs or groups differ from the
   * last look, so only work that stands still for `timeoutMs` runs it out.
   */
  private async waitForTargets({
    key,
    timeoutMs,
    fault,
    onHeld,
    whileDraining = false,
  }: {
    key: string;
    timeoutMs: number;
    fault: TargetsFault;
    onHeld?: (state: PreflightTargetsState) => void;
    whileDraining?: boolean;
  }): Promise<PreflightTargetsState | undefined> {
    let deadline = nowInstant().epochMilliseconds + timeoutMs;
    let reportedHeld = false;
    let lastLook = "";
    while (true) {
      const lookStartedMs = nowInstant().epochMilliseconds;
      const state = await this.scripts.inspectPreflightTargets(key);
      const lookMs = nowInstant().epochMilliseconds - lookStartedMs;
      const look = [state.pending, state.active, state.pendingGroups, ...state.pendingGroupIds];
      if (whileDraining && look.join("\n") !== lastLook) {
        deadline = nowInstant().epochMilliseconds + timeoutMs;
        lastLook = look.join("\n");
      }
      if (!reportedHeld && state.heldFromBefore > 0) {
        reportedHeld = true;
        onHeld?.(state);
      }
      // A blocked group stays blocked until an operator acts: no point waiting it out.
      if (state.blocked > 0) this.assertTargetsSucceeded({ state, fault });
      if (this.targetsHaveSettled({ state, fault })) return undefined;
      if (nowInstant().epochMilliseconds >= deadline) return state;
      // Rest at least as long as the look took, so a paged look holds at most half of Redis.
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(100, lookMs)));
    }
  }

  /** A listed run that stopped draining: a fault is named first, else the work still waiting. */
  private refuseUnsettledList({
    name,
    timeoutMs,
    state,
    fault,
  }: {
    name: string;
    timeoutMs: number;
    state: PreflightTargetsState;
    fault: TargetsFault;
  }): never {
    this.assertTargetsSucceeded({ state, fault });
    const waiting = namedGroups({ groupIds: state.pendingGroupIds, total: state.pendingGroups });
    throw new GroupQueueError({
      queueName: this.queueName,
      operation: "runListedWork",
      message: `Queue work of ${name} stopped draining: its outstanding jobs did not change for ${timeoutMs} ms on queue ${this.queueName} (still waiting: ${waiting})`,
    });
  }

  /**
   * Work that never drained leaves its tenants held for a later pass, so the
   * barrier starts past it; work that FAILED still refuses, because no later
   * pass clears a fault. specs/migration/system-migrations-runner.feature.
   */
  private settlePastDrainTimeout(state: PreflightTargetsState): void {
    this.assertTargetsSucceeded({ state, fault: PREFLIGHT_FAULT });
    this.logger.warn(
      {
        queueName: this.queueName,
        pending: state.pending,
        active: state.active,
        stillWorking: namedGroups({ groupIds: state.pendingGroupIds, total: state.pendingGroups }),
        timeoutMs: this.preflightDrainTimeoutMs,
      },
      "Migration preflight stopped waiting for work that had not drained and is starting anyway; the tenants it covers stay held for a later pass, and these groups are for operator triage",
    );
  }

  /** Throws on the way past when the settled work did not all succeed. */
  private targetsHaveSettled({
    state,
    fault,
  }: {
    state: PreflightTargetsState;
    fault: TargetsFault;
  }): boolean {
    if (state.pending > 0 || state.active > 0 || state.changedDuringInspection) return false;
    this.assertTargetsSucceeded({ state, fault });
    return this.processingQueue.idle();
  }

  /** Groups blocked before the preflight adopted them: booted past, left blocked for triage. */
  private logHeldFromBefore(state: PreflightTargetsState): void {
    this.logger.warn(
      {
        queueName: this.queueName,
        heldFromBefore: state.heldFromBefore,
        heldFromBeforeGroupIds: state.heldFromBeforeGroupIds,
      },
      "Migration preflight is settling past groups that were already blocked before it started; their work is not migrated and they stay blocked for operator triage",
    );
  }

  private assertTargetsSucceeded({
    state,
    fault,
  }: {
    state: PreflightTargetsState;
    fault: TargetsFault;
  }): void {
    if (state.failed === 0 && state.blocked === 0) return;
    const faults: string[] = [];
    if (state.failed > 0)
      faults.push(
        `failed: ${namedGroups({ groupIds: state.failedGroupIds, total: state.failed })}`,
      );
    if (state.blocked > 0) {
      faults.push(
        `blocked: ${namedGroups({ groupIds: state.blockedGroupIds, total: state.blocked })}`,
      );
    }
    throw new GroupQueueError({
      queueName: this.queueName,
      operation: fault.operation,
      message: `${fault.work} did not succeed on queue ${this.queueName} (${faults.join("; ")})`,
    });
  }

  async close(): Promise<void> {
    this.shutdownRequested = true;
    this.adaptiveSlots.stop();
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
                new GroupQueueError({
                  queueName: this.queueName,
                  operation: "close",
                  message: `Shutdown timed out after ${this.shutdownTimeoutMs}ms`,
                }),
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
    // Every job has finished: the latencies still held in process go out now, not on a timer.
    await this.latencyStats.flush();

    if (this.blockingConnection !== this.redisConnection) {
      await this.blockingConnection.quit();
      this.logger.debug({ queueName: this.queueName }, "Blocking connection closed");
    }
  }
}

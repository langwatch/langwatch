/**
 * Read model behind the mobile ops API (`src/server/routes/ops-mobile.ts`).
 *
 * Every method here delegates to a service that already exists — the queue,
 * scheduler, blob-store and replay services, the metrics collector, the anomaly
 * store and the pipeline registry. Nothing in this file re-implements an ops
 * query; it exists so the HTTP routes have a service layer to call instead of
 * reaching for repositories or `getApp()` internals, and so the one place that
 * decides what a phone is allowed to see is a single readable class.
 *
 * Two things it deliberately does NOT expose, because the mobile surface is a
 * monitor rather than a console: anything that mutates the queues (unblock,
 * drain, redrive, pause, DLQ moves) and anything that starts or cancels a
 * projection replay. The only write is the payload-store sweep.
 *
 * Spec: specs/ops/mobile-ops-api.feature
 */
import type { Cluster, Redis as IORedis } from "ioredis";

import { builtInPresets } from "~/components/ops/foundry/presets";
import type { SpanConfig } from "~/components/ops/foundry/types";
import type { OpsDependencies } from "~/server/app-layer/dependencies";
import {
  getEventSubscriberMetadata,
  getProjectionMetadata,
} from "~/server/event-sourcing/pipelineRegistry";
import type { BlobSweepReport } from "~/server/event-sourcing/queues/groupQueue/blobSweeper";
import { type Anomaly, AnomalyStateStore } from "~/server/observability/anomalyState";

import type { OpsScheduledJob } from "./scheduler-ops.service";
import type {
  DashboardData,
  OpsBlobPage,
  OpsBlobSort,
  OpsBlobStoreStats,
  QueueSummaryInfo,
} from "./types";

/**
 * Thrown when the process is running without the ops module — a worker-only
 * role, or an instance that never wired the collector. The route maps it to a
 * 503 with an explanation, so the app can say "not available on this instance"
 * instead of rendering a screen full of zeroes that look like good news.
 */
export class OpsModuleUnavailableError extends Error {
  constructor() {
    super("The ops module is not running on this instance");
    this.name = "OpsModuleUnavailableError";
  }
}

export interface MobileDashboard {
  /**
   * False until the collector has recorded its first cycle. The snapshot is
   * still returned (it reads as all zeroes) but the client must label it rather
   * than present a quiet platform.
   */
  hasSnapshot: boolean;
  snapshot: DashboardData;
}

export interface MobileBadgeCounts {
  blockedCount: number;
  dlqCount: number;
  /** ISO-8601. The badge is memoized server-side; this dates the value. */
  computedAt: string;
}

/**
 * One queued job as a phone sees it: enough to identify it and judge its size,
 * with no customer payload. See {@link MobileOpsService.getGroupJobs}.
 */
export interface MobileJobSummary {
  jobId: string;
  score: number;
  /** Top-level keys of the job payload, sorted. Empty when the job carries none. */
  payloadKeys: string[];
  /** Serialized size of the payload in bytes. */
  payloadBytes: number;
}

export interface MobileDlqGroup {
  queueName: string;
  queueDisplayName: string;
  groupId: string;
  error: string | null;
  errorStack: string | null;
  pipelineName: string | null;
  jobCount: number;
  movedAt: number | null;
}

/**
 * A Foundry preset flattened for a phone: the catalog entry plus a span tree
 * carrying only what a reader needs to understand the shape it would generate.
 * The full `SpanConfig` carries editor state and message bodies that are of no
 * use on a screen that cannot emit a trace.
 */
export interface MobileFoundryPreset {
  id: string;
  name: string;
  description: string;
  /** `service.name` the generated trace would carry, when the preset sets one. */
  serviceName: string | null;
  spanCount: number;
  spans: MobileFoundrySpan[];
}

export interface MobileFoundrySpan {
  name: string;
  type: string;
  durationMs: number;
  status: string;
  model: string | null;
  children: MobileFoundrySpan[];
}

export interface MobileProjectionCatalog {
  projections: ReturnType<typeof getProjectionMetadata>;
  eventSubscribers: ReturnType<typeof getEventSubscriberMetadata>;
}

export class MobileOpsService {
  constructor(
    private readonly ops: OpsDependencies,
    private readonly redis: IORedis | Cluster | null,
  ) {}

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------

  /**
   * The same snapshot the web dashboard renders.
   *
   * `hasSnapshot` is derived from the throughput history rather than a
   * dedicated flag because the collector appends exactly one point per collect
   * cycle: an empty history IS "no cycle has completed", and a second flag
   * tracking the same fact would be one more thing to keep in sync.
   */
  getDashboard(): MobileDashboard {
    const collector = this.ops.metricsCollector;
    if (!collector) throw new OpsModuleUnavailableError();
    const snapshot = collector.getDashboardData();
    return {
      hasSnapshot: snapshot.throughputHistory.length > 0,
      snapshot,
    };
  }

  getBadgeCounts(): MobileBadgeCounts {
    const collector = this.ops.metricsCollector;
    if (!collector) {
      return {
        blockedCount: 0,
        dlqCount: 0,
        computedAt: new Date().toISOString(),
      };
    }
    const counts = collector.getBadgeCounts();
    return {
      blockedCount: counts.blockedCount,
      dlqCount: counts.dlqCount,
      computedAt: counts.computedAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Queues
  // -------------------------------------------------------------------------

  async getQueues(): Promise<QueueSummaryInfo[]> {
    return this.ops.queues.getQueues();
  }

  async getGroups(params: {
    queueName: string;
    page: number;
    pageSize: number;
  }) {
    return this.ops.queues.getGroups(params);
  }

  async getGroupDetail(params: { queueName: string; groupId: string }) {
    return this.ops.queues.getGroupDetail(params);
  }

  /**
   * A group's queued jobs, with each job's payload reduced to its shape.
   *
   * The web surface renders the whole `data` blob because an operator debugging
   * at a desk needs it. A phone does not: the payload is customer content, the
   * screen is small enough that nobody reads it there, and the device is far
   * more likely to be lost than a laptop. Shipping the top-level keys and the
   * serialized size answers "what kind of job is stuck here and how big is it"
   * — which is the question a phone is actually being asked — without putting
   * customer data on it. This is the same line the blob endpoints draw when
   * they return sizes and leases but never bytes.
   */
  async getGroupJobs(params: {
    queueName: string;
    groupId: string;
    page: number;
    pageSize: number;
  }): Promise<{
    jobs: MobileJobSummary[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const result = await this.ops.queues.getGroupJobs(params);
    return {
      ...result,
      jobs: result.jobs.map((job) => ({
        jobId: job.jobId,
        score: job.score,
        payloadKeys: job.data ? Object.keys(job.data).sort() : [],
        payloadBytes: job.data
          ? Buffer.byteLength(JSON.stringify(job.data), "utf8")
          : 0,
      })),
    };
  }

  async getBlockedSummary() {
    return this.ops.queues.getBlockedSummary();
  }

  async getDlqGroups(): Promise<MobileDlqGroup[]> {
    return this.ops.queues.getAllDlqGroups();
  }

  async getPausedKeys(params: { queueName: string }) {
    return this.ops.queues.listPausedKeys(params);
  }

  async getPausedTenants(params: { queueName: string }) {
    return this.ops.queues.listPausedTenants(params);
  }

  // -------------------------------------------------------------------------
  // Anomalies
  // -------------------------------------------------------------------------

  /**
   * Active tenant anomalies, hard tier first and most recent first within a
   * tier — the same ordering the web surface applies, so an operator reading
   * the phone and a colleague reading the browser see the same worst offender
   * at the top.
   */
  async getAnomalies(): Promise<Anomaly[]> {
    if (!this.redis) return [];
    const anomalies = await new AnomalyStateStore(this.redis).list();
    return anomalies.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier === "hard" ? -1 : 1;
      return b.triggeredAt - a.triggeredAt;
    });
  }

  // -------------------------------------------------------------------------
  // Scheduler
  // -------------------------------------------------------------------------

  async getScheduledJobs(params: { limit: number }): Promise<OpsScheduledJob[]> {
    return this.ops.scheduler.listScheduledJobs({ limit: params.limit });
  }

  // -------------------------------------------------------------------------
  // The Foundry
  // -------------------------------------------------------------------------

  /**
   * The built-in preset catalog, read-only.
   *
   * The presets are imported from the web Foundry rather than restated here:
   * they are plain data with no browser dependency, and a second copy would
   * drift the moment someone edits a scenario.
   */
  getFoundryPresets(): MobileFoundryPreset[] {
    return builtInPresets.map((preset) => {
      const spans = preset.config.spans.map(toMobileFoundrySpan);
      return {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        serviceName: preset.config.resourceAttributes["service.name"] ?? null,
        spanCount: spans.reduce(countSpans, 0),
        spans,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Payload store
  // -------------------------------------------------------------------------

  async getBlobStoreStats(): Promise<OpsBlobStoreStats> {
    return this.ops.blobStore.getStats();
  }

  async getBlobs(params: {
    queueName: string;
    cursor?: string | null;
    limit: number;
    projectId?: string | null;
    sort: OpsBlobSort;
  }): Promise<OpsBlobPage> {
    return this.ops.blobStore.getBlobs(params);
  }

  async getBlob(params: {
    queueName: string;
    projectId: string;
    hash: string;
  }) {
    return this.ops.blobStore.getBlobById(params);
  }

  /**
   * The one write on the mobile surface. `dryRun` is the trial an operator runs
   * first: it reports the same per-queue tallies without deleting anything, so
   * the number on the confirmation sheet is the number the sweep produced
   * rather than an estimate computed a second way.
   *
   * `requestedBy` is the caller's opaque user id, never their email — the sweep
   * log must trace the actor without turning the log stream into a PII sink.
   */
  async runBlobSweep(params: {
    dryRun: boolean;
    requestedBy: string;
  }): Promise<BlobSweepReport> {
    return this.ops.blobStore.runCleanup(params);
  }

  // -------------------------------------------------------------------------
  // Projections — readable, never startable
  // -------------------------------------------------------------------------

  getProjections(): MobileProjectionCatalog {
    return {
      projections: getProjectionMetadata(),
      eventSubscribers: getEventSubscriberMetadata(),
    };
  }

  async getReplayStatus() {
    return this.ops.replay.getStatus();
  }

  async getReplayHistory() {
    return this.ops.replay.getHistory();
  }

  async getReplayRun(params: { runId: string }) {
    return this.ops.replay.findHistoryEntry(params);
  }
}

function toMobileFoundrySpan(span: SpanConfig): MobileFoundrySpan {
  return {
    name: span.name,
    type: span.type,
    durationMs: span.durationMs,
    status: span.status,
    model: span.llm?.requestModel ?? null,
    children: (span.children ?? []).map(toMobileFoundrySpan),
  };
}

function countSpans(total: number, span: MobileFoundrySpan): number {
  return span.children.reduce(countSpans, total + 1);
}

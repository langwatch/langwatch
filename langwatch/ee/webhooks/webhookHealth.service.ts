// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@prisma/client";
import type {
  OutboxMessageRecord,
  PersistedProcessInstance,
  ProcessStore,
} from "~/server/event-sourcing/process-manager/stores/processStore.types";
import {
  type EndpointStreamState,
  WEBHOOK_DELIVERY_PROCESS_NAME,
} from "./process-manager/webhookDelivery.process";
import {
  WebhookEndpointNotFoundError,
  type WebhookEndpointService,
} from "./webhookEndpoint.service";

/** The last-hour window the rate figures aggregate over. */
const RATE_WINDOW_MS = 60 * 60 * 1000;
/** Latency percentile sample cap: enough for a stable p95, bounded read. */
const LATENCY_SAMPLE_LIMIT = 500;
/** Per-chunk cap on the concurrent process-stream reads across projects. */
const STREAM_READ_CONCURRENCY = 8;

export interface WebhookEndpointHealth {
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  failingSince: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  /**
   * The headline number: how stale the endpoint's feed is. Age of the
   * oldest envelope that has not completed delivery, whether it is still
   * coalescing in the stream buffer or riding outbox retries. Null when
   * everything produced has been delivered.
   */
  oldestUndeliveredAgeMs: number | null;
  /** Batches that exhausted the retry ladder and await manual requeue. */
  dlqDepth: number;
  sendsPerMinute: number;
  /** Delivered / attempted over the window; null with no attempts. */
  successRate: number | null;
  p95LatencyMs: number | null;
}

export interface WebhookHealthDeps {
  prisma: PrismaClient;
  endpoints: Pick<
    WebhookEndpointService,
    "getStatusSnapshot" | "getDeliveryStats"
  >;
  processStore: ProcessStore;
  now?: () => number;
}

/** The stream-side backlog: batches that exhausted the retry ladder, and
 *  the arrival instant of the oldest envelope that has not completed
 *  delivery. Null when everything produced has been delivered. */
interface StreamBacklog {
  dlqDepth: number;
  oldestUndeliveredMs: number | null;
}

/** One project's stream for the endpoint: the coalescing buffer and the
 *  outbox messages it has produced. */
interface EndpointStreamRead {
  instance: PersistedProcessInstance<EndpointStreamState> | null;
  messages: OutboxMessageRecord[];
}

/** The earlier of two optional instants; null only when both are. */
function earlierInstant(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** One project's contribution to the backlog: envelopes still coalescing
 *  in the stream buffer, sends still riding outbox retries, and batches
 *  that exhausted the ladder. */
function backlogOfStream(read: EndpointStreamRead): StreamBacklog {
  let dlqDepth = 0;
  let oldestUndeliveredMs: number | null = null;
  for (const entry of read.instance?.state.pending ?? []) {
    oldestUndeliveredMs = earlierInstant(
      oldestUndeliveredMs,
      entry.appendedAtMs,
    );
  }
  for (const message of read.messages) {
    if (message.intentType !== "sendBatch") continue;
    if (message.status === "dead") dlqDepth++;
    if (message.status === "pending") {
      oldestUndeliveredMs = earlierInstant(
        oldestUndeliveredMs,
        message.createdAt,
      );
    }
  }
  return { dlqDepth, oldestUndeliveredMs };
}

/** The p95 of a latency sample, by nearest-rank on the sorted values. */
function p95Of(latencies: readonly number[]): number | null {
  const sorted = [...latencies].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

/**
 * Aggregates one endpoint's delivery health across its three substrates:
 * the endpoint row (streak, status), the delivery log (rates, latency),
 * and the process streams (buffered lag, outbox retries, DLQ). Streams are
 * per project, so the read fans across the organization's projects.
 */
export class WebhookHealthService {
  constructor(private readonly deps: WebhookHealthDeps) {}

  async health(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointHealth> {
    const now = (this.deps.now ?? Date.now)();
    const endpoint = await this.deps.endpoints.getStatusSnapshot({
      organizationId: params.organizationId,
      endpointId: params.endpointId,
    });
    if (!endpoint) throw new WebhookEndpointNotFoundError();

    const [stats, projects] = await Promise.all([
      this.deps.endpoints.getDeliveryStats({
        organizationId: params.organizationId,
        endpointId: params.endpointId,
        since: new Date(now - RATE_WINDOW_MS),
        sampleLimit: LATENCY_SAMPLE_LIMIT,
      }),
      this.deps.prisma.project.findMany({
        where: { team: { organizationId: params.organizationId } },
        select: { id: true },
        orderBy: { id: "asc" },
      }),
    ]);

    const { dlqDepth, oldestUndeliveredMs } = await this.streamBacklog({
      endpointId: params.endpointId,
      projectIds: projects.map((project) => project.id),
    });

    const { attempted, delivered } = stats;
    return {
      status: endpoint.status,
      disabledReason: endpoint.disabledReason,
      failingSince: endpoint.failingSince,
      lastSuccessAt: endpoint.lastSuccessAt,
      lastFailureAt: endpoint.lastFailureAt,
      oldestUndeliveredAgeMs:
        oldestUndeliveredMs === null
          ? null
          : Math.max(0, now - oldestUndeliveredMs),
      dlqDepth,
      sendsPerMinute: attempted / (RATE_WINDOW_MS / 60_000),
      successRate: attempted === 0 ? null : delivered / attempted,
      p95LatencyMs: p95Of(stats.latencies),
    };
  }

  /**
   * The endpoint's backlog summed across the organization's projects.
   * Streams are per project; they are read in bounded chunks so a large
   * organization costs a few concurrent rounds, not one serial round trip
   * per project.
   */
  private async streamBacklog(params: {
    endpointId: string;
    projectIds: string[];
  }): Promise<StreamBacklog> {
    const total: StreamBacklog = { dlqDepth: 0, oldestUndeliveredMs: null };
    for (
      let i = 0;
      i < params.projectIds.length;
      i += STREAM_READ_CONCURRENCY
    ) {
      const chunk = params.projectIds.slice(i, i + STREAM_READ_CONCURRENCY);
      const reads = await Promise.all(
        chunk.map((projectId) =>
          this.readStream({ projectId, endpointId: params.endpointId }),
        ),
      );
      for (const read of reads) {
        const backlog = backlogOfStream(read);
        total.dlqDepth += backlog.dlqDepth;
        total.oldestUndeliveredMs = earlierInstant(
          total.oldestUndeliveredMs,
          backlog.oldestUndeliveredMs,
        );
      }
    }
    return total;
  }

  private async readStream(params: {
    projectId: string;
    endpointId: string;
  }): Promise<EndpointStreamRead> {
    const ref = {
      processName: WEBHOOK_DELIVERY_PROCESS_NAME,
      projectId: params.projectId,
      processKey: `endpoint:${params.endpointId}`,
    };
    const [instance, messages] = await Promise.all([
      this.deps.processStore.findByRef<EndpointStreamState>({ ref }),
      this.deps.processStore.findMessagesByRef({ ref }),
    ]);
    return { instance, messages };
  }
}

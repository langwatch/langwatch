// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@prisma/client";
import type { ProcessStore } from "~/server/event-sourcing/process-manager/stores/processStore.types";
import {
  WEBHOOK_DELIVERY_PROCESS_NAME,
  type EndpointStreamState,
} from "./process-manager/webhookDelivery.process";
import { WebhookEndpointNotFoundError } from "./webhookEndpoint.service";

/** The last-hour window the rate figures aggregate over. */
const RATE_WINDOW_MS = 60 * 60 * 1000;
/** Latency percentile sample cap: enough for a stable p95, bounded read. */
const LATENCY_SAMPLE_LIMIT = 500;

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
  processStore: ProcessStore;
  now?: () => number;
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
    const endpoint = await this.deps.prisma.webhookEndpoint.findFirst({
      where: {
        id: params.endpointId,
        organizationId: params.organizationId,
        archivedAt: null,
      },
    });
    if (!endpoint) throw new WebhookEndpointNotFoundError();

    const [deliveries, projects] = await Promise.all([
      this.deps.prisma.webhookEndpointDelivery.findMany({
        where: {
          organizationId: params.organizationId,
          endpointId: params.endpointId,
          firedAt: { gt: new Date(now - RATE_WINDOW_MS) },
        },
        select: { outcome: true, latencyMs: true },
        orderBy: { firedAt: "desc" },
        take: LATENCY_SAMPLE_LIMIT,
      }),
      this.deps.prisma.project.findMany({
        where: { team: { organizationId: params.organizationId } },
        select: { id: true },
      }),
    ]);

    let dlqDepth = 0;
    let oldestUndeliveredMs: number | null = null;
    const consider = (candidateMs: number) => {
      oldestUndeliveredMs =
        oldestUndeliveredMs === null
          ? candidateMs
          : Math.min(oldestUndeliveredMs, candidateMs);
    };
    for (const project of projects) {
      const ref = {
        processName: WEBHOOK_DELIVERY_PROCESS_NAME,
        projectId: project.id,
        processKey: `endpoint:${params.endpointId}`,
      };
      const [instance, messages] = await Promise.all([
        this.deps.processStore.findByRef<EndpointStreamState>({ ref }),
        this.deps.processStore.findMessagesByRef({ ref }),
      ]);
      for (const entry of instance?.state.pending ?? []) {
        consider(entry.appendedAtMs);
      }
      for (const message of messages) {
        if (message.intentType !== "sendBatch") continue;
        if (message.status === "dead") dlqDepth++;
        if (message.status === "pending") consider(message.createdAt);
      }
    }

    const attempted = deliveries.length;
    const delivered = deliveries.filter((d) => d.outcome === "success").length;
    const latencies = deliveries
      .map((d) => d.latencyMs)
      .filter((l): l is number => l !== null)
      .sort((a, b) => a - b);
    const p95 =
      latencies.length > 0
        ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]!
        : null;

    return {
      status: endpoint.status,
      disabledReason: endpoint.disabledReason,
      failingSince: endpoint.failingSince,
      lastSuccessAt: endpoint.lastSuccessAt,
      lastFailureAt: endpoint.lastFailureAt,
      oldestUndeliveredAgeMs:
        oldestUndeliveredMs === null ? null : Math.max(0, now - oldestUndeliveredMs),
      dlqDepth,
      sendsPerMinute: attempted / (RATE_WINDOW_MS / 60_000),
      successRate: attempted === 0 ? null : delivered / attempted,
      p95LatencyMs: p95,
    };
  }
}

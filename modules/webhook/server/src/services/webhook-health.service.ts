// SPDX-License-Identifier: Apache-2.0

import type {
  OutboxMessageRecord,
  PersistedProcessInstance,
  ProcessStore,
} from "@langwatch/eventing";
import {
  WebhookEndpointNotFoundError,
  type WebhookEndpointHealth,
} from "@langwatch/webhook-contract";
import {
  type EndpointStreamState,
  WEBHOOK_DELIVERY_PROCESS_NAME,
} from "../rules/webhook-delivery-contract.rules.ts";
import { Temporal, toDate, type Instant } from "@langwatch/time";

/** The last-hour window the rate figures aggregate over. */
const RATE_WINDOW_MS = 60 * 60 * 1000;
/** Latency percentile sample cap: enough for a stable p95, bounded read. */
const LATENCY_SAMPLE_LIMIT = 500;

export interface WebhookEndpointHealthSource {
  findStatusSnapshot(input: { organizationId: string; endpointId: string }): Promise<{
    status: "ACTIVE" | "DISABLED";
    disabledReason: string | null;
    failingSince: Instant | null;
    lastSuccessAt: Instant | null;
    lastFailureAt: Instant | null;
  } | null>;
  getDeliveryStats(input: {
    organizationId: string;
    endpointId: string;
    since: Instant;
    sampleLimit: number;
  }): Promise<{ attempted: number; delivered: number; latencies: number[] }>;
}

export interface WebhookHealthDeps {
  endpoints: WebhookEndpointHealthSource;
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

/** The endpoint's stream: the coalescing buffer and the outbox messages
 *  it has produced. */
interface EndpointStreamRead {
  instance: PersistedProcessInstance<EndpointStreamState> | null;
  messages: OutboxMessageRecord[];
}

/**
 * Aggregates one endpoint's delivery health across its three substrates:
 * the endpoint row (streak, status), the delivery log (rates, latency),
 * and the process stream (buffered lag, outbox retries, DLQ). The stream
 * is the endpoint's own, at organization scope, so this is one read.
 */
export class WebhookHealthService {
  private constructor(private readonly deps: WebhookHealthDeps) {
  }

  static create(deps: WebhookHealthDeps): WebhookHealthService {
    return new WebhookHealthService(deps);
  }

  async health(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<WebhookEndpointHealth> {
    const now = (this.deps.now ?? Date.now)();
    const endpoint = await this.deps.endpoints.findStatusSnapshot({
      organizationId: params.organizationId,
      endpointId: params.endpointId,
    });
    if (!endpoint) {
      throw new WebhookEndpointNotFoundError();
    }

    const stats = await this.deps.endpoints.getDeliveryStats({
      organizationId: params.organizationId,
      endpointId: params.endpointId,
      since: Temporal.Instant.fromEpochMilliseconds(now - RATE_WINDOW_MS),
      sampleLimit: LATENCY_SAMPLE_LIMIT,
    });

    const { dlqDepth, oldestUndeliveredMs } = WebhookHealthService.backlogOfStream(
      await this.readStream({
        organizationId: params.organizationId,
        endpointId: params.endpointId,
      }),
    );

    const { attempted, delivered } = stats;

    return {
      status: endpoint.status,
      disabledReason: endpoint.disabledReason,
      failingSince: endpoint.failingSince === null ? null : toDate(endpoint.failingSince),
      lastSuccessAt: endpoint.lastSuccessAt === null ? null : toDate(endpoint.lastSuccessAt),
      lastFailureAt: endpoint.lastFailureAt === null ? null : toDate(endpoint.lastFailureAt),
      oldestUndeliveredAgeMs:
        oldestUndeliveredMs === null ? null : Math.max(0, now - oldestUndeliveredMs),
      dlqDepth,
      sendsPerMinute: attempted / (RATE_WINDOW_MS / 60_000),
      successRate: attempted === 0 ? null : delivered / attempted,
      p95LatencyMs: WebhookHealthService.p95Of(stats.latencies),
    };
  }

  private async readStream(params: {
    organizationId: string;
    endpointId: string;
  }): Promise<EndpointStreamRead> {
    const ref = {
      processName: WEBHOOK_DELIVERY_PROCESS_NAME,
      projectId: params.organizationId,
      processKey: `endpoint:${params.endpointId}`,
    };
    const [instance, messages] = await Promise.all([
      this.deps.processStore.findByRef<EndpointStreamState>({ ref }),
      this.deps.processStore.findMessagesByRef({ ref }),
    ]);

    return { instance, messages };
  }

  /** The earlier of two optional instants; null only when both are. */
  private static earlierInstant(a: number | null, b: number | null): number | null {
    if (a === null) {
      return b;
    }

    if (b === null) {
      return a;
    }

    return Math.min(a, b);
  }

  /** The backlog: envelopes still coalescing in the stream buffer, sends
   *  still riding outbox retries, and batches that exhausted the ladder. */
  private static backlogOfStream(read: EndpointStreamRead): StreamBacklog {
    let dlqDepth = 0;
    let oldestUndeliveredMs: number | null = null;
    for (const entry of read.instance?.state.pending ?? []) {
      oldestUndeliveredMs = WebhookHealthService.earlierInstant(
        oldestUndeliveredMs,
        entry.appendedAtMs,
      );
    }

    for (const message of read.messages) {
      if (message.intentType !== "sendBatch") {
        continue;
      }

      if (message.status === "dead") {
        dlqDepth++;
      }

      if (message.status === "pending") {
        oldestUndeliveredMs = WebhookHealthService.earlierInstant(
          oldestUndeliveredMs,
          message.createdAt,
        );
      }
    }

    return { dlqDepth, oldestUndeliveredMs };
  }

  /** The p95 of a latency sample, by nearest-rank on the sorted values. */
  private static p95Of(latencies: readonly number[]): number | null {
    const sorted = [...latencies].sort((a, b) => a - b);
    if (sorted.length === 0) {
      return null;
    }

    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
  }
}

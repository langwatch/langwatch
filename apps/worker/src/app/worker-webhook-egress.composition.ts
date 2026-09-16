import type { WebhookDeliveryTransport } from "@langwatch/automation-server";
import {
  InMemoryWebhookDispatchRateLimiterAdapter,
  WebhookDispatchRateLimiter,
  WebhookEgressService,
  type WebhookDispatchRateLimitResult,
} from "@langwatch/egress";
import type { RedisConnection } from "@langwatch/redis-client";
import { WorkerWebhookDeliveryTransportAdapter } from "../features/automation/webhook-delivery.transport.adapter.ts";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import { nowInstant } from "@langwatch/time";

/**
 * The SSRF-fenced outbound sender for webhook delivery. Webhook URLs are the one
 * outbound address customers can point at private networks, so this composition
 * uses strict address fencing and no new configuration.
 */
export type WorkerWebhookEgressCompositionOptions = Readonly<{
  config: WorkerConfig;
  /**
   * The shared Redis counter for the hourly dispatch cap. Absent falls back to a
   * per-process counter, bounding the burst per pod rather than per fleet.
   */
  redis?: RedisConnection | null;
}>;

/**
 * The counter the hourly dispatch cap is kept in, composed on its own. Named
 * separately because not every outbound hop passes through the sender: a
 * queue-delivered webhook must share the SAME counter or go uncapped.
 */
export function createWorkerWebhookDispatchRateLimiter(
  options: WorkerWebhookEgressCompositionOptions,
): WebhookDispatchRateLimiter {
  return options.redis
    ? new WorkerWebhookDispatchRateLimiter(options.redis)
    : InMemoryWebhookDispatchRateLimiterAdapter.create();
}

/**
 * The one fenced sender this process holds, composed once and shared: an
 * automation's alert and an ENDPOINT's delivery share one dispatch ceiling
 * and address policy, so two counters could let either exhaust the other's budget.
 */
export function createWorkerWebhookEgress(
  options: WorkerWebhookEgressCompositionOptions & {
    /** The process's own counter, where one has already been composed. */
    rateLimiter?: WebhookDispatchRateLimiter;
  },
): WebhookEgressService {
  return WebhookEgressService.create({
    rateLimiter: options.rateLimiter ?? createWorkerWebhookDispatchRateLimiter(options),
    // The application ties certificate verification to IS_SAAS, not to its
    // address policy, because an on-prem receiver frequently carries a
    // self-signed certificate while private addresses stay refused. Reading
    // the same leaf keeps a self-hosted receiver reachable from both graphs.
    tls: { rejectUnauthorized: options.config.deployment.saas },
  });
}

export function createWorkerWebhookTransport(
  options: WorkerWebhookEgressCompositionOptions & { egress?: WebhookEgressService },
): WebhookDeliveryTransport {
  return WorkerWebhookDeliveryTransportAdapter.create(
    options.egress ?? createWorkerWebhookEgress(options),
  );
}

/**
 * The dispatch cap counted in the Redis this process already holds. A frozen
 * twin of `platform/app/src/server/rateLimit.ts`'s Redis branch, down to the
 * key prefix — a different key here spends a budget the other was protecting.
 */
class WorkerWebhookDispatchRateLimiter extends WebhookDispatchRateLimiter {
  constructor(private readonly connection: RedisConnection) {
    super();
  }

  async limit({
    key,
    windowSeconds,
    max,
  }: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<WebhookDispatchRateLimitResult> {
    const now = nowInstant().epochMilliseconds;
    const redisKey = `langwatch:ratelimit:${key}`;
    const count = await this.connection.incr(redisKey);
    if (count === 1) {
      await this.connection.expire(redisKey, windowSeconds);
    }
    const ttl = await this.connection.ttl(redisKey);
    const resetAt = now + (ttl > 0 ? ttl : windowSeconds) * 1000;

    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetAt,
    };
  }
}

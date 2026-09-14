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
 * The counter the hourly dispatch cap is kept in, composed on its own.
 *
 * Named separately from the sender because not every outbound hop passes
 * through the sender: a webhook endpoint that delivers to a queue is put on
 * that queue directly, so the queue transport has to be handed the SAME
 * counter or it would be the one uncapped destination in the product.
 */
export function createWorkerWebhookDispatchRateLimiter(
  options: WorkerWebhookEgressCompositionOptions,
): WebhookDispatchRateLimiter {
  return options.redis
    ? new WorkerWebhookDispatchRateLimiter(options.redis)
    : InMemoryWebhookDispatchRateLimiterAdapter.create();
}

/**
 * The one fenced sender this process holds.
 *
 * Composed once and shared, because both outbound surfaces — an automation's
 * webhook alert and a webhook ENDPOINT's delivery — count against the same
 * dispatch ceiling and answer to the same address policy. Two services over
 * two counters would let one surface exhaust a budget the other cannot see.
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
 * The dispatch cap counted in the Redis this process already holds.
 *
 * A frozen twin of the Redis branch of `platform/app/src/server/rateLimit.ts`,
 * down to the key prefix: both graphs count into ONE keyspace while the
 * pipelines are twinned, and a process counting under a different key spends a
 * budget the other was protecting.
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

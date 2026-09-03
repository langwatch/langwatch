import type { WebhookDeliveryTransport } from "@langwatch/automation-server";
import {
  InMemoryWebhookDispatchRateLimiterAdapter,
  WebhookDispatchRateLimiterPort,
  WebhookEgressService,
  type WebhookDispatchRateLimitResult,
} from "@langwatch/egress";
import type { RedisConnection } from "@langwatch/redis-client";
import { WorkerWebhookDeliveryTransportAdapter } from "../features/automation/webhook-delivery.transport.adapter";
import type { WorkerConfig } from "../platform/config/worker.config";

/**
 * The SSRF-fenced outbound sender this process reaches customer-supplied
 * webhook destinations through.
 *
 * A webhook URL is the one outbound address in the product a customer can point
 * at our own private network, so nothing about this composition is a default:
 * the address fence is the strict one, the TLS answer is the deployment's, and
 * the hourly dispatch cap counts in whatever counter this process shares.
 *
 * It composes with no new configuration. Both leaves it needs are already read:
 * `IS_SAAS` (as `deployment.saas`) decides whether TLS certificates are
 * verified, exactly as it does in the application, and the Redis this process
 * already opened is where the cap is counted.
 */
export type WorkerWebhookEgressCompositionOptions = Readonly<{
  config: WorkerConfig;
  /**
   * The shared Redis the hourly dispatch cap counts in.
   *
   * Absent falls back to a per-process counter, which is the application's own
   * behaviour when its Redis is down: a ceiling enforced per pod rather than per
   * fleet, so the burst is larger than intended but still bounded. It is not a
   * fail-open — a cap that stopped refusing is how one automation becomes an
   * outbound flood.
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
): WebhookDispatchRateLimiterPort {
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
    rateLimiter?: WebhookDispatchRateLimiterPort;
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
class WorkerWebhookDispatchRateLimiter extends WebhookDispatchRateLimiterPort {
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
    const now = Date.now();
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

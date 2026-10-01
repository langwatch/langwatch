import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import {
  BROADCAST_BUCKET_STALE_MS,
  type BroadcastRateTier,
  type BroadcastTokenBucket,
  consumeBroadcastToken,
} from "../../rules/broadcast-rate-limit.rules.ts";
import {
  ScenarioEventBroadcast,
  type ScenarioEventBroadcastMessage,
} from "../scenario-event-broadcast.channel.ts";

/** The one Redis operation a publish needs; a `Redis`, a `Cluster` and a double all satisfy it. */
export type ScenarioEventBroadcastPublisher = Readonly<{
  publish(channel: string, message: string): Promise<number>;
}>;

const logger = createLogger("langwatch:scenarios:event-broadcast");

/**
 * Publishes onto main's tenant channel (`broadcast:<eventType>`, body `{ tenantId, event,
 * timestamp }`); the process's broadcast subscriber relays it to the tenant's open tabs.
 */
export class RedisScenarioEventBroadcastChannel extends ScenarioEventBroadcast {
  static create(publisher: ScenarioEventBroadcastPublisher): RedisScenarioEventBroadcastChannel {
    return new RedisScenarioEventBroadcastChannel(publisher);
  }

  readonly #buckets = new Map<string, BroadcastTokenBucket>();
  #lastSweepMs = 0;

  private constructor(private readonly publisher: ScenarioEventBroadcastPublisher) {
    super();
  }

  async broadcastToTenant({
    projectId,
    message,
    eventType,
  }: ScenarioEventBroadcastMessage): Promise<void> {
    const body = JSON.stringify({
      tenantId: projectId,
      event: message,
      timestamp: nowInstant().epochMilliseconds,
    });
    try {
      await this.publisher.publish(`broadcast:${eventType}`, body);
    } catch (error) {
      logger.error(
        { projectId, eventType, error: error instanceof Error ? error.message : String(error) },
        "Could not publish a simulation update; open tabs refresh on their next refetch",
      );
    }
  }

  async broadcastToTenantRateLimited({
    tier,
    ...published
  }: ScenarioEventBroadcastMessage & { tier: BroadcastRateTier }): Promise<boolean> {
    if (!this.#consume(published.projectId, tier)) return false;
    await this.broadcastToTenant(published);
    return true;
  }

  #consume(projectId: string, tier: BroadcastRateTier): boolean {
    const nowMs = nowInstant().epochMilliseconds;
    this.#sweep(nowMs);
    const key = `${projectId}:${tier}`;
    const { allowed, bucket } = consumeBroadcastToken({
      bucket: this.#buckets.get(key),
      tier,
      nowMs,
    });
    this.#buckets.set(key, bucket);
    if (!allowed) logger.warn({ projectId, tier }, "broadcast rate limit hit for tenant");
    return allowed;
  }

  #sweep(nowMs: number): void {
    if (nowMs - this.#lastSweepMs < BROADCAST_BUCKET_STALE_MS) return;
    this.#lastSweepMs = nowMs;
    for (const [key, bucket] of this.#buckets) {
      if (nowMs - bucket.lastAccessMs >= BROADCAST_BUCKET_STALE_MS) this.#buckets.delete(key);
    }
  }
}

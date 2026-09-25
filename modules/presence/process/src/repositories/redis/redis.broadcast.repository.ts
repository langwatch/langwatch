import { EventEmitter } from "events";

import { createLogger } from "@langwatch/observability";
import { BroadcasterNotActiveError } from "@langwatch/presence-contract";
import { nowInstant } from "@langwatch/time";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import type { PresenceBroadcast, PresenceEmitter } from "../../app/presence.app.ts";
import { BroadcastTenantRateLimiterAdapter } from "../../services/broadcast-tenant-rate-limiter.service.ts";

export type BroadcastEventType =
  | "trace_updated"
  | "simulation_updated"
  | "export_progress"
  | "presence_updated"
  | "presence_cursor"
  // Fires when a tenant's `discover` snapshot is warm in Redis; the client
  // invalidates its query cache and refetches via tRPC. Payload is empty.
  | "discover_updated"
  // Fires when a Langy conversation's fold projection advances (ADR-046). The
  // panel subscribes and cancels + invalidates its slim conversation list /
  // detail queries, refetching the projection — the signal carries only the
  // conversation id, never message content.
  | "langy_conversation_updated"
  // Fires when an experiment's workbench state is saved through the service
  // seam, whoever wrote it: a person, the agent, or an API caller. The payload
  // carries the experiment id, slug and new version only — clients refetch, so
  // no workbench state rides the tenant-wide channel.
  | "experiment_updated";

const ALL_EVENT_TYPES: BroadcastEventType[] = [
  "trace_updated",
  "simulation_updated",
  "export_progress",
  "presence_updated",
  "presence_cursor",
  "discover_updated",
  "langy_conversation_updated",
  "experiment_updated",
];

function redisChannel(eventType: BroadcastEventType): string {
  return `broadcast:${eventType}`;
}

export class RedisBroadcastRepository implements PresenceBroadcast, PresenceEmitter {
  private static readonly DRAIN_DELAY_MS = 2000;

  private eventEmitters = new Map<string, EventEmitter>();
  private subscriber: IORedis | Cluster | null = null;
  private readonly logger = createLogger("langwatch:broadcast-service");
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly EMITTER_CLEANUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private emitterEmptyTimes = new Map<string, number>(); // tenantId -> empty time
  private active = false;
  private readonly senderRateLimiter = new BroadcastTenantRateLimiterAdapter();
  private readonly subscriberRateLimiter = new BroadcastTenantRateLimiterAdapter();
  private closed = false;

  static create(redis: Cluster | IORedis | null): RedisBroadcastRepository {
    return new RedisBroadcastRepository(redis);
  }

  private constructor(private readonly redis: Cluster | IORedis | null) {}

  /** Activates Redis delivery and stale-emitter cleanup when the host starts serving. */
  async start(): Promise<void> {
    if (this.active || this.closed) return;
    this.senderRateLimiter.start();
    this.subscriberRateLimiter.start();
    this.subscriber = this.redis?.duplicate() ?? null;
    try {
      await this.setupRedisSubscription();
      this.startCleanupInterval();
      this.active = true;
    } catch (error) {
      this.senderRateLimiter.destroy();
      this.subscriberRateLimiter.destroy();
      const subscriber = this.subscriber;
      this.subscriber = null;
      if (subscriber) await subscriber.quit();
      throw error;
    }
  }

  async publish(input: {
    projectId: string;
    event: string;
    channel: "presence_updated" | "presence_cursor";
    rateLimited: boolean;
  }): Promise<void> {
    if (input.rateLimited) {
      await this.broadcastToTenantRateLimited(input.projectId, input.event, input.channel, "delta");
      return;
    }
    await this.broadcastToTenant(input.projectId, input.event, input.channel);
  }

  private setupRedisSubscription(): Promise<void> {
    if (!this.subscriber) {
      this.logger.warn("Redis not available, SSE broadcasting disabled");
      return Promise.resolve();
    }

    const channels = ALL_EVENT_TYPES.map(redisChannel);
    this.subscriber.on("message", (channel, message) => {
      const eventType = ALL_EVENT_TYPES.find((et) => redisChannel(et) === channel);
      if (!eventType) return;

      try {
        const { tenantId, event } = JSON.parse(message);
        this.logger.debug({ tenantId, event, eventType }, "Received SSE broadcast via Redis");

        const tier = this.classifyEventTier(event);
        if (!this.subscriberRateLimiter.consume(tenantId, tier)) return;

        this.broadcastToTenantLocally(tenantId, event, eventType);
      } catch (error) {
        this.logger.error({ error, message }, "Failed to parse SSE broadcast message");
      }
    });

    this.subscriber.on("error", (error) => {
      this.logger.error({ error }, "Redis subscriber error");
    });

    return new Promise((resolve, reject) => {
      // The callback already reports success/failure to this Promise; the
      // Promise ioredis also returns from subscribe() is redundant here and
      // is only discarded to avoid an unrelated unhandled rejection.
      void this.subscriber
        ?.subscribe(...channels, (err, count) => {
          if (err) {
            this.logger.error({ error: err }, "Failed to subscribe to SSE channels");
            reject(err);
            return;
          }
          this.logger.debug({ subscriberCount: count, channels }, "Subscribed to SSE channels");
          resolve();
        })
        .catch(() => {});
    });
  }

  private startCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleEmitters();
    }, 60 * 1000);
  }

  private cleanupStaleEmitters() {
    const now = nowInstant().epochMilliseconds;
    let cleanedCount = 0;

    for (const [tenantId, emitter] of this.eventEmitters.entries()) {
      const listenerCount = this.emitterListenerCount(emitter);

      if (listenerCount === 0) {
        if (!this.emitterEmptyTimes.has(tenantId)) {
          this.emitterEmptyTimes.set(tenantId, now);
        } else {
          const emptySince = this.emitterEmptyTimes.get(tenantId)!;
          if (now - emptySince >= this.EMITTER_CLEANUP_TIMEOUT_MS) {
            this.eventEmitters.delete(tenantId);
            this.emitterEmptyTimes.delete(tenantId);
            cleanedCount++;
          }
        }
      } else {
        this.emitterEmptyTimes.delete(tenantId);
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug({ cleanedCount }, "Cleaned up stale EventEmitters after timeout");
    }
  }

  /** Sum listener count across all event types for a single emitter. */
  private emitterListenerCount(emitter: EventEmitter): number {
    let total = 0;
    for (const et of ALL_EVENT_TYPES) {
      total += emitter.listenerCount(et);
    }
    return total;
  }

  async broadcastToTenant(
    tenantId: string,
    event: string,
    eventType: BroadcastEventType = "trace_updated",
  ): Promise<void> {
    if (!this.active) throw new BroadcasterNotActiveError();

    // When Redis is available, publish to Redis only — the subscriber
    // (including on this same server) handles local emission so each
    // event is emitted exactly once. Without Redis, emit directly.
    if (!this.redis) {
      this.broadcastToTenantLocally(tenantId, event, eventType);
      return;
    }

    try {
      await this.redis.publish(
        redisChannel(eventType),
        JSON.stringify({
          tenantId,
          event,
          timestamp: nowInstant().epochMilliseconds,
        }),
      );

      this.logger.debug({ tenantId, event, eventType }, "Published SSE event to Redis");
    } catch (error) {
      this.logger.error(
        { error, tenantId, event, eventType },
        "Failed to publish SSE event to Redis, falling back to local",
      );
      // Fallback: emit locally if Redis publish fails
      this.broadcastToTenantLocally(tenantId, event, eventType);
    }
  }

  /**
   * Rate-limited variant of broadcastToTenant. Checks the sender-side token bucket before
   * publishing. Returns `false` (and silently drops the event) when the per-tenant per-tier
   * bucket is exhausted, preventing upstream overload on high-frequency delta streams.
   */
  async broadcastToTenantRateLimited(
    tenantId: string,
    event: string,
    eventType: BroadcastEventType = "trace_updated",
    tier: "structural" | "delta" = "structural",
  ): Promise<boolean> {
    if (!this.active) throw new BroadcasterNotActiveError();
    if (!this.senderRateLimiter.consume(tenantId, tier)) {
      return false;
    }
    await this.broadcastToTenant(tenantId, event, eventType);
    return true;
  }

  /** Classify a serialised event payload into a rate-limit tier. */
  private classifyEventTier(event: string): "structural" | "delta" {
    if (event.includes('"e":"C"') || event.includes('"e":"TOOL_CALL_ARGS"')) {
      return "delta";
    }
    return "structural";
  }

  private broadcastToTenantLocally(
    tenantId: string,
    event: string,
    eventType: BroadcastEventType = "trace_updated",
  ): number {
    const emitter = this.eventEmitters.get(tenantId);
    const listenerCount = emitter?.listenerCount(eventType) ?? 0;

    if (!emitter || listenerCount === 0) return 0;

    const data = { event, timestamp: nowInstant().epochMilliseconds };
    this.logger.debug({ tenantId, event, listenerCount, eventType }, "Emitting SSE event locally");
    emitter.emit(eventType, data);
    return listenerCount;
  }

  getListenerCount(tenantId: string): number {
    const emitter = this.eventEmitters.get(tenantId);
    if (!emitter) return 0;
    return this.emitterListenerCount(emitter);
  }

  getTotalListenerCount(): number {
    let total = 0;
    for (const emitter of this.eventEmitters.values()) {
      total += this.emitterListenerCount(emitter);
    }
    return total;
  }

  getTenantEmitter(tenantId: string): EventEmitter {
    let emitter = this.eventEmitters.get(tenantId);

    if (!emitter) {
      emitter = new EventEmitter();
      emitter.setMaxListeners(50);
      this.eventEmitters.set(tenantId, emitter);
    }

    return emitter;
  }

  cleanupTenantEmitter(tenantId: string): void {
    const emitter = this.eventEmitters.get(tenantId);
    if (!emitter) return;

    if (this.emitterListenerCount(emitter) === 0) {
      this.eventEmitters.delete(tenantId);
      this.emitterEmptyTimes.delete(tenantId);
    }
  }

  getActiveTenants(): string[] {
    return Array.from(this.eventEmitters.keys());
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.senderRateLimiter.destroy();
    this.subscriberRateLimiter.destroy();

    // Stop accepting new broadcasts
    this.active = false;

    // Allow in-flight Redis publishes to drain
    await new Promise((resolve) => setTimeout(resolve, RedisBroadcastRepository.DRAIN_DELAY_MS));

    if (!this.subscriber) return;

    // Disconnect Redis subscriber
    await this.subscriber.quit();
  }
}

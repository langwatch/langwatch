import { EventEmitter } from "events";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { createLogger } from "~/utils/logger/server";
import { BroadcasterNotActiveError } from "./errors";
import { TenantRateLimiter } from "./tenant-rate-limiter";

export type BroadcastEventType = "trace_updated" | "simulation_updated" | "export_progress";

const ALL_EVENT_TYPES: BroadcastEventType[] = [
  "trace_updated",
  "simulation_updated",
  "export_progress",
];

function redisChannel(eventType: BroadcastEventType): string {
  return `broadcast:${eventType}`;
}

/**
 * Event Broadcasting Service for managing real-time event emission to tRPC subscriptions.
 * If available, uses Redis pub/sub for high availability across multiple server instances.
 * If no redis, it will not orchestrate but send directly.
 * Manages EventEmitter instances that tRPC subscriptions listen to for real-time updates.
 */
export class BroadcastService {
  private static readonly DRAIN_DELAY_MS = 2000;

  private eventEmitters = new Map<string, EventEmitter>();
  private subscriber: IORedis | Cluster | null = null;
  private readonly logger = createLogger("langwatch:broadcast-service");
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly EMITTER_CLEANUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private emitterEmptyTimes = new Map<string, number>(); // tenantId -> timestamp when emitter became empty
  private active: boolean = false;
  private readonly senderRateLimiter = new TenantRateLimiter();
  private readonly subscriberRateLimiter = new TenantRateLimiter();

  constructor(private readonly redis: Cluster | IORedis | null) {
    this.subscriber = redis?.duplicate() ?? null;
    this.setupRedisSubscription();
    this.startCleanupInterval();
    this.active = true;
  }

  private setupRedisSubscription() {
    if (!this.subscriber) {
      this.logger.warn("Redis not available, SSE broadcasting disabled");
      return;
    }

    const channels = ALL_EVENT_TYPES.map(redisChannel);
    this.subscriber.subscribe(...channels, (err, count) => {
      if (err) {
        this.logger.error({ error: err }, "Failed to subscribe to SSE channels");
        return;
      }
      this.logger.debug({ subscriberCount: count, channels }, "Subscribed to SSE channels");
    });

    this.subscriber.on("message", (channel, message) => {
      const eventType = ALL_EVENT_TYPES.find(
        (et) => redisChannel(et) === channel,
      );
      if (!eventType) return;

      try {
        const { tenantId, event } = JSON.parse(message);
        this.logger.debug(
          { tenantId, event, eventType },
          "Received SSE broadcast via Redis",
        );

        const tier = this.classifyEventTier(event);
        if (!this.subscriberRateLimiter.tryConsume(tenantId, tier)) return;

        this.broadcastToTenantLocally(tenantId, event, eventType);
      } catch (error) {
        this.logger.error(
          { error, message },
          "Failed to parse SSE broadcast message",
        );
      }
    });

    this.subscriber.on("error", (error) => {
      this.logger.error({ error }, "Redis subscriber error");
    });
  }

  private startCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleEmitters();
    }, 60 * 1000);
  }

  private cleanupStaleEmitters() {
    const now = Date.now();
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
      this.logger.debug(
        { cleanedCount },
        "Cleaned up stale EventEmitters after timeout",
      );
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
  ) {
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
          timestamp: Date.now(),
        }),
      );

      this.logger.debug(
        { tenantId, event, eventType },
        "Published SSE event to Redis",
      );
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
   * Rate-limited variant of broadcastToTenant.
   *
   * Checks the sender-side token bucket before publishing. Returns `false`
   * (and silently drops the event) when the per-tenant per-tier bucket is
   * exhausted, preventing upstream overload on high-frequency delta streams.
   */
  async broadcastToTenantRateLimited(
    tenantId: string,
    event: string,
    eventType: BroadcastEventType = "trace_updated",
    tier: "structural" | "delta" = "structural",
  ): Promise<boolean> {
    if (!this.active) throw new BroadcasterNotActiveError();
    if (!this.senderRateLimiter.tryConsume(tenantId, tier)) {
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

    const data = { event, timestamp: Date.now() };
    this.logger.debug(
      { tenantId, event, listenerCount, eventType },
      "Emitting SSE event locally",
    );
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

  cleanupTenantEmitter(tenantId: string) {
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

  async close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.senderRateLimiter.destroy();
    this.subscriberRateLimiter.destroy();

    // Stop accepting new broadcasts
    this.active = false;

    // Allow in-flight Redis publishes to drain
    await new Promise((resolve) => setTimeout(resolve, BroadcastService.DRAIN_DELAY_MS));

    if (!this.subscriber) return;

    // Disconnect Redis subscriber
    await this.subscriber.quit();
  }
}

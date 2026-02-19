import { EventEmitter } from "events";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { createLogger } from "~/utils/logger/server";
import { BroadcasterNotActiveError } from "./errors";

export type BroadcastEventType = "trace_updated" | "simulation_updated";

const ALL_EVENT_TYPES: BroadcastEventType[] = [
  "trace_updated",
  "simulation_updated",
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
  private eventEmitters = new Map<string, EventEmitter>();
  private subscriber: IORedis | Cluster | null = null;
  private readonly logger = createLogger("langwatch:broadcast-service");
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly EMITTER_CLEANUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private emitterEmptyTimes = new Map<string, number>(); // tenantId -> timestamp when emitter became empty
  private active: boolean = false;

  private constructor(private readonly redis: Cluster | IORedis | null) {
    this.subscriber = redis?.duplicate() ?? null;
    this.setupRedisSubscription();
    this.startCleanupInterval();
    this.active = true;
  }

  static create(redis: Cluster | IORedis | null): BroadcastService {
    return new BroadcastService(redis);
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
      this.logger.info({ subscriberCount: count, channels }, "Subscribed to SSE channels");
    });

    this.subscriber.on("message", (channel, message) => {
      const eventType = ALL_EVENT_TYPES.find(
        (et) => redisChannel(et) === channel,
      );
      if (!eventType) return;

      try {
        const { tenantId, event, serverId } = JSON.parse(message);
        this.logger.debug(
          { tenantId, event, serverId, eventType },
          "Received SSE broadcast from other server",
        );
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

    const localConnections = this.broadcastToTenantLocally(tenantId, event, eventType);
    if (!this.redis) return;
    try {
      await this.redis.publish(
        redisChannel(eventType),
        JSON.stringify({
          tenantId,
          event,
          serverId: process.env.SERVER_ID || "unknown",
          timestamp: Date.now(),
        }),
      );

      this.logger.debug(
        { tenantId, event, localConnections, eventType },
        "Broadcasted SSE event via Redis",
      );
    } catch (error) {
      this.logger.error(
        { error, tenantId, event, eventType },
        "Failed to broadcast SSE event via Redis",
      );
    }
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
    // sthap
    this.active = false;

    // pauwse
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (!this.subscriber) return;

    // yeet
    await this.subscriber.quit();
  }
}

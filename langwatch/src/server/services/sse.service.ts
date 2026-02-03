import { SpanKind } from "@opentelemetry/api";
import { EventEmitter } from "events";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import { connection } from "../redis";

/**
 * Event Broadcasting Service for managing real-time event emission to tRPC subscriptions.
 * Uses Redis pub/sub for high availability across multiple server instances.
 * Manages EventEmitter instances that tRPC subscriptions listen to for real-time updates.
 */
export class SseService {
  private eventEmitters = new Map<string, EventEmitter>();
  private subscriber = connection?.duplicate();
  private readonly tracer = getLangWatchTracer("langwatch.sse-service");
  private readonly logger = createLogger("langwatch:sse-service");
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly EMITTER_CLEANUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private emitterEmptyTimes = new Map<string, number>(); // tenantId -> timestamp when emitter became empty

  constructor() {
    this.setupRedisSubscription();
    this.startCleanupInterval();
  }

  private setupRedisSubscription() {
    if (!this.subscriber) {
      this.logger.warn("Redis not available, SSE broadcasting disabled");
      return;
    }

    this.subscriber.subscribe("sse:trace_updates", (err, count) => {
      if (err) {
        this.logger.error({ error: err }, "Failed to subscribe to SSE channel");
        return;
      }
      this.logger.info({ subscriberCount: count }, "Subscribed to SSE channel");
    });

    this.subscriber.on("message", (channel, message) => {
      if (channel !== "sse:trace_updates") return;

      try {
        const { tenantId, event, serverId } = JSON.parse(message);
        this.logger.debug(
          { tenantId, event, serverId },
          "Received SSE broadcast from other server",
        );
        this.broadcastToTenantLocally(tenantId, event);
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
      const listenerCount = emitter.listenerCount("trace_updated");

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

  async broadcastToTenant(tenantId: string, event: string) {
    return this.tracer.withActiveSpan(
      "SseService.broadcastToTenant",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": tenantId,
          "event.name": event,
        },
      },
      async (span) => {
        const localConnections = this.broadcastToTenantLocally(tenantId, event);

        span.setAttributes({
          "broadcast.local_connections": localConnections,
        });

        if (connection) {
          try {
            await connection.publish(
              "sse:trace_updates",
              JSON.stringify({
                tenantId,
                event,
                serverId: process.env.SERVER_ID || "unknown",
                timestamp: Date.now(),
              }),
            );

            this.logger.debug(
              { tenantId, event, localConnections },
              "Broadcasted SSE event via Redis",
            );
          } catch (error) {
            span.addEvent("redis.publish.error", {
              "error.message":
                error instanceof Error ? error.message : String(error),
            });

            this.logger.error(
              { error, tenantId, event },
              "Failed to broadcast SSE event via Redis",
            );
          }
        } else {
          this.logger.warn(
            { tenantId, event },
            "Redis not available, only local broadcast sent",
          );
        }
      },
    );
  }

  private broadcastToTenantLocally(tenantId: string, event: string): number {
    const emitter = this.eventEmitters.get(tenantId);
    const listenerCount = emitter?.listenerCount("trace_updated") ?? 0;

    if (!emitter || listenerCount === 0) return 0;

    const data = { event, timestamp: Date.now() };
    this.logger.debug(
      { tenantId, event, listenerCount },
      "Emitting SSE event locally",
    );
    emitter.emit("trace_updated", data);
    return listenerCount;
  }

  getListenerCount(tenantId: string): number {
    const emitter = this.eventEmitters.get(tenantId);
    return emitter?.listenerCount("trace_updated") ?? 0;
  }

  getTotalListenerCount(): number {
    let total = 0;
    for (const emitter of this.eventEmitters.values()) {
      total += emitter.listenerCount("trace_updated");
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
    const listenerCount = emitter?.listenerCount("trace_updated") ?? 0;

    if (emitter && listenerCount === 0) {
      this.eventEmitters.delete(tenantId);
      this.emitterEmptyTimes.delete(tenantId);
    }
  }

  getActiveTenants(): string[] {
    return Array.from(this.eventEmitters.keys());
  }
}

export const sseService = new SseService();

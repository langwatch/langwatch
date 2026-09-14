/**
 * Realtime updates via Redis publish; channel and message form a wire format
 * between publisher and app subscriber, pinned by literal test to prevent
 * silent failures.
 */

/**
 * Every channel a tenant subscription listens on.
 *
 * The list is the application's `BroadcastEventType`, member for member. A
 * member that exists here and not there publishes into a channel with no
 * subscriber; one that exists there and not here is simply unreachable from a
 * background process.
 */
export const TENANT_BROADCAST_EVENT_TYPES = [
  "trace_updated",
  "simulation_updated",
  "export_progress",
  "presence_updated",
  "presence_cursor",
  "discover_updated",
  "langy_conversation_updated",
  "experiment_updated",
] as const;

export type TenantBroadcastEventType = (typeof TENANT_BROADCAST_EVENT_TYPES)[number];

/**
 * Message body: event is pre-serialized; timestamp is for logging, not
 * freshness checks.
 */
export type TenantBroadcastMessage = {
  tenantId: string;
  event: string;
  timestamp: number;
};

/**
 * The one Redis operation this capability performs.
 *
 * Structural rather than an ioredis import: a `Redis` and a `Cluster` both
 * satisfy it, and so does a fake, which is what lets the twin test read the
 * exact bytes that would have gone on the wire.
 */
export abstract class TenantBroadcastPublisher {
  abstract publish(channel: string, message: string): Promise<number>;
}

/**
 * What a feature asks for when it wants a tenant's open tabs to refetch.
 *
 * Features declare their own narrow port and receive an implementation from
 * the composition root; they never import this package, because a feature
 * server package may only be consumed by an application root. That is the cost
 * of sharing one publisher, and it is the same cost the mail capability pays.
 */
export abstract class TenantBroadcast {
  /** The channel a given event type is published on: `broadcast:<eventType>`. */
  static channelFor(eventType: TenantBroadcastEventType): string {
    return `broadcast:${eventType}`;
  }

  abstract broadcastToTenant(input: {
    tenantId: string;
    /** The already-serialised payload the browser receives verbatim. */
    event: string;
    eventType: TenantBroadcastEventType;
  }): Promise<void>;
}

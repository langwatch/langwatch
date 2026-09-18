/**
 * Realtime updates via Redis publish; channel and message form a wire format
 * between publisher and app subscriber, pinned by literal test to prevent
 * silent failures.
 */

/**
 * Every channel a tenant subscription listens on - the application's
 * `BroadcastEventType`, member for member. A member here and not there
 * publishes with no subscriber; there and not here is unreachable.
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
 * The one Redis operation this capability performs. Structural, not an
 * ioredis import: a `Redis`, a `Cluster` and a fake all satisfy it, which is
 * what lets the twin test read the exact bytes that would hit the wire.
 */
export abstract class TenantBroadcastPublisher {
  abstract publish(channel: string, message: string): Promise<number>;
}

/**
 * What a feature asks for when it wants a tenant's open tabs to refetch.
 * Declares its own narrow port and receives an implementation from the
 * composition root - the same cost the mail capability pays for sharing one publisher.
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

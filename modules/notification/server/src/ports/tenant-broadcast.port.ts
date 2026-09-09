/**
 * The realtime half of telling somebody something changed.
 *
 * A tenant broadcast is one Redis publish. Every browser holding an SSE
 * subscription for that tenant is listening on the other side, so the channel
 * name and the message body are a WIRE FORMAT between two processes that never
 * type-check against each other: the publisher is whichever process advanced
 * the projection, and the subscriber is the application serving the tab.
 *
 * Getting either wrong fails silently. A channel nobody subscribed to accepts
 * the publish and returns zero; a body whose keys the subscriber cannot read is
 * dropped inside its `JSON.parse` handler. In both cases the durable write
 * succeeded, the job reported success, and the customer's screen simply stopped
 * moving — which is why the format is pinned by literal in the adapter's twin
 * test rather than derived from a shared constant that only one side compiles.
 *
 * The application's own publisher is
 * `platform/app/src/server/app-layer/broadcast/broadcast.service.ts`. It stays
 * as it is: it also OWNS the subscriber and the per-tenant emitters, which a
 * background process has no use for. This module is the publish half alone.
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
 * The message body, exactly as the subscriber destructures it.
 *
 * `event` is an already-serialised string chosen by the producer; nothing here
 * inspects it. The subscriber reads `tenantId` and `event` and ignores
 * `timestamp`, which is carried for the receiving log line — it is not a
 * freshness gate, and no consumer may start treating it as one without the
 * publisher gaining a clock the subscriber trusts.
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
export abstract class TenantBroadcastPublisherPort {
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
export abstract class TenantBroadcastPort {
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

import { moduleApi } from "@langwatch/runtime-composition";
import type {
  PresenceCursorEvent,
  PresenceCursorSubscription,
  PresenceCursorTickInput,
  PresenceEvent,
  PresenceHeartbeatInput,
  PresenceLeaveInput,
  PresenceProjectInput,
  PresenceSession,
} from "./presence.ts";

/** Portable cancellation shape; browser and Node AbortSignals satisfy it. */
export type PresenceStreamSignal = unknown;

/** Who else is looking at this project, where they are, and where their cursor is. */
export interface PresenceApi {
  isEnabledForProject(input: PresenceProjectInput): Promise<boolean>;
  /** One browser session's heartbeat: its location now, and that it is still here. */
  update(input: PresenceHeartbeatInput): Promise<void>;
  leave(input: PresenceLeaveInput): Promise<void>;
  list(input: PresenceProjectInput): Promise<PresenceSession[]>;
  broadcastCursor(input: PresenceCursorTickInput): Promise<void>;
  events(
    input: PresenceProjectInput & { signal?: PresenceStreamSignal },
  ): AsyncGenerator<PresenceEvent>;
  cursors(
    input: PresenceCursorSubscription & { signal?: PresenceStreamSignal },
  ): AsyncGenerator<PresenceCursorEvent>;
  /** {@link PresenceBroadcastFabric}: the tenant's live-update signals. */
  getTenantEmitter(tenantId: string): PresenceTenantEmitter;
  /** {@link PresenceBroadcastFabric}: releases the tenant emitter a subscription borrowed. */
  cleanupTenantEmitter(tenantId: string): void;
}

export const PresenceApi = moduleApi<PresenceApi>("presence");

/**
 * A tenant's live-update signal, named structurally rather than as Node's
 * `EventEmitter` so this portable contract package stays free of a Node
 * dependency. Node's own `EventEmitter` (and anything test doubles build)
 * satisfies it as-is.
 */
export type PresenceTenantEmitter = Readonly<{
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}>;

/**
 * The read side of the process's per-tenant broadcast fabric, exposed as a
 * narrow peer token: exactly the two methods a live subscription outside
 * presence needs, never the rest of {@link PresenceApi}'s surface. Serves
 * every peer that watches a tenant's live updates — today `langy`'s
 * conversation broadcast and `trace`'s live-update subscriptions — because
 * one emitter per tenant is deliberately shared rather than each peer opening
 * a second fabric of its own, exactly as the deleted hand composition it
 * replaces did. Kept generic on purpose: no langy- or trace-specific shape
 * belongs on this token, only `getTenantEmitter`/`cleanupTenantEmitter`.
 */
export abstract class PresenceBroadcastFabric {
  abstract getTenantEmitter(tenantId: string): PresenceTenantEmitter;
  abstract cleanupTenantEmitter(tenantId: string): void;
}

import { moduleApi } from "@langwatch/kernel/module-api";

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
export type PresenceProjectEvent = Readonly<{
  projectId: string;
  channel: "export_progress";
  event: string;
}>;

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
  publishProjectEvent(input: PresenceProjectEvent): Promise<void>;
}

export const PresenceApi = moduleApi<PresenceApi>()("presence");

/**
 * Structural so this portable contract avoids a Node dependency while remaining
 * compatible with Node's `EventEmitter` and test doubles.
 */
export type PresenceTenantEmitter = Readonly<{
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}>;

/**
 * Read-only peer token exposing per-tenant broadcast: one shared emitter per
 * tenant avoids duplicate fabric subscriptions across peers.
 */
export abstract class PresenceBroadcastFabric {
  abstract getTenantEmitter(tenantId: string): PresenceTenantEmitter;
  abstract cleanupTenantEmitter(tenantId: string): void;
}

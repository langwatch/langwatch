import type { EventEmitter } from "node:events";

export abstract class PresenceBroadcastPort {
  abstract publish(input: {
    projectId: string;
    event: string;
    channel: "presence_updated" | "presence_cursor";
    rateLimited: boolean;
  }): Promise<void>;
}

export abstract class PresenceDiagnosticsPort {
  abstract warn(message: string, context: Record<string, unknown>): void;
}

/**
 * The read side of the broadcast fabric: a per-tenant emitter a subscriber
 * listens on, and the release the subscriber owes when it disconnects. Kept
 * apart from {@link PresenceBroadcastPort} because publishing and subscribing
 * are wired by different callers — the service publishes, the transport
 * subscribes.
 */
export abstract class PresenceEmitterPort {
  abstract getTenantEmitter(tenantId: string): EventEmitter;
  abstract cleanupTenantEmitter(tenantId: string): void;
}

// Capability ports; the application supplies the substrate (ADR 003).

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/**
 * Rate limiting port. The framework owns the key — service, endpoint, version,
 * principal — so the limiter only counts. A caller may name its own window per
 * check; the constructed one is the default.
 */
export interface RateLimiter {
  check(
    key: string,
    limit?: { requests: number; seconds: number },
  ): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
}

/** Response cache port; keys use the complete validated handler input. */
export interface ResponseCache {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, tag: string, body: Uint8Array, ttlSeconds: number): Promise<void>;
  invalidateTag(tag: string): Promise<void>;
}

// One process-level WebSocket upgrade listener (ADR-128).

export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

export abstract class ConnectUpgradeRouter {
  abstract register(pathname: string, handler: UpgradeHandler): void;
}

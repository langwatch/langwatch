// ---------------------------------------------------------------------------
// Capability ports (ADR 003)
//
// The package owns the contracts; the application owns the substrate (Redis in
// this system). Declaring `.withRateLimit()` on a service without a rate
// limiter, or `.withCache(...)` without a cache, fails the build — a
// capability that silently does nothing is worse than no capability.
// ---------------------------------------------------------------------------

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/**
 * Rate limiting port, supplied via `createService({ rateLimiter })`.
 *
 * The framework owns the key — service name + endpoint name + version
 * namespace + principal — so the limiter never decides who is being limited.
 */
export interface RateLimiter {
  check(key: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
}

/**
 * Response cache port, supplied via `createService({ cache })`.
 *
 * The framework owns the key — endpoint name + version namespace + a hash of
 * the complete validated handler input — and stores only validated response
 * bytes. The tag is the family's own name for its data, so two families cannot
 * collide by accident: `invalidateTag` drops every entry the family wrote.
 */
export interface ResponseCache {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, tag: string, body: Uint8Array, ttlSeconds: number): Promise<void>;
  invalidateTag(tag: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Upgrade routing (ADR-128)
//
// One `upgrade` listener shared by every WebSocket door of a process. A
// feature that serves a WebSocket registers its path against this port; the
// process owns the HTTP server the upgrade rides on.
// ---------------------------------------------------------------------------

export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

export abstract class ConnectUpgradeRouterPort {
  abstract register(pathname: string, handler: UpgradeHandler): void;
}

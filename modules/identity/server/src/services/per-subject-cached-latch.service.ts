import { createLogger } from "@langwatch/observability";
import type { IdentityLatchRepository } from "../repositories/identity-latch.repository.ts";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules.ts";

const logger = createLogger("langwatch:identity:latch");

/** How long one latch answer is held, in both directions. */
export const IDENTITY_LATCH_CACHE_TTL_MS = 60_000;

/** Hard cap on the users one process holds a cached latch answer for. */
export const IDENTITY_LATCH_CACHE_MAX_USERS = 50_000;

type CachedAnswer = { value: boolean; expiresAt: number };

/**
 * The two latch reads (ADR-110), cached per process with one TTL and
 * coalesced per subject. Moved verbatim out of `postgres.identity-email.adapter.ts`
 * so the app can build it from a repository row instead of a Prisma client.
 */
export class CachedIdentityLatch {
  static create(options: {
    repository: IdentityLatchRepository;
    ttlMs: number;
    maxUsers: number;
    now: () => number;
  }): CachedIdentityLatch {
    return new CachedIdentityLatch(options);
  }

  private anyone: CachedAnswer | undefined;
  private anyoneInFlight: Promise<boolean> | undefined;
  private readonly users = new Map<string, CachedAnswer>();
  private readonly usersInFlight = new Map<string, Promise<boolean>>();

  private constructor(
    private readonly options: {
      repository: IdentityLatchRepository;
      ttlMs: number;
      maxUsers: number;
      now: () => number;
    },
  ) {}

  /** The fork as `IdentityEmailService` takes it: one closure, per user. */
  gate(): IdentityUserGate {
    return ({ userId }) => this.isLatched({ userId });
  }

  private async isLatched({ userId }: { userId: string }): Promise<boolean> {
    if (!(await this.hasAnyoneFinalized())) return false;
    return this.isUserFinalized({ userId });
  }

  private hasAnyoneFinalized(): Promise<boolean> {
    const cached = this.anyone;
    if (cached && this.options.now() < cached.expiresAt) return Promise.resolve(cached.value);
    this.anyone = undefined;
    this.anyoneInFlight ??= this.readAnyone();
    return this.anyoneInFlight;
  }

  private async readAnyone(): Promise<boolean> {
    try {
      const value = await this.read(
        () => this.options.repository.hasAnyoneFinalized(),
        "could not read whether any user has finalized the identifier backfill; every user keeps the legacy email column until the cache expires",
        {},
      );
      this.anyone = { value, expiresAt: this.options.now() + this.options.ttlMs };
      return value;
    } finally {
      this.anyoneInFlight = undefined;
    }
  }

  private isUserFinalized({ userId }: { userId: string }): Promise<boolean> {
    const cached = this.users.get(userId);
    if (cached && this.options.now() < cached.expiresAt) return Promise.resolve(cached.value);
    this.users.delete(userId);
    const pending = this.usersInFlight.get(userId);
    if (pending) return pending;
    const flight = this.readUser({ userId });
    this.usersInFlight.set(userId, flight);
    return flight;
  }

  private async readUser({ userId }: { userId: string }): Promise<boolean> {
    try {
      const value = await this.read(
        () => this.options.repository.isFinalized({ userId }),
        "could not read this user's identifier-backfill state; they keep the legacy email column until the cache expires",
        { userId },
      );
      this.remember({ userId, value });
      return value;
    } finally {
      this.usersInFlight.delete(userId);
    }
  }

  private async read(
    query: () => Promise<boolean>,
    message: string,
    context: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      return await query();
    } catch (error) {
      // Fail safe, and never silently: an unreadable state table can only
      // leave a stale address in place, but a closed latch nobody can
      // distinguish from "not rolled out yet" is how a real outage reads as
      // routine.
      logger.warn({ ...context, error, ttlMs: this.options.ttlMs }, message);
      return false;
    }
  }

  private remember({ userId, value }: { userId: string; value: boolean }): void {
    if (this.users.size >= this.options.maxUsers) this.evict();
    this.users.set(userId, { value, expiresAt: this.options.now() + this.options.ttlMs });
  }

  private evict(): void {
    const now = this.options.now();
    for (const [key, entry] of this.users) {
      if (entry.expiresAt <= now) this.users.delete(key);
    }
    while (this.users.size >= this.options.maxUsers) {
      const oldest: string | undefined = this.users.keys().next().value;
      if (oldest === undefined) break;
      this.users.delete(oldest);
    }
  }
}

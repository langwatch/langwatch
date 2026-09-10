import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createLogger, type Logger } from "@langwatch/observability";
import { IdentityEmailService } from "../services/identity-email.service.ts";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules.ts";
import { PrismaIdentityHeadsRepository } from "../repositories/prisma/prisma.identity-heads.repository.ts";
import { PrismaIdentityLatchRepository } from "../repositories/prisma/prisma.identity-latch.repository.ts";

/**
 * How long one latch answer is held, in both directions.
 */
export const IDENTITY_LATCH_CACHE_TTL_MS = 60_000;

/**
 * Hard cap on the users one process holds a cached latch answer for.
 */
export const IDENTITY_LATCH_CACHE_MAX_USERS = 50_000;

export type PostgresIdentityEmailAdapterOptions = {
  /**
   * The composition root's own guarded client, typed. Both reads behind the fork live on it:
   * the `Identifier` projection that answers which address is this person's, and the
   * migration-state row that says whether that projection is allowed to answer at all.
   */
  database: PrismaClient;
  /** Overridden only by tests that need the latch to expire inside one run. */
  cacheTtlMs?: number;
  /** Overridden only by tests that need eviction to happen at a small size. */
  cacheMaxUsers?: number;
  /** Overridden only by tests; production reads the process clock. */
  now?: () => number;
  /** Defaults to the module's own logger; a test injects a captured one. */
  logger?: Logger;
};

/**
 * The READ fork for `User.email`, composed from a guarded Prisma client alone.
 */
export class PostgresIdentityEmailAdapter {
  static create(options: PostgresIdentityEmailAdapterOptions): PostgresIdentityEmailAdapter {
    return new PostgresIdentityEmailAdapter(options);
  }

  private service: IdentityEmailService | undefined;

  private constructor(private readonly options: PostgresIdentityEmailAdapterOptions) {}

  build(): IdentityEmailService {
    this.service ??= IdentityEmailService.create(
      PrismaIdentityHeadsRepository.create(this.options.database),
      CachedIdentityLatch.create({
        repository: PrismaIdentityLatchRepository.create(this.options.database),
        ttlMs: this.options.cacheTtlMs ?? IDENTITY_LATCH_CACHE_TTL_MS,
        maxUsers: this.options.cacheMaxUsers ?? IDENTITY_LATCH_CACHE_MAX_USERS,
        now: this.options.now ?? Date.now,
        logger: this.options.logger ?? createLogger("langwatch:identity:latch"),
      }).gate(),
    );
    return this.service;
  }
}

type CachedAnswer = { value: boolean; expiresAt: number };

/**
 * The two latch reads, cached per process with one TTL and coalesced per subject.
 */
class CachedIdentityLatch {
  static create(options: {
    repository: PrismaIdentityLatchRepository;
    ttlMs: number;
    maxUsers: number;
    now: () => number;
    logger: Logger;
  }): CachedIdentityLatch {
    return new CachedIdentityLatch(options);
  }

  private anyone: CachedAnswer | undefined;
  private anyoneInFlight: Promise<boolean> | undefined;
  private readonly users = new Map<string, CachedAnswer>();
  private readonly usersInFlight = new Map<string, Promise<boolean>>();

  private constructor(
    private readonly options: {
      repository: PrismaIdentityLatchRepository;
      ttlMs: number;
      maxUsers: number;
      now: () => number;
      logger: Logger;
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
      this.options.logger.warn({ ...context, error, ttlMs: this.options.ttlMs }, message);
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

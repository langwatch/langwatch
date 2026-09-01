import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createLogger } from "@langwatch/observability";
import { IdentityEmailService } from "../identity-email.service";
import type { IdentityUserGate } from "../identity-user-gate";
import { PrismaIdentityHeadsRepository } from "../repositories/prisma/prisma.identity-heads.repository";
import { PrismaIdentityLatchRepository } from "../repositories/prisma/prisma.identity-latch.repository";

const logger = createLogger("langwatch:identity:latch");

/**
 * How long one latch answer is held, in both directions.
 *
 * The same bound the platform application documents for its own gate, and it
 * has to be the same for the same reason the migration name does: an operator
 * enrolling a user, or pulling one back off the ledger, should not have to
 * learn a different lag per tier. There is no cross-process invalidation, so
 * this is the delay an enrolment or a rollback takes to be seen everywhere.
 */
export const IDENTITY_LATCH_CACHE_TTL_MS = 60_000;

/**
 * Hard cap on the users one process holds a cached latch answer for.
 *
 * Cardinality here is the fleet's ACTIVE users rather than its tenants, and an
 * entry nothing revisits would otherwise sit in the map for the life of the
 * process, so a write amortized-sweeps expired entries once the map reaches
 * the cap and evicts oldest-first if it is still over.
 */
export const IDENTITY_LATCH_CACHE_MAX_USERS = 50_000;

export type PostgresIdentityEmailAdapterOptions = {
  /**
   * The composition root's own guarded client, typed.
   *
   * Both reads behind the fork live on it: the `Identifier` projection that
   * answers which address is this person's, and the migration-state row that
   * says whether that projection is allowed to answer at all.
   */
  database: PrismaClient;
  /** Overridden only by tests that need the latch to expire inside one run. */
  cacheTtlMs?: number;
  /** Overridden only by tests that need eviction to happen at a small size. */
  cacheMaxUsers?: number;
  /** Overridden only by tests; production reads the process clock. */
  now?: () => number;
};

/**
 * The READ fork for `User.email`, composed from a guarded Prisma client alone.
 *
 * `User.email` is a legacy column that answers a question identity owns: which
 * address is this person's. For a user whose backfill has finalized the
 * identifiers are the truth and the column is a stale copy; for everyone else
 * the column still IS the truth. Which of those a user is, is one row in the
 * migration-state table, and both reads are plain Postgres — which is what
 * lets a process holding only a client compose this service rather than
 * receive it from a tier that already had one.
 *
 * The latch is CACHED, and that is not an optimization detail to leave out.
 * The fork is asked on every request that resolves a browser session, so an
 * uncached composition would put one indexed lookup per request per active
 * user on the session path — and, before any operator has enrolled anybody, it
 * would spend all of them learning something a single row already settles.
 * So the fleet-wide question is asked first and cached once per process, and
 * it self-disables the moment the first user finalizes.
 *
 * Every failure answers `false`, which means "keep the legacy column". That is
 * the only safe direction: this runs on the path a customer's session is
 * resolved on, and a read fork that can break sign-in is worse than a stale
 * email. Failures are logged rather than swallowed, because a latch that is
 * closed because the table is unreadable and a latch that is closed because
 * nobody is enrolled look identical from the outside.
 */
export class PostgresIdentityEmailAdapter {
  static create(options: PostgresIdentityEmailAdapterOptions): PostgresIdentityEmailAdapter {
    return new PostgresIdentityEmailAdapter(options);
  }

  private service: IdentityEmailService | undefined;

  private constructor(private readonly options: PostgresIdentityEmailAdapterOptions) {}

  build(): IdentityEmailService {
    this.service ??= new IdentityEmailService(
      PrismaIdentityHeadsRepository.create(this.options.database),
      CachedIdentityLatch.create({
        repository: PrismaIdentityLatchRepository.create(this.options.database),
        ttlMs: this.options.cacheTtlMs ?? IDENTITY_LATCH_CACHE_TTL_MS,
        maxUsers: this.options.cacheMaxUsers ?? IDENTITY_LATCH_CACHE_MAX_USERS,
        now: this.options.now ?? Date.now,
      }).gate(),
    );
    return this.service;
  }
}

type CachedAnswer = { value: boolean; expiresAt: number };

/**
 * The two latch reads, cached per process with one TTL and coalesced per
 * subject.
 *
 * Coalescing matters as much as the TTL: without it, a burst of requests
 * against a user nothing has cached yet each starts its own lookup — the same
 * stampede a cache exists to prevent, deferred to the first request after
 * every expiry rather than avoided.
 *
 * There is deliberately no invalidation. The platform application needs one
 * because it can create a user who is finalized in the same request; this
 * process creates no users, so the only way an answer changes is an operator
 * moving a migration record, and the TTL is the bound on that.
 */
class CachedIdentityLatch {
  static create(options: {
    repository: PrismaIdentityLatchRepository;
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
      repository: PrismaIdentityLatchRepository;
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

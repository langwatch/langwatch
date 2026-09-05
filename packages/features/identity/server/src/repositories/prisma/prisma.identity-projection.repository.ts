import type { IdentifierFact } from "@langwatch/identity-contract";
import { isLiveIdentifierState, LIVE_IDENTIFIER_STATES } from "@langwatch/identity-contract";
import type { IdentityReservationRepository } from "../identity-reservations.repository";
import { issuerForProviderId } from "../../adapters/better-auth.account-queries.adapter";
import { createLogger } from "@langwatch/observability";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import type { IdentityFoldState } from "../../projections/identity-state.projection";
import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";
import {
  identifierFactToRow as factToRow,
  identifierRowToFact as rowToFact,
} from "./prisma.identifier.mapper";

/**
 * Secrets are absent deliberately, and the list is narrow on purpose: a replay that rewrote
 * `access_token` would undo a token refresh that legitimately happened after the event.
 * The columns the fold owns on `Account` (ADR-116's bridge phase).
 */
export const FOLD_OWNED_ACCOUNT_COLUMNS = [
  "id",
  "userId",
  "provider",
  "issuer",
  "providerAccountId",
] as const;

const logger = createLogger("langwatch:identity:projection");

/** An identifier that projects to an `Account` row at all. One with no
 *  `accountId` projects to none — the email adopted from `User.email` never
 *  had an `Account` behind it. */
type LinkedIdentifier = IdentifierFact & { accountId: string };

function linkedIdentifiers(state: IdentityFoldState): LinkedIdentifier[] {
  return Object.values(state.identifiers).filter(
    (fact): fact is LinkedIdentifier => typeof fact.accountId === "string",
  );
}

/**
 * Postgres `Identifier` head, the linkage columns of `Account`, and the cursor — all written under
 * the queue's per-user lock.
 * The identity pipeline's projection store (ADR-101 §3, ADR-116): the
 */
export class PrismaIdentityProjectionRepository implements StateProjectionStore<IdentityFoldState> {
  static create({
    prisma,
    reservations,
  }: {
    prisma: PrismaClient;
    reservations: IdentityReservationRepository;
  }): PrismaIdentityProjectionRepository {
    return new PrismaIdentityProjectionRepository(prisma, reservations);
  }

  constructor(
    private readonly prisma: PrismaClient,
    private readonly reservations: IdentityReservationRepository,
  ) {}

  async tryLoad(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<IdentityFoldState> | null> {
    const userId = key;
    const cursor = await this.prisma.identityProjectionCursor.findUnique({
      where: { userId },
    });
    if (!cursor) return null;

    const rows = await this.prisma.identifier.findMany({ where: { userId } });
    const state: IdentityFoldState = {
      CreatedAt: cursor.createdAt.getTime(),
      UpdatedAt: cursor.updatedAt.getTime(),
      LastEventOccurredAt: cursor.occurredAt.getTime(),
      userId,
      identifiers: Object.fromEntries(
        rows.map((row) => {
          const fact = rowToFact(row);
          return [fact.identifierId, fact];
        }),
      ),
    };
    return {
      state,
      cursor: {
        acceptedAt: cursor.acceptedAt.getTime(),
        eventId: cursor.lastEventId,
      },
      occurredAt: cursor.occurredAt.getTime(),
      createdAt: cursor.createdAt.getTime(),
      updatedAt: cursor.updatedAt.getTime(),
      version: cursor.projectionVersion,
    };
  }

  async store(
    projection: StoredProjection<IdentityFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const userId = context.aggregateId;
    const { state } = projection;

    for (const fact of Object.values(state.identifiers)) {
      await this.writeIdentifier(fact);
    }

    await this.releaseAddressLocks({ userId, state });
    await this.projectAccounts({ userId, state });

    // Cursor last: it is the commit marker. A crash before this line leaves
    // rows a re-applied event overwrites idempotently; a crash after it is
    // a completed apply.
    await this.prisma.identityProjectionCursor.upsert({
      where: { userId },
      create: {
        userId,
        lastEventId: projection.cursor.eventId,
        acceptedAt: new Date(projection.cursor.acceptedAt),
        occurredAt: new Date(projection.occurredAt),
        projectionVersion: projection.version,
      },
      update: {
        lastEventId: projection.cursor.eventId,
        acceptedAt: new Date(projection.cursor.acceptedAt),
        occurredAt: new Date(projection.occurredAt),
        projectionVersion: projection.version,
      },
    });
  }

  /**
   * One identifier row, upserted whole. No database constraint arbitrates an ADDRESS collision
   * here, and none can: ONE user legitimately holds several proven identifiers carrying the same
   * address — a credential sign-in and a Google sign-in are two rows with one email, both VERIFIED.
   */
  private async writeIdentifier(fact: IdentifierFact): Promise<void> {
    const { id, ...columns } = factToRow(fact);
    try {
      await this.prisma.identifier.upsert({
        where: { id },
        create: { id, ...columns },
        update: columns,
      });
    } catch (error) {
      if (!(await this.parkedOnSubjectCollision({ fact, error }))) throw error;
    }
  }

  /**
   * A subject already held by another live identifier: park this one and keep folding. True when
   * that is what happened, so the caller rethrows anything else.
   *     fallback ADR-116 exists to retire. This WARN is the only signal.
   */
  private async parkedOnSubjectCollision({
    fact,
    error,
  }: {
    fact: IdentifierFact;
    error: unknown;
  }): Promise<boolean> {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002" ||
      fact.providerAccountId === null
    ) {
      return false;
    }
    const incumbent = await this.prisma.identifier.findFirst({
      where: {
        providerId: fact.providerId,
        providerAccountId: fact.providerAccountId,
        state: { in: [...LIVE_IDENTIFIER_STATES] },
        id: { not: fact.identifierId },
      },
      select: { id: true, userId: true },
    });
    // No incumbent means P2002 came from somewhere else entirely.
    if (incumbent === null) return false;
    logger.warn(
      {
        providerId: fact.providerId,
        parkedIdentifierId: fact.identifierId,
        parkedUserId: fact.userId,
        holdingIdentifierId: incumbent.id,
        holdingUserId: incumbent.userId,
      },
      "two live identifiers claim one provider subject; the incumbent keeps it and this one is parked, so its user stays held rather than the fold stopping",
    );
    return true;
  }

  /**
   * The lock is row-truth taken before a fact is stated, so the fold never CREATES one — it only
   * lets go.
   * The address locks this user no longer backs (ADR-116 §6).
   */
  private async releaseAddressLocks({
    userId,
    state,
  }: {
    userId: string;
    state: IdentityFoldState;
  }): Promise<void> {
    const holding = Object.values(state.identifiers)
      .filter((fact) => isLiveIdentifierState(fact.state) && fact.value !== null)
      .map((fact) => fact.identifierId);
    await this.reservations.release({
      userId,
      holdingIdentifierIds: holding,
    });
  }

  /**
   * Convergent rather than atomic.
   * `Account` as the identifiers imply it (ADR-116).
   */
  private async projectAccounts({
    userId,
    state,
  }: {
    userId: string;
    state: IdentityFoldState;
  }): Promise<void> {
    const linked = linkedIdentifiers(state);
    if (linked.length === 0) return;
    await this.reportWhenUserIsMissing({ userId, linked });
    await this.removeTombstonedAccounts(linked);
    for (const fact of linked) {
      await this.upsertLiveAccount(fact);
    }
  }

  /**
   * A `User` row that is not there is an ANOMALY, not a branch: the fold is projecting a user's
   * linkage while nothing in `User` carries them.
   */
  private async reportWhenUserIsMissing({
    userId,
    linked,
  }: {
    userId: string;
    linked: readonly LinkedIdentifier[];
  }): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (user) return;
    logger.warn(
      { userId, identifiers: linked.length },
      "the identity fold is projecting Account rows for a user with no User row; the rows are written and the anomaly is reported",
    );
  }

  /** A tombstoned identifier projects to no row. `deleteMany`, not `delete`:
   *  the unlink that stated the detach has usually removed the row already,
   *  and that is the expected case rather than an error. */
  private async removeTombstonedAccounts(linked: readonly LinkedIdentifier[]): Promise<void> {
    const tombstoned = linked
      .filter((fact) => !isLiveIdentifierState(fact.state))
      .map((fact) => fact.accountId);
    if (tombstoned.length === 0) return;
    await this.prisma.account.deleteMany({
      where: { id: { in: tombstoned } },
    });
  }

  /**
   * One live identifier's `Account` row.
   * library that wrote it. A fact stated before ADR-116 carries neither a
   */
  private async upsertLiveAccount(fact: LinkedIdentifier): Promise<void> {
    if (!isLiveIdentifierState(fact.state)) return;
    if (fact.providerAccountId === null) return;
    const columns = {
      userId: fact.userId,
      ...(fact.providerId === null ? {} : { provider: fact.providerId }),
      ...(fact.issuer === null ? {} : { issuer: fact.issuer }),
      providerAccountId: fact.providerAccountId,
    };
    await this.prisma.account.upsert({
      where: { id: fact.accountId },
      create: {
        id: fact.accountId,
        ...columns,
        provider: fact.providerId ?? fact.provider,
        // A row created without one is a row better-auth cannot find, so the
        // create floors it at the synthetic issuer 1.7 would have minted
        // itself. Only reachable for a fact stated before the issuer was
        // carried; a fact that names one always wins, because a real OIDC
        // issuer is never what this derivation would produce.
        issuer: fact.issuer ?? issuerForProviderId(fact.providerId ?? fact.provider),
      },
      update: columns,
    });
  }
}

import type { IdentifierFact } from "@langwatch/identity";
import { isLiveIdentifierState } from "@langwatch/identity";
import type { IdentityReservationRepository } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import type { IdentityFoldState } from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import { factToRow, rowToFact } from "./identifier-row";

/**
 * The columns the fold owns on `Account` (ADR-116's bridge phase).
 *
 * Secrets are absent deliberately, and the list is narrow on purpose: a
 * replay that rewrote `access_token` would undo a token refresh that
 * legitimately happened after the event. `type` is absent too — a legacy
 * NextAuth column better-auth does not even map, left to its default.
 * Widening this list is how the payload rule stops being true, so the
 * integration suite pins it.
 */
export const FOLD_OWNED_ACCOUNT_COLUMNS = [
  "id",
  "userId",
  "provider",
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
 * The identity pipeline's projection store (ADR-101 §3, ADR-116): the
 * Postgres `Identifier` head, the linkage columns of `Account`, and the
 * cursor — all written under the queue's per-user lock.
 *
 * `Identifier` is a pure event-truth head: every column is fold-written and
 * rows are never deleted (DETACHED is a tombstone; erasure wipes value
 * columns and keeps the row).
 *
 * `Account` is the OTHER projection of the same log. better-auth reads and
 * writes it with the completely stock adapter, so this store owns only its
 * linkage columns and reconciles existence: a live identifier projects to a
 * row, a tombstoned one projects to none.
 */
export class PrismaIdentityProjectionRepository
  implements StateProjectionStore<IdentityFoldState>
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly reservations: IdentityReservationRepository,
  ) {}

  async load(
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
   * One identifier row, upserted whole.
   *
   * No database constraint arbitrates a collision here, and none can: ONE user
   * legitimately holds several proven identifiers carrying the same address —
   * a credential sign-in and a Google sign-in are two rows with one email,
   * both VERIFIED. "One USER per proven address" is not a row-level rule, so
   * it lives in `IdentifierReservation`, claimed before any fact is stated.
   */
  private async writeIdentifier(fact: IdentifierFact): Promise<void> {
    const { id, ...columns } = factToRow(fact);
    await this.prisma.identifier.upsert({
      where: { id },
      create: { id, ...columns },
      update: columns,
    });
  }

  /**
   * The address locks this user no longer backs (ADR-116 §6).
   *
   * The lock is row-truth taken before a fact is stated, so the fold never
   * CREATES one — it only lets go. A user's claim survives while a live
   * identifier of theirs still carries the value; a detach, a dead end and an
   * erasure (which nulls the value) all end that, and the address becomes
   * somebody else's to take.
   */
  private async releaseAddressLocks({
    userId,
    state,
  }: {
    userId: string;
    state: IdentityFoldState;
  }): Promise<void> {
    const holding = Object.values(state.identifiers)
      .filter(
        (fact) => isLiveIdentifierState(fact.state) && fact.value !== null,
      )
      .map((fact) => fact.identifierId);
    await this.reservations.release({
      userId,
      holdingIdentifierIds: holding,
    });
  }

  /**
   * `Account` as the identifiers imply it (ADR-116).
   *
   * Convergent rather than atomic. On the live path better-auth has already
   * written this row, with the id the ceremony pinned, so the upsert
   * re-asserts values that already agree — it costs a write and changes
   * nothing. It earns its place on replay, and when a detach has to remove
   * a row the stock adapter did not.
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
   * A `User` row that is not there is an ANOMALY, not a branch: the fold is
   * projecting a user's linkage while nothing in `User` carries them.
   *
   * Surfaced, and the projection stays total — the rows are written anyway,
   * because `Account` carries no database foreign key (the schema's
   * `relationMode = "prisma"` makes the cascade the client's) and a fold that
   * silently declined would leave the projection quietly incomplete with
   * nothing to read about it.
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
  private async removeTombstonedAccounts(
    linked: readonly LinkedIdentifier[],
  ): Promise<void> {
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
   *
   * The provider written here is better-auth's OWN id, never the folded
   * vocabulary: the identifier's `provider` collapses auth0, okta and every
   * custom OIDC connection into `oidc`, while `Account`'s uniqueness and the
   * genericOAuth callback's lookup are both keyed by the unfolded name — so
   * writing the folded one makes a held user's account unfindable by the
   * library that wrote it. A fact stated before ADR-116 carries neither a
   * subject nor an unfolded id, and its row is left as better-auth's own.
   */
  private async upsertLiveAccount(fact: LinkedIdentifier): Promise<void> {
    if (!isLiveIdentifierState(fact.state)) return;
    if (fact.providerAccountId === null) return;
    const columns = {
      userId: fact.userId,
      ...(fact.providerId === null ? {} : { provider: fact.providerId }),
      providerAccountId: fact.providerAccountId,
    };
    await this.prisma.account.upsert({
      where: { id: fact.accountId },
      create: {
        id: fact.accountId,
        ...columns,
        provider: fact.providerId ?? fact.provider,
      },
      update: columns,
    });
  }
}

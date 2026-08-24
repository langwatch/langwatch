import type { IdentifierFact } from "@langwatch/identity";
import { isLiveIdentifierState } from "@langwatch/identity";
import type { PrismaClient } from "~/generated/prisma/client";
import type { IdentityFoldState } from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import { factToRow, rowToFact } from "./identifier-row";

/**
 * The columns the fold owns on `Account` (ADR-116 §2).
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
  constructor(private readonly prisma: PrismaClient) {}

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
      const { id, ...columns } = factToRow(fact);
      await this.prisma.identifier.upsert({
        where: { id },
        create: { id, ...columns },
        update: columns,
      });
    }

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
   * `Account` as the identifiers imply it (ADR-116 §5, §6).
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
    // An identifier with no `accountId` projects to no row at all — the
    // email adopted from `User.email` never had an `Account` behind it.
    const linked = Object.values(state.identifiers).filter(
      (fact): fact is IdentifierFact & { accountId: string } =>
        typeof fact.accountId === "string",
    );
    if (linked.length === 0) return;

    // A deleted user's rows went with them (`Account` cascades on delete),
    // and recreating one would fail the foreign key rather than restore
    // anything. The fold has nothing to say about a user who is gone.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) return;

    const tombstoned = linked
      .filter((fact) => !isLiveIdentifierState(fact.state))
      .map((fact) => fact.accountId);
    if (tombstoned.length > 0) {
      // `deleteMany`, not `delete`: the unlink that stated the detach has
      // usually removed the row already, and that is the expected case
      // rather than an error.
      await this.prisma.account.deleteMany({
        where: { id: { in: tombstoned } },
      });
    }

    for (const fact of linked) {
      if (!isLiveIdentifierState(fact.state)) continue;
      // Without a subject there is nothing to key the row by. Facts stated
      // before ADR-116 carry none, and are left to better-auth's own row.
      if (fact.providerAccountId === null) continue;
      const columns = {
        userId: fact.userId,
        provider: fact.provider,
        providerAccountId: fact.providerAccountId,
      };
      await this.prisma.account.upsert({
        where: { id: fact.accountId },
        create: { id: fact.accountId, ...columns },
        update: columns,
      });
    }
  }
}

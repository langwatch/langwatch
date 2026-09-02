import type {
  JoinMatchKind,
  JoinRequestAggregateState,
  JoinRequestState,
  JoinResolverType,
  JoinWithdrawalCause,
} from "@langwatch/identity-contract";
import type { JoinRequestReadRepository } from "@langwatch/identity-server";
import type {
  JoinRequest as JoinRequestRow,
  PrismaClient,
} from "@langwatch/prisma-client/generated";
import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";
import type { JoinRequestFoldState } from "../../join-requests/projections/joinRequestState.foldProjection";

/** The one model this fold writes and its guards read. */
export type PrismaJoinRequestProjectionDatabase = Pick<PrismaClient, "joinRequest">;

/**
 * The join-request pipeline's projection store (D12, ADR-117): the Postgres
 * `JoinRequest` head and its cursor, written under the queue's per-request
 * lock, plus the two reads the guards run against it.
 *
 * ONE repository in both roles, for the reason the directory-sync store gives:
 * the fold's store and the guards' read are the same rows, so composing them
 * separately would be two objects that must agree about what a nullable column
 * means and eventually would not — and here the column they would disagree
 * about is `state`, which is the difference between refusing a second request
 * and admitting one.
 *
 * One row per aggregate, so the cursor rides on the row itself rather than in
 * a sibling table — and the row is written last-field-wins in one upsert,
 * which makes the whole apply the commit marker. A crash before it leaves
 * nothing; a crash after it is a completed apply.
 *
 * Nothing outside the fold writes here. A hand-edited row is not an approval,
 * it is a value the next event or the next replay overwrites — which is why
 * every answer an admin gives goes through a command.
 */
export class PrismaJoinRequestProjectionRepository
  implements StateProjectionStore<JoinRequestFoldState>, JoinRequestReadRepository
{
  static create(
    database: PrismaJoinRequestProjectionDatabase,
  ): PrismaJoinRequestProjectionRepository {
    return new PrismaJoinRequestProjectionRepository(database);
  }

  private constructor(private readonly database: PrismaJoinRequestProjectionDatabase) {}

  async tryLoad(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<JoinRequestFoldState> | null> {
    const row = await this.database.joinRequest.findUnique({ where: { id: key } });
    if (!row) return null;
    return {
      state: {
        ...rowToJoinRequest(row),
        CreatedAt: row.createdAt.getTime(),
        UpdatedAt: row.updatedAt.getTime(),
        LastEventOccurredAt: row.occurredAt.getTime(),
      },
      cursor: {
        acceptedAt: row.acceptedAt.getTime(),
        eventId: row.lastEventId,
      },
      occurredAt: row.occurredAt.getTime(),
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      version: row.projectionVersion,
    };
  }

  async store(
    projection: StoredProjection<JoinRequestFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const id = context.aggregateId;
    const { state } = projection;
    const columns = {
      userId: state.userId,
      organizationId: state.organizationId,
      domain: state.domain,
      state: state.state,
      matchedVia: state.matchedVia,
      expiresAt: state.expiresAtMs === null ? null : new Date(state.expiresAtMs),
      resolvedAt: state.resolvedAtMs === null ? null : new Date(state.resolvedAtMs),
      resolvedByType: state.resolvedByType,
      resolvedById: state.resolvedById,
      withdrawalCause: state.withdrawalCause,
      occurredAt: new Date(projection.occurredAt),
      lastEventId: projection.cursor.eventId,
      acceptedAt: new Date(projection.cursor.acceptedAt),
      projectionVersion: projection.version,
      // Business time, from the events — not `now()`. A row whose timestamps
      // came from the clock would differ from the row a replay rebuilds, and
      // whole-row parity is what this projection promises.
      createdAt: new Date(state.createdAtMs),
      updatedAt: new Date(state.updatedAtMs),
    };
    await this.database.joinRequest.upsert({
      where: { id },
      create: { id, ...columns },
      update: columns,
    });
  }

  async findRequest({
    joinRequestId,
  }: {
    joinRequestId: string;
  }): Promise<JoinRequestAggregateState | null> {
    const row = await this.database.joinRequest.findUnique({ where: { id: joinRequestId } });
    return row ? rowToJoinRequest(row) : null;
  }

  /** The one-open-request-per-person-per-organization check. */
  async findPendingRequest({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<JoinRequestAggregateState | null> {
    const row = await this.database.joinRequest.findFirst({
      where: { userId, organizationId, state: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return row ? rowToJoinRequest(row) : null;
  }
}

/**
 * One stored row back into the reducer's state. Exported because the guards'
 * read and the fold's load need the same translation, and two copies of it
 * would eventually disagree about what a nullable column means.
 */
export function rowToJoinRequest(row: JoinRequestRow): JoinRequestAggregateState {
  return {
    joinRequestId: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    domain: row.domain,
    state: row.state as JoinRequestState,
    matchedVia: row.matchedVia as JoinMatchKind,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
    expiresAtMs: row.expiresAt?.getTime() ?? null,
    resolvedAtMs: row.resolvedAt?.getTime() ?? null,
    resolvedByType: (row.resolvedByType as JoinResolverType | null) ?? null,
    resolvedById: row.resolvedById,
    withdrawalCause: (row.withdrawalCause as JoinWithdrawalCause | null) ?? null,
  };
}

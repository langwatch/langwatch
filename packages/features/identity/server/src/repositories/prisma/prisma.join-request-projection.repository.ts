import type {
  JoinMatchKind,
  JoinRequestAggregateState,
  JoinRequestState,
  JoinResolverType,
  JoinWithdrawalCause,
} from "@langwatch/identity-contract";
import type { JoinRequest, PrismaClient } from "@langwatch/prisma-client/generated";
import type { JoinRequestFoldState } from "../../projections/join-request-state.projection";
import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";

/**
 * `JoinRequest` head and its cursor, written under the queue's per-request lock.
 * The join-request pipeline's projection store (D12, ADR-117): the Postgres
 */
export class PrismaJoinRequestProjectionRepository implements StateProjectionStore<JoinRequestFoldState> {
  static create(prisma: PrismaClient): PrismaJoinRequestProjectionRepository {
    return new PrismaJoinRequestProjectionRepository(prisma);
  }

  constructor(private readonly prisma: PrismaClient) {}

  async tryLoad(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<JoinRequestFoldState> | null> {
    const row = await this.prisma.joinRequest.findUnique({
      where: { id: key },
    });
    if (!row) return null;
    return {
      state: {
        ...PrismaJoinRequestProjectionRepository.rowToJoinRequest(row),
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
    await this.prisma.joinRequest.upsert({
      where: { id },
      create: { id, ...columns },
      update: columns,
    });
  }

  /**
   * One stored row back into the reducer's state. Exported because the guards'
   * read repository needs the same translation, and two copies of it would
   * eventually disagree about what a nullable column means.
   */
  static rowToJoinRequest(row: JoinRequest): JoinRequestAggregateState {
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
}

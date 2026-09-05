import type {
  ScimRevokeCause,
  ScimSyncFailure,
  ScimSyncLifecycleState,
  ScimSyncState,
} from "@langwatch/identity-contract";
import type { ScimSyncReadRepository } from "../scim-sync.repository";
import type {
  Prisma,
  PrismaClient,
  ScimSyncState as ScimSyncRow,
} from "@langwatch/prisma-client/generated";
import type { ScimSyncFoldState } from "../../projections/scim-sync-state.projection";
import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";

/**
 * The directory-sync pipeline's projection store (D08): the Postgres `ScimSyncState` head and its
 * cursor, written under the queue's per-sync lock, plus the read the guards run against.
 */
export class PrismaScimSyncProjectionRepository
  implements StateProjectionStore<ScimSyncFoldState>, ScimSyncReadRepository
{
  static create(prisma: PrismaClient): PrismaScimSyncProjectionRepository {
    return new PrismaScimSyncProjectionRepository(prisma);
  }

  constructor(private readonly prisma: PrismaClient) {}

  async tryLoad(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<ScimSyncFoldState> | null> {
    const row = await this.prisma.scimSyncState.findUnique({
      where: { id: key },
    });
    if (!row) return null;
    return {
      state: {
        ...PrismaScimSyncProjectionRepository.rowToScimSync(row),
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
    projection: StoredProjection<ScimSyncFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const id = context.aggregateId;
    const { state } = projection;
    const columns = {
      connectionId: state.connectionId,
      organizationId: state.organizationId,
      state: state.state,
      lastPushedAt: state.lastPushedAtMs === null ? null : new Date(state.lastPushedAtMs),
      // Cast at the ONE seam that knows both shapes. `ScimSyncFailure` is a
      // plain record of scalars, so it is a valid `InputJsonValue`; Prisma's
      // generated input type cannot see that through a named interface, and
      // widening the reducer's state to `Json` to satisfy it would lose the
      // typing on the side that actually reads these.
      lastFailure: (state.lastFailure ?? undefined) as unknown as Prisma.InputJsonValue,
      deadLetters: state.deadLetters as unknown as Prisma.InputJsonValue,
      revokedCause: state.revokedCause,
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
    await this.prisma.scimSyncState.upsert({
      where: { id },
      create: { id, ...columns },
      update: columns,
    });
  }

  /**
   * The guards' read. Organization-scoped as well as keyed by the sync, so a
   * command whose tenant and aggregate disagree resolves to nothing rather
   * than to another organization's sync.
   */
  async findSync({
    scimSyncId,
    organizationId,
  }: {
    scimSyncId: string;
    organizationId: string;
  }): Promise<ScimSyncState | null> {
    const row = await this.prisma.scimSyncState.findFirst({
      where: { id: scimSyncId, organizationId },
    });
    return row ? PrismaScimSyncProjectionRepository.rowToScimSync(row) : null;
  }

  /**
   * One stored row back into the reducer's state. Exported because the failure
   * surface and the guards' read need the same translation, and two copies of
   * it would eventually disagree about what a JSON column means.
   */
  static rowToScimSync(row: ScimSyncRow): ScimSyncState {
    return {
      scimSyncId: row.id,
      connectionId: row.connectionId,
      organizationId: row.organizationId,
      state: row.state as ScimSyncLifecycleState,
      lastPushedAtMs: row.lastPushedAt?.getTime() ?? null,
      lastFailure: row.lastFailure ? (row.lastFailure as unknown as ScimSyncFailure) : null,
      deadLetters: Array.isArray(row.deadLetters)
        ? (row.deadLetters as unknown as ScimSyncFailure[])
        : [],
      revokedCause: (row.revokedCause as ScimRevokeCause | null) ?? null,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    };
  }
}

/**
 * There is no view-model helper here on purpose. The projection already carries only what a failure
 * surface may publish — the connection, the operation, a reason code, a count and the person it was
 * about — so a reader shapes what it needs from `lastFailure` and `deadLetters` directly.
 */

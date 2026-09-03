import { mfaEnrollmentRowToState } from "@langwatch/identity-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";
import type { MfaFoldState } from "../../identity/projections/mfaEnrollmentState.foldProjection";

/** The one model this fold writes. */
export type PrismaMfaEnrollmentProjectionDatabase = Pick<PrismaClient, "mfaEnrollment">;

/**
 * The two-step verification pipeline's projection store (D06): the Postgres
 * `MfaEnrollment` head and its cursor, written under the queue's per-person
 * lock.
 *
 * One row per aggregate, so the cursor rides on the row itself rather than in
 * a sibling table — the `SsoConnection` shape rather than `Identifier`'s,
 * because a person has one enrollment rather than a fan-out. The row is
 * written in one upsert, which makes the whole apply the commit marker.
 *
 * Nothing outside the fold writes here, and nothing here is a secret: the
 * shared secret and the backup codes are the two-factor plugin's, in its own
 * table, and this row holds lifecycle plus the POSITIONS of codes already
 * spent.
 */
export class PrismaMfaEnrollmentProjectionRepository implements StateProjectionStore<MfaFoldState> {
  static create(
    database: PrismaMfaEnrollmentProjectionDatabase,
  ): PrismaMfaEnrollmentProjectionRepository {
    return new PrismaMfaEnrollmentProjectionRepository(database);
  }

  private constructor(private readonly database: PrismaMfaEnrollmentProjectionDatabase) {}

  async tryLoad(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<MfaFoldState> | null> {
    const row = await this.database.mfaEnrollment.findUnique({ where: { userId: key } });
    if (!row) return null;
    return {
      state: {
        ...mfaEnrollmentRowToState(row),
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
    projection: StoredProjection<MfaFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const userId = context.aggregateId;
    const { state } = projection;
    const columns = {
      enrollmentId: state.enrollmentId,
      method: state.method,
      state: state.state,
      enrolledAt: msToDate(state.enrolledAtMs),
      confirmedAt: msToDate(state.confirmedAtMs),
      expiredAt: msToDate(state.expiredAtMs),
      disabledAt: msToDate(state.disabledAtMs),
      disabledVia: state.disabledVia,
      backupCodeCount: state.backupCodeCount,
      consumedBackupCodeIndexes: state.consumedBackupCodeIndexes,
      failedCount: state.failedCount,
      occurredAt: new Date(projection.occurredAt),
      lastEventId: projection.cursor.eventId,
      acceptedAt: new Date(projection.cursor.acceptedAt),
      projectionVersion: projection.version,
      // Business time, from the events — not `now()`. A row whose timestamps
      // came from the clock would differ from the row a replay rebuilds, and
      // whole-row parity is what this projection promises.
      createdAt: new Date(state.CreatedAt),
      updatedAt: new Date(state.UpdatedAt),
    };
    await this.database.mfaEnrollment.upsert({
      where: { userId },
      create: { userId, ...columns },
      update: columns,
    });
  }
}

function msToDate(ms: number | null): Date | null {
  return ms === null ? null : new Date(ms);
}

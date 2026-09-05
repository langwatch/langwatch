import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { mfaEnrollmentRowToState } from "./prisma.mfa-enrollment.mapper";
import type { MfaFoldState } from "../../projections/mfa-enrollment-state.projection";
import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";

/**
 * The two-step verification pipeline's projection store (D06): the Postgres `MfaEnrollment` head
 * and its cursor, written under the queue's per-person lock.
 */
export class PrismaMfaEnrollmentProjectionRepository implements StateProjectionStore<MfaFoldState> {
  static create(prisma: PrismaClient): PrismaMfaEnrollmentProjectionRepository {
    return new PrismaMfaEnrollmentProjectionRepository(prisma);
  }

  constructor(private readonly prisma: PrismaClient) {}

  async tryLoad(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<MfaFoldState> | null> {
    const row = await this.prisma.mfaEnrollment.findUnique({
      where: { userId: key },
    });
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
    await this.prisma.mfaEnrollment.upsert({
      where: { userId },
      create: { userId, ...columns },
      update: columns,
    });
  }
}

function msToDate(ms: number | null): Date | null {
  return ms === null ? null : new Date(ms);
}

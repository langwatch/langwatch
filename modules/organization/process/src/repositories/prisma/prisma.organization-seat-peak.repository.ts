import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

import { emptySeatPeak, type SeatPeakState } from "../../rules/seat-peak.rules.ts";
import {
  OrganizationSeatPeakRepository,
  type SeatPeakFoldState,
  seatPeakFoldStateSchema,
} from "../organization-seat-peak.repository.ts";

type PrismaSeatPeakDatabase = PrismaClient | Prisma.TransactionClient;

type Row = Prisma.OrganizationSeatPeakProjectionGetPayload<object>;

/** An unreadable row throws: read as empty, the fold would silently stop counting (ADR-002). */
function readRow(row: Row): Extract<StoredProjectionRead<SeatPeakFoldState>, { kind: "folded" }> {
  const state = seatPeakFoldStateSchema.safeParse(row.folded);
  if (!state.success) {
    throw new Error(
      `organization ${row.organizationId}'s seat-peak state does not match its schema; rebuild the projection`,
    );
  }
  return {
    kind: "folded",
    projection: {
      state: state.data,
      cursor: { acceptedAt: row.acceptedAt, eventId: row.lastEventId },
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.projectionVersion,
    },
  };
}

/** Postgres row I/O for the seat-peak fold, one row per organization. */
export class PrismaOrganizationSeatPeakRepository extends OrganizationSeatPeakRepository {
  static create(database: PrismaSeatPeakDatabase): PrismaOrganizationSeatPeakRepository {
    return new PrismaOrganizationSeatPeakRepository(database);
  }

  private constructor(private readonly prisma: PrismaSeatPeakDatabase) {
    super();
  }

  async get(
    organizationId: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<SeatPeakFoldState>> {
    const row = await this.prisma.organizationSeatPeakProjection.findUnique({
      where: { organizationId },
    });
    return row ? readRow(row) : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<SeatPeakFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const organizationId = context.aggregateId;
    const data = {
      folded: projection.state,
      createdAt: projection.createdAt,
      updatedAt: projection.updatedAt,
      occurredAt: projection.occurredAt,
      acceptedAt: projection.cursor.acceptedAt,
      lastEventId: projection.cursor.eventId,
      projectionVersion: projection.version,
    } satisfies Omit<Prisma.OrganizationSeatPeakProjectionUncheckedCreateInput, "organizationId">;
    await this.prisma.organizationSeatPeakProjection.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }

  async getState(organizationId: string): Promise<SeatPeakState> {
    const row = await this.prisma.organizationSeatPeakProjection.findUnique({
      where: { organizationId },
    });
    return row ? readRow(row).projection.state : emptySeatPeak();
  }
}

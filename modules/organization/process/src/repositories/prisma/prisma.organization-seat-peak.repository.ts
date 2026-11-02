import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

import {
  OrganizationSeatPeakRepository,
  type SeatPeakFoldState,
  seatPeakFoldStateSchema,
} from "../organization-seat-peak.repository.ts";

type PrismaSeatPeakDatabase = PrismaClient | Prisma.TransactionClient;

type Row = Prisma.OrganizationSeatPeakProjectionGetPayload<object>;

/** An unreadable row reads as empty, so the fold starts it again. */
function readRow(row: Row): StoredProjectionRead<SeatPeakFoldState> {
  const state = seatPeakFoldStateSchema.safeParse(row.folded);
  if (!state.success) return { kind: "empty" };
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

  async findState(organizationId: string): Promise<SeatPeakFoldState | null> {
    const row = await this.prisma.organizationSeatPeakProjection.findUnique({
      where: { organizationId },
    });
    const read = row ? readRow(row) : null;
    return read?.kind === "folded" ? read.projection.state : null;
  }
}

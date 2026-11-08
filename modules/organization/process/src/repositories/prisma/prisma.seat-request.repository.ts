import { parseSignInIdpKind } from "@langwatch/identity-contract";
import {
  SeatRequestNotFoundError,
  type SeatRequestSource,
  type SeatRequestStatus,
} from "@langwatch/organization-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  SeatRequestOpened,
  SeatRequestRepository,
  SeatRequestRow,
} from "../seat-request.repository.ts";

type PrismaSeatRequestDatabase = Pick<PrismaClient, "seatRequest" | "$transaction">;

type StoredSeatRequest = Prisma.SeatRequestGetPayload<Record<string, never>>;

/** Reopening, resolving and the sales claim read then write, so each runs SERIALIZABLE. */
export class PrismaSeatRequestRepository
  extends PrismaRepository.transactionalFor("SeatRequest")
  implements SeatRequestRepository
{
  private constructor(prisma: PrismaSeatRequestDatabase) {
    super(prisma);
  }

  static create(prisma: PrismaSeatRequestDatabase): PrismaSeatRequestRepository {
    return new PrismaSeatRequestRepository(prisma);
  }

  async open(input: Parameters<SeatRequestRepository["open"]>[0]): Promise<SeatRequestOpened> {
    const where = {
      organizationId_email: { organizationId: input.organizationId, email: input.email },
    };
    const existing = await this.prisma.seatRequest.findUnique({ where });
    if (existing && input.onlyIfAbsent) {
      return { request: rowOf(existing), outcome: "already_recorded" };
    }
    if (!existing) {
      try {
        const created = await this.prisma.seatRequest.create({
          data: {
            id: input.id,
            organizationId: input.organizationId,
            email: input.email,
            userId: input.userId,
            name: input.name,
            status: "OPEN",
            source: input.source,
            idpRefused: input.idpRefused,
            idpKind: input.idpKind,
            openedAt: new Date(input.at),
          },
        });
        return { request: rowOf(created), outcome: "opened" };
      } catch (error) {
        // A concurrent arrival opened it first: that request is the one.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        const raced = await this.prisma.seatRequest.findUniqueOrThrow({ where });
        return { request: rowOf(raced), outcome: "already_open" };
      }
    }
    return this.serializableTransaction(async (transaction) => {
      const current = await transaction.seatRequest.findUniqueOrThrow({ where });
      if (current.status === "OPEN") {
        const updated = await transaction.seatRequest.update({
          where,
          data: {
            userId: current.userId ?? input.userId,
            name: current.name ?? input.name,
            idpRefused: current.idpRefused || input.idpRefused,
            idpKind: input.idpKind ?? current.idpKind,
          },
        });
        return { request: rowOf(updated), outcome: "already_open" as const };
      }
      if (current.resolvedAt?.getTime() !== existing.resolvedAt?.getTime()) {
        // Answered after this arrival was read: that answer covers it, so nothing reopens.
        return { request: rowOf(current), outcome: "resolved_meanwhile" as const };
      }
      const reopened = await transaction.seatRequest.update({
        where,
        data: {
          userId: input.userId ?? current.userId,
          name: input.name ?? current.name,
          status: "OPEN",
          source: input.source,
          idpRefused: input.idpRefused,
          idpKind: input.idpKind,
          openedAt: new Date(input.at),
          resolvedAt: null,
          resolvedByUserId: null,
          seatPendingSince: null,
          salesNotifiedAt: null,
        },
      });
      return { request: rowOf(reopened), outcome: "reopened" as const };
    });
  }

  async findOpen({ organizationId }: { organizationId: string }): Promise<SeatRequestRow[]> {
    const rows = await this.prisma.seatRequest.findMany({
      where: { organizationId, status: "OPEN" },
      orderBy: { openedAt: "asc" },
    });
    return rows.map(rowOf);
  }

  async getOpen({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }): Promise<SeatRequestRow> {
    const row = await this.prisma.seatRequest.findFirst({
      where: { id, organizationId, status: "OPEN" },
    });
    if (!row) throw new SeatRequestNotFoundError(id);
    return rowOf(row);
  }

  async resolve(input: Parameters<SeatRequestRepository["resolve"]>[0]): Promise<boolean> {
    return this.serializableTransaction(async (transaction) => {
      const open = await transaction.seatRequest.findFirst({
        where: { id: input.id, organizationId: input.organizationId, status: "OPEN" },
        select: { id: true },
      });
      if (!open) return false;
      await transaction.seatRequest.update({
        where: { id: input.id },
        data: {
          status: input.status,
          resolvedAt: new Date(input.at),
          resolvedByUserId: input.resolvedByUserId,
          seatPendingSince: input.status === "APPROVED" ? new Date(input.at) : null,
        },
      });
      return true;
    });
  }

  async release(input: Parameters<SeatRequestRepository["release"]>[0]): Promise<void> {
    await this.prisma.seatRequest.updateMany({
      where: {
        id: input.id,
        organizationId: input.organizationId,
        status: "APPROVED",
        resolvedAt: new Date(input.at),
        resolvedByUserId: input.resolvedByUserId,
      },
      data: { status: "OPEN", resolvedAt: null, resolvedByUserId: null, seatPendingSince: null },
    });
  }

  async settleSeat(input: Parameters<SeatRequestRepository["settleSeat"]>[0]): Promise<void> {
    await this.prisma.seatRequest.updateMany({
      where: {
        id: input.id,
        organizationId: input.organizationId,
        status: "APPROVED",
        resolvedAt: new Date(input.at),
      },
      data: { seatPendingSince: null },
    });
  }

  async findSeatPending({
    organizationId,
    since,
  }: {
    organizationId: string;
    since: number;
  }): Promise<SeatRequestRow[]> {
    const rows = await this.prisma.seatRequest.findMany({
      where: { organizationId, status: "APPROVED", seatPendingSince: { lt: new Date(since) } },
    });
    return rows.map(rowOf);
  }

  async claimSalesNotice({ id, at }: { id: string; at: number }): Promise<boolean> {
    return this.serializableTransaction(async (transaction) => {
      const unclaimed = await transaction.seatRequest.findFirst({
        where: { id, status: "OPEN", salesNotifiedAt: null },
        select: { id: true },
      });
      if (!unclaimed) return false;
      await transaction.seatRequest.update({
        where: { id },
        data: { salesNotifiedAt: new Date(at) },
      });
      return true;
    });
  }

  async findForUser({ userId }: { userId: string }): Promise<SeatRequestRow[]> {
    const rows = await this.prisma.seatRequest.findMany({ where: { userId } });
    return rows.map(rowOf);
  }
}

function rowOf(row: StoredSeatRequest): SeatRequestRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    userId: row.userId,
    name: row.name,
    status: row.status as SeatRequestStatus,
    source: row.source as SeatRequestSource,
    idpRefused: row.idpRefused,
    idpKind: parseSignInIdpKind(row.idpKind) ?? null,
    salesNotifiedAt: row.salesNotifiedAt?.getTime() ?? null,
    openedAt: row.openedAt.getTime(),
    resolvedAt: row.resolvedAt?.getTime() ?? null,
    resolvedByUserId: row.resolvedByUserId,
  };
}

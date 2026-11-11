import { PrismaRepository } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  AccessNoticeKind,
  AccessNoticeRow,
  OrganizationAccessNoticeRepository,
} from "../organization-access-notice.repository.ts";

type PrismaAccessNoticeDatabase = Pick<PrismaClient, "organizationAccessNotice" | "$transaction">;

type StoredNotice = Prisma.OrganizationAccessNoticeGetPayload<Record<string, never>>;

/** Claiming a notice for mail reads then writes, so it runs SERIALIZABLE: one claimer wins. */
export class PrismaOrganizationAccessNoticeRepository
  extends PrismaRepository.transactionalFor("OrganizationAccessNotice")
  implements OrganizationAccessNoticeRepository
{
  private constructor(prisma: PrismaAccessNoticeDatabase) {
    super(prisma);
  }

  static create(prisma: PrismaAccessNoticeDatabase): PrismaOrganizationAccessNoticeRepository {
    return new PrismaOrganizationAccessNoticeRepository(prisma);
  }

  async record(
    input: Parameters<OrganizationAccessNoticeRepository["record"]>[0],
  ): Promise<AccessNoticeRow[]> {
    try {
      const created = await this.prisma.organizationAccessNotice.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          kind: input.kind,
          email: input.email,
          name: input.name,
          idp: input.idp,
          idpRefused: input.idpRefused,
          dayKey: input.dayKey,
          createdAt: new Date(input.at),
        },
      });
      return [rowOf(created)];
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const unmailed = await this.prisma.organizationAccessNotice.findFirst({
          where: {
            organizationId: input.organizationId,
            kind: input.kind,
            email: input.email,
            dayKey: input.dayKey,
            mailedAt: null,
          },
        });
        return unmailed ? [rowOf(unmailed)] : [];
      }
      throw error;
    }
  }

  async markMailed(
    input: Parameters<OrganizationAccessNoticeRepository["markMailed"]>[0],
  ): Promise<string[]> {
    const marked: string[] = [];
    for (const id of input.ids) {
      const claimed = await this.serializableTransaction(async (transaction) => {
        const unmailed = await transaction.organizationAccessNotice.findFirst({
          where: { id, mailedAt: null },
          select: { id: true },
        });
        if (!unmailed) return false;
        await transaction.organizationAccessNotice.update({
          where: { id },
          data: { mailedAt: new Date(input.at) },
        });
        return true;
      });
      if (claimed) marked.push(id);
    }
    return marked;
  }

  async countRefusedForDay(
    input: Parameters<OrganizationAccessNoticeRepository["countRefusedForDay"]>[0],
  ): Promise<number> {
    return this.prisma.organizationAccessNotice.count({
      where: { organizationId: input.organizationId, dayKey: input.dayKey, idpRefused: true },
    });
  }

  async releaseMailed(
    input: Parameters<OrganizationAccessNoticeRepository["releaseMailed"]>[0],
  ): Promise<void> {
    await this.prisma.organizationAccessNotice.updateMany({
      where: { id: input.id },
      data: { mailedAt: null },
    });
  }
}

function rowOf(row: StoredNotice): AccessNoticeRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind === "idp_refused" ? "idp_refused" : ("seat_request" satisfies AccessNoticeKind),
    email: row.email,
    name: row.name,
    idp: row.idp,
    idpRefused: row.idpRefused,
    dayKey: row.dayKey,
    createdAt: row.createdAt.getTime(),
    mailedAt: row.mailedAt?.getTime() ?? null,
  };
}

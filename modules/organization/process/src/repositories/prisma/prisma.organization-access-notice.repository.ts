import { PrismaRepository } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  AccessNoticeKind,
  AccessNoticeRow,
  OrganizationAccessNoticeRepository,
} from "../organization-access-notice.repository.ts";

type PrismaAccessNoticeDatabase = Pick<PrismaClient, "organizationAccessNotice">;

type StoredNotice = Prisma.OrganizationAccessNoticeGetPayload<Record<string, never>>;

export class PrismaOrganizationAccessNoticeRepository
  extends PrismaRepository.for("OrganizationAccessNotice")
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
        return [];
      }
      throw error;
    }
  }

  async getMailWindow({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ lastMailedAt: number | null }> {
    const latest = await this.prisma.organizationAccessNotice.findFirst({
      where: { organizationId, mailedAt: { not: null } },
      orderBy: { mailedAt: "desc" },
      select: { mailedAt: true },
    });
    return { lastMailedAt: latest?.mailedAt?.getTime() ?? null };
  }

  async markMailed(
    input: Parameters<OrganizationAccessNoticeRepository["markMailed"]>[0],
  ): Promise<string[]> {
    const marked: string[] = [];
    for (const id of input.ids) {
      const result = await this.prisma.organizationAccessNotice.updateMany({
        where: { id, mailedAt: null },
        data: { mailedAt: new Date(input.at), delivery: input.delivery },
      });
      if (result.count > 0) marked.push(id);
    }
    return marked;
  }

  async findHeld({ organizationId }: { organizationId: string }): Promise<AccessNoticeRow[]> {
    const rows = await this.prisma.organizationAccessNotice.findMany({
      where: { organizationId, mailedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowOf);
  }

  async findOrganizationsWithHeld(): Promise<string[]> {
    const rows = await this.prisma.organizationAccessNotice.findMany({
      where: { mailedAt: null },
      distinct: ["organizationId"],
      select: { organizationId: true },
    });
    return rows.map((row) => row.organizationId);
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

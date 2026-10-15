// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { digestTemplateIdSchema } from "@langwatch/enterprise-digest-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { z } from "zod";

import type {
  DigestClickRecord,
  DigestSendRecord,
  DigestSendRepository,
} from "../digest-send.repository.ts";

const linksSchema = z.record(z.string(), z.string());

type SendRow = Readonly<{
  id: string;
  userId: string;
  organizationId: string;
  isoWeek: string;
  templateId: string;
  links: unknown;
  sentAt: Date | null;
}>;

function toRecord(row: SendRow): DigestSendRecord {
  return {
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    isoWeek: row.isoWeek,
    templateId: digestTemplateIdSchema.parse(row.templateId),
    links: linksSchema.parse(row.links),
    sentAt: row.sentAt?.getTime() ?? null,
  };
}

export class PrismaDigestSendRepository
  extends PrismaRepository.for("DigestSend", "DigestClick")
  implements DigestSendRepository
{
  static readonly create = this.factory((prisma) => new PrismaDigestSendRepository(prisma));

  async claim(input: Omit<DigestSendRecord, "sentAt">): Promise<DigestSendRecord> {
    const row = await this.prisma.digestSend.upsert({
      where: { userId_isoWeek: { userId: input.userId, isoWeek: input.isoWeek } },
      create: { ...input, links: { ...input.links } },
      update: {},
    });
    return toRecord(row);
  }

  async findById({ id }: { id: string }): Promise<DigestSendRecord[]> {
    const rows = await this.prisma.digestSend.findMany({ where: { id } });
    return rows.map(toRecord);
  }

  async markSent({ id, sentAt }: { id: string; sentAt: number }): Promise<void> {
    await this.prisma.digestSend.update({ where: { id }, data: { sentAt: new Date(sentAt) } });
  }

  async recordClick({
    id,
    sendId,
    linkKey,
    at,
  }: {
    id: string;
    sendId: string;
    linkKey: string;
    at: number;
  }): Promise<void> {
    await this.prisma.digestClick.create({ data: { id, sendId, linkKey, at: new Date(at) } });
  }

  async listSince({ isoWeek }: { isoWeek: string }): Promise<DigestSendRecord[]> {
    const rows = await this.prisma.digestSend.findMany({ where: { isoWeek: { gte: isoWeek } } });
    return rows.map(toRecord);
  }

  async listClicks({ sendIds }: { sendIds: readonly string[] }): Promise<DigestClickRecord[]> {
    return this.prisma.digestClick.findMany({
      where: { sendId: { in: [...sendIds] } },
      select: { sendId: true, linkKey: true },
    });
  }
}

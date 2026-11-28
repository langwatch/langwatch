// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";

import type {
  DigestAudienceRepository,
  DigestSettingsRecord,
} from "../digest-audience.repository.ts";

const SETTINGS_ID = "singleton";

export class PrismaDigestAudienceRepository
  extends PrismaRepository.for("DigestSubscription", "DigestSettings")
  implements DigestAudienceRepository
{
  static readonly create = this.factory((prisma) => new PrismaDigestAudienceRepository(prisma));

  async findUnsubscribed({ userIds }: { userIds: readonly string[] }): Promise<string[]> {
    const rows = await this.prisma.digestSubscription.findMany({
      where: { userId: { in: [...userIds] }, unsubscribedAt: { not: null } },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  async unsubscribe({
    userId,
    sendId,
    at,
  }: {
    userId: string;
    sendId: string;
    at: number;
  }): Promise<void> {
    const columns = { unsubscribedAt: new Date(at), unsubscribedFromSendId: sendId };
    await this.prisma.digestSubscription.upsert({
      where: { userId },
      create: { userId, ...columns },
      update: columns,
    });
  }

  async resubscribe({ userId }: { userId: string }): Promise<void> {
    await this.prisma.digestSubscription.updateMany({
      where: { userId },
      data: { unsubscribedAt: null, unsubscribedFromSendId: null },
    });
  }

  async forgetUser({ userId }: { userId: string }): Promise<void> {
    await this.prisma.digestSubscription.deleteMany({ where: { userId } });
  }

  async getSettings(): Promise<DigestSettingsRecord> {
    const row = await this.prisma.digestSettings.findUnique({ where: { id: SETTINGS_ID } });
    return { armed: row?.armed ?? false, lastPlannedWeek: row?.lastPlannedWeek ?? null };
  }

  async setArmed({ armed }: { armed: boolean }): Promise<void> {
    await this.prisma.digestSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, armed },
      update: { armed },
    });
  }

  async markPlanned({ isoWeek }: { isoWeek: string }): Promise<void> {
    await this.prisma.digestSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, lastPlannedWeek: isoWeek },
      update: { lastPlannedWeek: isoWeek },
    });
  }
}

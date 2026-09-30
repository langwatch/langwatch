// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { type DigestUpdate, digestUpdateSchema } from "@langwatch/enterprise-digest-contract";
import { PrismaRepository } from "@langwatch/prisma-client";

import type {
  DigestAudienceRepository,
  DigestSettingsRecord,
} from "../digest-audience.repository.ts";

const SETTINGS_ID = "singleton";

export class PrismaDigestAudienceRepository
  extends PrismaRepository.for(
    "DigestCohortOrganization",
    "DigestSubscription",
    "DigestSettings",
    "DigestUpdate",
  )
  implements DigestAudienceRepository
{
  static readonly create = this.factory((prisma) => new PrismaDigestAudienceRepository(prisma));

  async listEnrolled(): Promise<string[]> {
    const rows = await this.prisma.digestCohortOrganization.findMany({
      select: { organizationId: true },
    });
    return rows.map((row) => row.organizationId);
  }

  async setEnrolled({
    organizationId,
    enrolled,
    by,
  }: {
    organizationId: string;
    enrolled: boolean;
    by: string;
  }): Promise<void> {
    if (!enrolled) {
      await this.prisma.digestCohortOrganization.deleteMany({ where: { organizationId } });
      return;
    }
    await this.prisma.digestCohortOrganization.upsert({
      where: { organizationId },
      create: { organizationId, enrolledBy: by },
      update: {},
    });
  }

  async listUnsubscribed({ userIds }: { userIds: readonly string[] }): Promise<string[]> {
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
    await this.prisma.digestSubscription.deleteMany({ where: { userId } });
  }

  async listUnsubscribeSends(): Promise<string[]> {
    const rows = await this.prisma.digestSubscription.findMany({
      where: { unsubscribedFromSendId: { not: null } },
      select: { unsubscribedFromSendId: true },
    });
    return rows.flatMap((row) => (row.unsubscribedFromSendId ? [row.unsubscribedFromSendId] : []));
  }

  async getSettings(): Promise<DigestSettingsRecord> {
    const rows = await this.prisma.digestSettings.findMany({ where: { id: SETTINGS_ID } });
    const row = rows[0];
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

  async listUpdates(): Promise<DigestUpdate[]> {
    const rows = await this.prisma.digestUpdate.findMany({ orderBy: { isoWeek: "desc" } });
    return rows.map((row) => digestUpdateSchema.parse(row));
  }

  async saveUpdate({ by, ...update }: DigestUpdate & { by: string }): Promise<void> {
    const columns = { ...update, updatedBy: by };
    await this.prisma.digestUpdate.upsert({
      where: { isoWeek: update.isoWeek },
      create: columns,
      update: columns,
    });
  }
}

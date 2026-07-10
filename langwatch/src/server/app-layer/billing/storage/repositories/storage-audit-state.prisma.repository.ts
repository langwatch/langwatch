import type { PrismaClient } from "@prisma/client";

import type {
  StorageAuditStateRepository,
  StorageAuditStateRow,
} from "./storage-audit-state.repository";

export class PrismaStorageAuditStateRepository
  implements StorageAuditStateRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async recordAlarm({
    organizationId,
    kind,
    at,
  }: {
    organizationId: string;
    kind: "fold" | "reference" | "gauge-drift";
    at: Date;
  }): Promise<void> {
    await this.prisma.storageAuditState.upsert({
      where: { organizationId },
      // everAlarmedAt is a one-way latch: the FIRST alarm timestamp is kept
      // forever (the permanent-daily-tier trigger); only the kind refreshes.
      create: { organizationId, everAlarmedAt: at, lastAlarmKind: kind },
      update: { lastAlarmKind: kind },
    });
  }

  async findByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<StorageAuditStateRow | null> {
    return await this.prisma.storageAuditState.findUnique({
      where: { organizationId },
    });
  }
}

import type { PrismaClient } from "@prisma/client";

import type { StorageBillingCheckpointRepository } from "./storage-billing-checkpoint.repository";

export class PrismaStorageBillingCheckpointRepository
  implements StorageBillingCheckpointRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async recordFailure({
    organizationId,
    billingMonth,
  }: {
    organizationId: string;
    billingMonth: string;
  }): Promise<{ consecutiveFailures: number }> {
    const row = await this.prisma.storageBillingCheckpoint.upsert({
      where: {
        organizationId_billingMonth: { organizationId, billingMonth },
      },
      create: { organizationId, billingMonth, consecutiveFailures: 1 },
      update: { consecutiveFailures: { increment: 1 } },
    });
    return { consecutiveFailures: row.consecutiveFailures };
  }

  async resetFailures({
    organizationId,
    billingMonth,
  }: {
    organizationId: string;
    billingMonth: string;
  }): Promise<void> {
    await this.prisma.storageBillingCheckpoint.updateMany({
      where: { organizationId, billingMonth, consecutiveFailures: { gt: 0 } },
      data: { consecutiveFailures: 0 },
    });
  }
}

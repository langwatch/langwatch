import type { PrismaClient } from "@prisma/client";

import type {
  StorageBillableGaugeRepository,
  StorageBillableGaugeRow,
} from "./storage-billable-gauge.repository";

export class PrismaStorageBillableGaugeRepository
  implements StorageBillableGaugeRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<StorageBillableGaugeRow | null> {
    return await this.prisma.storageBillableGauge.findUnique({
      where: { organizationId },
    });
  }
}

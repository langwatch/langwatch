import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  GatewayConnectUpstreamRepository,
  type StoredGatewayConnectUpstream,
} from "../gateway-connect-upstream.repository.ts";

export class PrismaGatewayConnectUpstreamRepository extends GatewayConnectUpstreamRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): PrismaGatewayConnectUpstreamRepository {
    return new PrismaGatewayConnectUpstreamRepository(prisma);
  }

  async findForOrganization(organizationId: string): Promise<StoredGatewayConnectUpstream[]> {
    return this.prisma.gatewayConnectUpstream.findMany({
      where: { organizationId },
      select: { organizationId: true, baseUrl: true, encryptedToken: true, instanceId: true },
    });
  }

  async save(slot: StoredGatewayConnectUpstream): Promise<void> {
    const { organizationId, ...fields } = slot;
    await this.prisma.gatewayConnectUpstream.upsert({
      where: { organizationId },
      create: { organizationId, ...fields },
      update: fields,
    });
  }

  async clear(organizationId: string): Promise<void> {
    await this.prisma.gatewayConnectUpstream.deleteMany({ where: { organizationId } });
  }
}

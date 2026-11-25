import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  GatewayConnectUpstreamRepository,
  type StoredGatewayConnectUpstream,
} from "../gateway-connect-upstream.repository.ts";
import type { GatewayCipher } from "../gateway.repositories.ts";

/** The slot in Postgres: the token rests sealed in `encryptedToken`. */
export class PrismaGatewayConnectUpstreamRepository extends GatewayConnectUpstreamRepository {
  private constructor(
    private readonly prisma: PrismaClient,
    private readonly cipher: GatewayCipher,
  ) {
    super();
  }

  static create({
    prisma,
    cipher,
  }: Readonly<{
    prisma: PrismaClient;
    cipher: GatewayCipher;
  }>): PrismaGatewayConnectUpstreamRepository {
    return new PrismaGatewayConnectUpstreamRepository(prisma, cipher);
  }

  async findForOrganization(organizationId: string): Promise<StoredGatewayConnectUpstream[]> {
    const rows = await this.prisma.gatewayConnectUpstream.findMany({
      where: { organizationId },
      select: { organizationId: true, baseUrl: true, encryptedToken: true, instanceId: true },
    });
    return rows.map(({ encryptedToken, ...row }) => ({
      ...row,
      token: this.cipher.decrypt(encryptedToken),
    }));
  }

  async save(slot: StoredGatewayConnectUpstream): Promise<void> {
    const { organizationId, token, ...rest } = slot;
    const fields = { ...rest, encryptedToken: this.cipher.encrypt(token) };
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

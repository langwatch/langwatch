import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  GatewayTraceExportKeyRepository,
  type StoredGatewayTraceExportKey,
} from "../gateway-trace-export-key.repository.ts";

const STORED = { projectId: true, apiKeyId: true, encryptedToken: true } as const;

export class PrismaGatewayTraceExportKeyRepository extends GatewayTraceExportKeyRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): PrismaGatewayTraceExportKeyRepository {
    return new PrismaGatewayTraceExportKeyRepository(prisma);
  }

  async findForProject(projectId: string): Promise<StoredGatewayTraceExportKey[]> {
    return this.prisma.gatewayTraceExportKey.findMany({ where: { projectId }, select: STORED });
  }

  async saveFirst(key: StoredGatewayTraceExportKey): Promise<StoredGatewayTraceExportKey> {
    return this.prisma.gatewayTraceExportKey.upsert({
      where: { projectId: key.projectId },
      create: key,
      update: {},
      select: STORED,
    });
  }
}

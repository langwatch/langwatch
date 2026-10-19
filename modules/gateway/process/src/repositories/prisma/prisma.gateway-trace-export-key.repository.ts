import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  GatewayTraceExportKeyRepository,
  type StoredGatewayTraceExportKey,
} from "../gateway-trace-export-key.repository.ts";
import type { GatewayCipher } from "../gateway.repositories.ts";

const STORED = { projectId: true, apiKeyId: true, encryptedToken: true } as const;

/** The key in Postgres: the token rests sealed in `encryptedToken`. */
export class PrismaGatewayTraceExportKeyRepository extends GatewayTraceExportKeyRepository {
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
  }>): PrismaGatewayTraceExportKeyRepository {
    return new PrismaGatewayTraceExportKeyRepository(prisma, cipher);
  }

  async findForProject(projectId: string): Promise<StoredGatewayTraceExportKey[]> {
    const rows = await this.prisma.gatewayTraceExportKey.findMany({
      where: { projectId },
      select: STORED,
    });
    return rows.map((row) => this.#opened(row));
  }

  async saveFirst(key: StoredGatewayTraceExportKey): Promise<StoredGatewayTraceExportKey> {
    const kept = await this.prisma.gatewayTraceExportKey.upsert({
      where: { projectId: key.projectId },
      create: {
        projectId: key.projectId,
        apiKeyId: key.apiKeyId,
        encryptedToken: this.cipher.encrypt(key.token),
      },
      update: {},
      select: STORED,
    });
    return this.#opened(kept);
  }

  #opened(row: { projectId: string; apiKeyId: string; encryptedToken: string }) {
    return {
      projectId: row.projectId,
      apiKeyId: row.apiKeyId,
      token: this.cipher.decrypt(row.encryptedToken),
    };
  }
}

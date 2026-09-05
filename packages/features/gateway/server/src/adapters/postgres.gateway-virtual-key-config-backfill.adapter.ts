import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GatewayVirtualKeyConfigBackfillRepository } from "../repositories/gateway-virtual-key-config-backfill.repository";
import { PrismaGatewayVirtualKeyConfigBackfillRepository } from "../repositories/prisma/prisma.gateway-virtual-key-config-backfill.repository";

/** The Postgres seam for the virtual-key config backfill's reads and writes. */
export class PostgresGatewayVirtualKeyConfigBackfillAdapter {
  static create(options: {
    database: PrismaClient;
  }): GatewayVirtualKeyConfigBackfillRepository {
    return PrismaGatewayVirtualKeyConfigBackfillRepository.create({ database: options.database });
  }
}

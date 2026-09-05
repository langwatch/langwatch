import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GatewayTraceDestinationReportRepository } from "../repositories/gateway-trace-destination-report.repository";
import { PrismaGatewayTraceDestinationReportRepository } from "../repositories/prisma/prisma.gateway-trace-destination-report.repository";

/** The Postgres seam for the trace-destination report's three reads. */
export class PostgresGatewayTraceDestinationReportAdapter {
  static create(options: {
    database: PrismaClient;
  }): GatewayTraceDestinationReportRepository {
    return PrismaGatewayTraceDestinationReportRepository.create({ database: options.database });
  }
}

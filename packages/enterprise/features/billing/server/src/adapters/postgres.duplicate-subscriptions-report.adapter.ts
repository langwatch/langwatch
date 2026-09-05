import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { DuplicateSubscriptionsReportRepository } from "../repositories/duplicate-subscriptions-report.repository";
import { PrismaDuplicateSubscriptionsReportRepository } from "../repositories/prisma/prisma.duplicate-subscriptions-report.repository";

/** The Postgres seam for the duplicate-subscription report's two SELECTs. */
export class PostgresDuplicateSubscriptionsReportAdapter {
  static create(options: {
    database: PrismaClient;
  }): DuplicateSubscriptionsReportRepository {
    return PrismaDuplicateSubscriptionsReportRepository.create({ database: options.database });
  }
}

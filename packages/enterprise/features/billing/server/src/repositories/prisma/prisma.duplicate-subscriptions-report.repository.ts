import type { PrismaClient, SubscriptionStatus } from "@langwatch/prisma-client/generated";
import {
  DuplicateSubscriptionsReportRepository,
  type SubscriptionReportRow,
} from "../duplicate-subscriptions-report.repository";

const SUBSCRIPTION_SELECT = {
  id: true,
  organizationId: true,
  plan: true,
  status: true,
  createdAt: true,
  stripeSubscriptionId: true,
} as const;

/**
 * Read-only, and picked from the real client rather than re-declared: one
 * delegate, one method, so a typed `PrismaClient` satisfies it with no cast
 * and this stays visibly a SELECT and nothing else.
 */
export type DuplicateSubscriptionsDatabase = {
  subscription: Pick<PrismaClient["subscription"], "findMany">;
};

export class PrismaDuplicateSubscriptionsReportRepository extends DuplicateSubscriptionsReportRepository {
  private constructor(private readonly database: DuplicateSubscriptionsDatabase) {
    super();
  }

  static create(options: {
    database: DuplicateSubscriptionsDatabase;
  }): PrismaDuplicateSubscriptionsReportRepository {
    return new PrismaDuplicateSubscriptionsReportRepository(options.database);
  }

  async findByStatus(status: string): Promise<SubscriptionReportRow[]> {
    return this.database.subscription.findMany({
      where: { status: status as SubscriptionStatus },
      select: SUBSCRIPTION_SELECT,
    });
  }
}

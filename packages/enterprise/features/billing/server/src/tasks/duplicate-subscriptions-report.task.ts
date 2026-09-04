import {
  compareBySubscriptionOrder,
  SubscriptionStatus,
} from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { Task } from "@langwatch/task";

const logger = createLogger("langwatch:task:duplicate-subscriptions-report");

const SUBSCRIPTION_SELECT = {
  id: true,
  organizationId: true,
  plan: true,
  status: true,
  createdAt: true,
  stripeSubscriptionId: true,
} as const;

/**
 * Derived from the selection rather than written out, so dropping a field from
 * {@link SUBSCRIPTION_SELECT} is a compile error here instead of an
 * `undefined` the report reads at runtime.
 */
export type SubscriptionReportRow = Prisma.SubscriptionGetPayload<{
  select: typeof SUBSCRIPTION_SELECT;
}>;

/**
 * Read-only, and PICKED from the real client rather than re-declared: one
 * delegate, one method, so a typed `PrismaClient` satisfies it with no cast
 * and this stays visibly a SELECT and nothing else.
 */
export type DuplicateSubscriptionsDatabase = {
  subscription: Pick<PrismaClient["subscription"], "findMany">;
};

export type DuplicateSubscriptionsReport = Readonly<{
  activeSubscriptions: number;
  organizationsHoldingOne: number;
  duplicates: ReadonlyArray<{
    organizationId: string;
    rows: readonly SubscriptionReportRow[];
    /** The row plan resolution picks, under the product's own ordering. */
    winnerId: string;
    plans: readonly string[];
  }>;
  pendingSubscriptions: number;
  organizationsWithPending: number;
  pendingByPlan: ReadonlyArray<{ plan: string; count: number }>;
  oldestPending: Date | null;
}>;

/**
 * Reports organizations holding more than one active subscription and which
 * row plan resolution picks for them. Ported from main's
 * `report-duplicate-subscriptions.ts`; SELECT only, safe against production.
 */
export async function reportDuplicateSubscriptions({
  database,
}: {
  database: DuplicateSubscriptionsDatabase;
}): Promise<DuplicateSubscriptionsReport> {
  const active = await database.subscription.findMany({
    where: { status: SubscriptionStatus.ACTIVE },
    select: SUBSCRIPTION_SELECT,
  });
  const pending = await database.subscription.findMany({
    where: { status: SubscriptionStatus.PENDING },
    select: SUBSCRIPTION_SELECT,
  });

  const byOrganization = groupByOrganization(active);
  const duplicates = [...byOrganization.entries()]
    .filter(([, rows]) => rows.length > 1)
    // Ordered by the product's own rule, so the report can never name a winner
    // plan resolution would not pick.
    .map(([organizationId, rows]) => ({
      organizationId,
      rows,
      winnerId: [...rows].sort(compareBySubscriptionOrder)[0]?.id ?? "",
      plans: [...new Set<string>(rows.map((row) => row.plan))],
    }));

  const pendingByPlan = [...countBy(pending, (row) => String(row.plan)).entries()]
    .map(([plan, count]) => ({ plan, count }))
    .sort((a, b) => b.count - a.count);

  return {
    activeSubscriptions: active.length,
    organizationsHoldingOne: byOrganization.size,
    duplicates,
    pendingSubscriptions: pending.length,
    organizationsWithPending: groupByOrganization(pending).size,
    pendingByPlan,
    oldestPending:
      [...pending].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.createdAt ??
      null,
  };
}

function groupByOrganization(
  rows: readonly SubscriptionReportRow[],
): Map<string, SubscriptionReportRow[]> {
  const byOrganization = new Map<string, SubscriptionReportRow[]>();
  for (const row of rows) {
    const existing = byOrganization.get(row.organizationId);
    if (existing) existing.push(row);
    else byOrganization.set(row.organizationId, [row]);
  }
  return byOrganization;
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return counts;
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * duplicate-subscriptions-report`.
 */
export class DuplicateSubscriptionsReportTask extends Task {
  readonly name = "duplicate-subscriptions-report";
  readonly description =
    "Reports organizations holding more than one active subscription, and which row plan resolution picks.";

  private constructor(private readonly database: () => DuplicateSubscriptionsDatabase) {
    super();
  }

  static create({
    database,
  }: {
    database: () => DuplicateSubscriptionsDatabase;
  }): DuplicateSubscriptionsReportTask {
    return new DuplicateSubscriptionsReportTask(database);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const report = await reportDuplicateSubscriptions({ database: this.database() });
    logger.info({ report }, "duplicate subscription report");
  }
}

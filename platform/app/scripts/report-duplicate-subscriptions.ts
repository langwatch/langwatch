/**
 * READ-ONLY. Reports organizations holding more than one active subscription,
 * and which row plan resolution now picks for them.
 *
 * This script issues SELECT queries only. It performs no INSERT, UPDATE or
 * DELETE and opens no transaction, so it is safe to point at production. It
 * proposes nothing and deletes nothing: which of a customer's duplicate rows
 * is the real contract is a billing decision, not a query result.
 *
 * An organization is not supposed to hold two active subscriptions. When it
 * does, the plan comes from whichever row answers first, so the report shows
 * the winner under the ordering plan resolution applies (newest created, id as
 * the tiebreak). A duplicate is only invisible while the two rows agree; the
 * moment they disagree on plan or on a seat override, the organization's plan
 * depends on row order.
 *
 * The pending census is the other half of the picture. Abandoned checkouts
 * accumulate as PENDING rows forever, and a large count is the signal that
 * nothing expires them rather than that customers are mid-purchase.
 *
 * The counts are a shape, not a ledger. There is no snapshot around the reads,
 * so a row written while it runs may or may not be seen.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm tsx scripts/report-duplicate-subscriptions.ts
 */
import { PrismaClient } from "@prisma/client";

const ACTIVE = "ACTIVE";
const PENDING = "PENDING";

type SubscriptionRow = {
  id: string;
  organizationId: string;
  plan: string | null;
  status: string;
  createdAt: Date;
  stripeSubscriptionId: string | null;
};

/**
 * The row plan resolution reads: newest created wins, with the id as a total
 * order so the same row answers every time. Mirrors the `orderBy` on
 * `createSaaSPlanProvider`; if that ordering changes, this changes with it or
 * the report stops describing what the product does.
 */
function resolutionWinner(rows: SubscriptionRow[]): SubscriptionRow {
  return [...rows].sort((a, b) => {
    const byCreatedAt = b.createdAt.getTime() - a.createdAt.getTime();
    if (byCreatedAt !== 0) return byCreatedAt;
    return b.id.localeCompare(a.id);
  })[0]!;
}

function groupByOrganization(
  rows: SubscriptionRow[],
): Map<string, SubscriptionRow[]> {
  const byOrganization = new Map<string, SubscriptionRow[]>();
  for (const row of rows) {
    const existing = byOrganization.get(row.organizationId);
    if (existing) {
      existing.push(row);
      continue;
    }
    byOrganization.set(row.organizationId, [row]);
  }
  return byOrganization;
}

function countBy<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const bucket = key(row);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return counts;
}

async function main(): Promise<void> {
  // A client of its own rather than the app's singleton: this runs against a
  // DATABASE_URL the operator points at, and must not pick up whatever the
  // surrounding environment had configured.
  const prisma = new PrismaClient();
  try {
    const select = {
      id: true,
      organizationId: true,
      plan: true,
      status: true,
      createdAt: true,
      stripeSubscriptionId: true,
    } as const;

    const active = (await prisma.subscription.findMany({
      where: { status: ACTIVE },
      select,
    })) as SubscriptionRow[];

    const byOrganization = groupByOrganization(active);
    const duplicated = [...byOrganization.entries()].filter(
      ([, rows]) => rows.length > 1,
    );

    console.log(`active subscriptions: ${active.length}`);
    console.log(`organizations holding one: ${byOrganization.size}`);
    console.log(`organizations holding more than one: ${duplicated.length}`);

    for (const [organizationId, rows] of duplicated) {
      const winner = resolutionWinner(rows);
      const plans = new Set(rows.map((row) => row.plan ?? "unknown"));
      console.log("");
      console.log(`organization ${organizationId}`);
      console.log(
        `  rows: ${rows.length}, distinct plans: ${[...plans].join(", ")}`,
      );
      for (const row of rows) {
        const marker = row.id === winner.id ? "picked " : "       ";
        console.log(
          `  ${marker}${row.id}  ${row.plan ?? "unknown"}  created ${row.createdAt.toISOString()}  stripe ${
            row.stripeSubscriptionId ?? "none"
          }`,
        );
      }
    }

    const pending = (await prisma.subscription.findMany({
      where: { status: PENDING },
      select,
    })) as SubscriptionRow[];

    console.log("");
    console.log(`pending subscriptions: ${pending.length}`);
    console.log(
      `organizations with a pending subscription: ${groupByOrganization(pending).size}`,
    );
    const pendingByPlan = countBy(pending, (row) => row.plan ?? "unknown");
    for (const [plan, count] of [...pendingByPlan.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${plan.padEnd(28)} ${count}`);
    }
    const oldestPending = pending
      .map((row) => row.createdAt)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (oldestPending) {
      console.log(`  oldest pending: ${oldestPending.toISOString()}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

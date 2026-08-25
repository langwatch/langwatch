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
 * the winner under the ordering plan resolution applies, read from the same
 * exported rule the query uses. A duplicate is only invisible while the two
 * rows agree; the
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
import {
  compareBySubscriptionOrder,
  SubscriptionStatus,
} from "@langwatch/enterprise-billing-contract";
import { type Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { createPrismaPgAdapter } from "../src/server/prismaPgAdapter";

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
 * `SUBSCRIPTION_SELECT` is a compile error here instead of an `undefined` the
 * report reads at runtime.
 */
type SubscriptionRow = Prisma.SubscriptionGetPayload<{
  select: typeof SUBSCRIPTION_SELECT;
}>;

/**
 * The row plan resolution reads. Both the query and this report order by the
 * one rule exported from `planTypes`, so the report cannot describe a winner
 * the product would not pick.
 */
function resolutionWinner(rows: SubscriptionRow[]): SubscriptionRow {
  return [...rows].sort(compareBySubscriptionOrder)[0]!;
}

function groupByOrganization(rows: SubscriptionRow[]): Map<string, SubscriptionRow[]> {
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

function reportDuplicateOrganization(
  organizationId: string,
  rows: SubscriptionRow[],
): void {
  const winner = resolutionWinner(rows);
  const plans = new Set(rows.map((row) => row.plan ?? "unknown"));
  console.log("");
  console.log(`organization ${organizationId}`);
  console.log(`  rows: ${rows.length}, distinct plans: ${[...plans].join(", ")}`);
  for (const row of rows) {
    const marker = row.id === winner.id ? "picked " : "       ";
    console.log(
      `  ${marker}${row.id}  ${row.plan ?? "unknown"}  created ${row.createdAt.toISOString()}  stripe ${
        row.stripeSubscriptionId ?? "none"
      }`,
    );
  }
}

function reportActive(active: SubscriptionRow[]): void {
  const byOrganization = groupByOrganization(active);
  const duplicated = [...byOrganization.entries()].filter(([, rows]) => rows.length > 1);

  console.log(`active subscriptions: ${active.length}`);
  console.log(`organizations holding one: ${byOrganization.size}`);
  console.log(`organizations holding more than one: ${duplicated.length}`);

  for (const [organizationId, rows] of duplicated) {
    reportDuplicateOrganization(organizationId, rows);
  }
}

function reportPending(pending: SubscriptionRow[]): void {
  console.log("");
  console.log(`pending subscriptions: ${pending.length}`);
  console.log(
    `organizations with a pending subscription: ${groupByOrganization(pending).size}`,
  );
  const pendingByPlan = countBy(pending, (row) => row.plan ?? "unknown");
  for (const [plan, count] of [...pendingByPlan.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${plan.padEnd(28)} ${count}`);
  }
  const oldestPending = pending
    .map((row) => row.createdAt)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if (oldestPending) {
    console.log(`  oldest pending: ${oldestPending.toISOString()}`);
  }
}

async function main(): Promise<void> {
  // A client of its own rather than the app's singleton: this runs against a
  // DATABASE_URL the operator points at, and must not pick up whatever the
  // surrounding environment had configured.
  const prisma = new PrismaClient({
    adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
  });
  try {
    reportActive(
      await prisma.subscription.findMany({
        where: { status: SubscriptionStatus.ACTIVE },
        select: SUBSCRIPTION_SELECT,
      }),
    );
    reportPending(
      await prisma.subscription.findMany({
        where: { status: SubscriptionStatus.PENDING },
        select: SUBSCRIPTION_SELECT,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

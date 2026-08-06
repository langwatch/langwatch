import type { PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { applyAnnualEventsBillingThreshold } from "./annualEventsBillingThreshold";

export type BackfillTally = {
  applied: number;
  already_set: number;
  anchor_pinned: number;
  not_annual_events: number;
  failed: number;
};

/**
 * Applies the annual events billing threshold to every active Growth
 * annual subscription linked to Stripe. The DB query is deliberately
 * over-broad (all `GROWTH_SEAT_*_ANNUAL` plans, which grandfathered
 * pre-March-2026 customers share): the helper re-verifies against the
 * Stripe subscription's items, so the Stripe side is the authority on
 * whether each candidate is actually touched.
 *
 * Idempotent and preserve-over-normalize — see
 * `applyAnnualEventsBillingThreshold` for the exact semantics. A failure
 * on one subscription never stops the walk; it is tallied and logged.
 */
export const runAnnualEventsThresholdBackfill = async ({
  prisma,
  stripe,
  isDryRun,
  log,
}: {
  prisma: PrismaClient;
  stripe: Stripe;
  isDryRun: boolean;
  log: (message: string) => void;
}): Promise<BackfillTally> => {
  const candidates = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      stripeSubscriptionId: { not: null },
      plan: { in: ["GROWTH_SEAT_EUR_ANNUAL", "GROWTH_SEAT_USD_ANNUAL"] },
    },
    select: { id: true, plan: true, stripeSubscriptionId: true },
    orderBy: { createdAt: "asc" },
  });

  log(`Found ${candidates.length} annual subscription candidate(s)`);

  const tally: BackfillTally = {
    applied: 0,
    already_set: 0,
    anchor_pinned: 0,
    not_annual_events: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    try {
      const result = await applyAnnualEventsBillingThreshold({
        stripe,
        stripeSubscriptionId: candidate.stripeSubscriptionId!,
        isDryRun,
      });
      tally[result]++;
      const reported =
        isDryRun && result !== "already_set" && result !== "not_annual_events"
          ? `would be ${result}`
          : result;
      log(`subscription=${candidate.id} plan=${candidate.plan} -> ${reported}`);
    } catch (err) {
      tally.failed++;
      log(
        `subscription=${candidate.id} plan=${candidate.plan} -> FAILED: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  log(
    `Done — applied=${tally.applied} already_set=${tally.already_set} anchor_pinned=${tally.anchor_pinned} skipped=${tally.not_annual_events} failed=${tally.failed}`,
  );

  return tally;
};

/**
 * One-time backfill: set the Stripe billing threshold on existing annual
 * Growth subscriptions, so accrued event overage is collected in slices
 * during the year instead of one oversized renewal invoice.
 *
 * New annual subscriptions get the threshold automatically from the
 * checkout-completed webhook; this script covers the ones created before
 * that shipped. The threshold value and the annual-items check live in
 * `ee/billing/stripe/annualEventsBillingThreshold.ts` — this script only
 * finds candidates and reports.
 *
 * Idempotent: an already-set threshold is reported as `already_set` and no
 * update call is made. Subscriptions whose Stripe items carry no annual
 * events price (monthly plans, stale DB plan strings) are skipped —
 * the Stripe subscription's items are the authority, not the DB plan.
 *
 * IRREVERSIBLE: This script mutates billing state in the external Stripe
 * account, not our database — there is no down step. Once a threshold is
 * set, Stripe may issue and charge threshold invoices before any
 * compensating run could unset it, and an issued invoice cannot be
 * un-issued. Rolling back the *setting* is a manual
 * `stripe subscriptions update <id> -d "billing_thresholds="` per
 * subscription; invoices already charged stay charged (refund manually if
 * ever needed). Preview the blast radius first with DRY_RUN=1.
 *
 * Usage:
 *   pnpm tsx scripts/migrations/backfill-annual-billing-thresholds.ts
 *   DRY_RUN=1 pnpm tsx scripts/migrations/backfill-annual-billing-thresholds.ts
 */

import { prisma } from "~/server/db";
import { applyAnnualEventsBillingThreshold } from "../../ee/billing/stripe/annualEventsBillingThreshold";
import { createStripeClient } from "../../ee/billing/stripe/stripeClient";

const IS_DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  console.log(
    `Annual billing threshold backfill ${IS_DRY_RUN ? "[DRY-RUN]" : ""}`,
  );
  const stripe = createStripeClient();

  // Candidates: active Growth annual subscriptions linked to Stripe. The
  // helper re-verifies against the Stripe items (including grandfathered
  // pre-March-2026 prices, which share these plan types), so an over-broad
  // DB match is safe.
  const candidates = await prisma.subscription.findMany({
    where: {
      status: "ACTIVE",
      stripeSubscriptionId: { not: null },
      plan: { in: ["GROWTH_SEAT_EUR_ANNUAL", "GROWTH_SEAT_USD_ANNUAL"] },
    },
    select: { id: true, plan: true, stripeSubscriptionId: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${candidates.length} annual subscription candidate(s)`);

  const tally = { applied: 0, already_set: 0, not_annual_events: 0, failed: 0 };
  for (const candidate of candidates) {
    try {
      const result = await applyAnnualEventsBillingThreshold({
        stripe,
        stripeSubscriptionId: candidate.stripeSubscriptionId!,
        isDryRun: IS_DRY_RUN,
      });
      tally[result]++;
      console.log(
        `subscription=${candidate.id} plan=${candidate.plan} -> ${IS_DRY_RUN && result === "applied" ? "would apply" : result}`,
      );
    } catch (err) {
      tally.failed++;
      console.error(
        `subscription=${candidate.id} plan=${candidate.plan} -> FAILED`,
        err,
      );
    }
  }

  console.log(
    `Done — applied=${tally.applied} already_set=${tally.already_set} skipped=${tally.not_annual_events} failed=${tally.failed}`,
  );
  if (tally.failed > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

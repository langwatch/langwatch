/**
 * One-time backfill: set the Stripe billing threshold on existing annual
 * Growth subscriptions, so accrued event overage is collected in slices
 * during the year instead of one oversized renewal invoice.
 *
 * New annual subscriptions get the threshold automatically from the
 * checkout-completed webhook; this script covers the ones created before
 * that shipped. All logic lives in
 * `ee/billing/stripe/annualEventsThresholdBackfill.ts` (tested) — this
 * file is only the CLI entrypoint.
 *
 * Idempotent and preserve-over-normalize: an already-set threshold keeps
 * its amount whatever it is (a hand-negotiated value is never replaced);
 * only a threshold configured to move the billing anniversary gets its
 * anchor pinned back. Subscriptions whose Stripe items carry no annual
 * events price are skipped — the Stripe items are the authority, not the
 * DB plan string.
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
import { runAnnualEventsThresholdBackfill } from "../../ee/billing/stripe/annualEventsThresholdBackfill";
import { createStripeClient } from "../../ee/billing/stripe/stripeClient";

const IS_DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  console.log(
    `Annual billing threshold backfill ${IS_DRY_RUN ? "[DRY-RUN]" : ""}`,
  );

  const tally = await runAnnualEventsThresholdBackfill({
    prisma,
    stripe: createStripeClient(),
    isDryRun: IS_DRY_RUN,
    log: console.log,
  });

  if (tally.failed > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/**
 * ADR-039 rollout step 3a: seed billing meter checkpoints for the drifted
 * cohort (organizations with an ACTIVE GROWTH_SEAT_* subscription whose
 * pricingModel column still says TIERED) so that turning their event
 * metering on bills FORWARD ONLY (Invariant I8 — no retroactive charges).
 *
 * For each drifted org, the current billing month's checkpoint is created at
 * its month-to-date billable-events total. Create-only: existing checkpoints
 * are never modified (an existing checkpoint means the org was already
 * metered and is owed its delta).
 *
 * MUST run BEFORE scripts/backfill-pricing-model.ts and before flipping any
 * metering for the cohort. Review the printed org list with ops/CS first.
 *
 * Run with:
 *   DATABASE_URL=... npx tsx scripts/seed-billing-checkpoints.ts --dry-run
 *   DATABASE_URL=... npx tsx scripts/seed-billing-checkpoints.ts
 */

import { PrismaClient } from "@prisma/client";
import { queryBillableEventsTotal } from "../ee/billing/services/billableEventsQuery";
import { findDriftedSeatEventOrgs } from "../src/server/app-layer/billing/driftedOrgs";
import { PrismaBillingCheckpointService } from "../src/server/app-layer/billing/billingCheckpoint.service";

const DRY_RUN = process.argv.includes("--dry-run");

const prisma = new PrismaClient();

function currentBillingMonth(): string {
  const now = new Date();
  const month = `${now.getUTCMonth() + 1}`.padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

async function main() {
  const billingMonth = currentBillingMonth();
  const checkpoints = new PrismaBillingCheckpointService(prisma);

  const driftedOrgs = await findDriftedSeatEventOrgs(prisma);

  console.log(
    `Found ${driftedOrgs.length} drifted organization(s) (active seat sub, column != SEAT_EVENT) for billing month ${billingMonth}`,
  );

  for (const org of driftedOrgs) {
    const monthToDateTotal = await queryBillableEventsTotal({
      organizationId: org.id,
      billingMonth,
    });

    if (monthToDateTotal === null) {
      console.error(
        `  SKIP ${org.id} (${org.name}): ClickHouse unavailable — rerun before cutover`,
      );
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `  DRY-RUN ${org.id} (${org.name}): would seed checkpoint at ${monthToDateTotal} events`,
      );
      continue;
    }

    const { seeded } = await checkpoints.seedIfAbsent({
      organizationId: org.id,
      billingMonth,
      monthToDateTotal,
    });

    console.log(
      seeded
        ? `  SEEDED ${org.id} (${org.name}): checkpoint at ${monthToDateTotal} events`
        : `  EXISTS ${org.id} (${org.name}): checkpoint already present, untouched`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

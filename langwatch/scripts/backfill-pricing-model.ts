/**
 * ADR-039 rollout step 4: one-time backfill converging the pricingModel
 * display cache for organizations whose column drifted against their active
 * seat-event subscription (the incident class — migrateToSeatEvent skipped
 * by webhook ordering).
 *
 * Safe ONLY after rollout step 1 shipped (metering gate reads the resolver,
 * not the column) and step 3a ran (scripts/seed-billing-checkpoints.ts) —
 * otherwise this update switches Stripe metering on retroactively for the
 * cohort.
 *
 * Run with:
 *   DATABASE_URL=... npx tsx scripts/backfill-pricing-model.ts --dry-run
 *   DATABASE_URL=... npx tsx scripts/backfill-pricing-model.ts
 */

import { PrismaClient } from "@prisma/client";
import { findDriftedSeatEventOrgs } from "../src/server/app-layer/billing/driftedOrgs";

const DRY_RUN = process.argv.includes("--dry-run");

const prisma = new PrismaClient();

async function main() {
  const driftedOrgs = await findDriftedSeatEventOrgs(prisma);

  console.log(`Found ${driftedOrgs.length} drifted organization(s)`);
  for (const org of driftedOrgs) {
    console.log(`  ${org.id} (${org.name}): ${org.pricingModel} -> SEAT_EVENT`);
  }

  if (DRY_RUN) {
    console.log("DRY-RUN: no rows updated");
    return;
  }

  const result = await prisma.organization.updateMany({
    where: { id: { in: driftedOrgs.map((o) => o.id) } },
    data: { pricingModel: "SEAT_EVENT" },
  });

  console.log(`Updated ${result.count} organization(s)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

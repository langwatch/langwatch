/**
 * Pin the local-dev org's data retention for a seeded stack.
 *
 * haven runs this first for every seed preset (see the seed:retention step in
 * tools/thuishaven/app/db.go): a seeded dev DB keeps two years of
 * partition-aligned history, overriding haven's tiny 7-day platform default so
 * the seeded data survives. HAVEN_SEED_MONTHS (the mass window) scales it up
 * when the backdated history is deeper than two years.
 *
 * The 65s cache wait only runs for a backdated window (mass); recent seeds
 * (demo, traces) set the policy without blocking, since a brief stale stamp
 * still outlives their near-now data.
 */
import { PrismaClient } from "@prisma/client";
import { applySeedRetention, seededRetentionDays } from "./seed-lib/retention";

const ORG_ID = "local-dev-organization";

function windowDaysFromEnv(): number {
  const months = Number(process.env.HAVEN_SEED_MONTHS ?? "");
  return Number.isFinite(months) && months > 0 ? Math.floor(months) * 30 : 0;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const windowDays = windowDaysFromEnv();
    const retentionDays = seededRetentionDays(windowDays);
    const changed = await applySeedRetention({
      prisma,
      organizationId: ORG_ID,
      retentionDays,
      waitForCacheRollover: windowDays > 0,
      log: (message) => console.log(`🗓️  ${message}`),
    });
    console.log(
      changed
        ? `✅ Seed retention set to ${retentionDays} days for the local-dev org`
        : `✅ Seed retention already ${retentionDays} days for the local-dev org`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();

/**
 * Backfill script: mint the dedicated "Langy" API key for every existing
 * application project that doesn't already have one.
 *
 * Idempotent — re-running only provisions keys for projects still missing one.
 * Hidden internal_governance projects are excluded.
 *
 * Run with:
 *   DATABASE_URL=... npx tsx scripts/backfill-langy-api-keys.ts
 *   DATABASE_URL=... npx tsx scripts/backfill-langy-api-keys.ts --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { backfillLangyApiKeys } from "../src/server/services/langy/langyApiKey";

const DRY_RUN = process.argv.includes("--dry-run");

const prisma = new PrismaClient();

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  const { provisioned, skipped, failed } = await backfillLangyApiKeys(prisma, {
    dryRun: DRY_RUN,
  });

  console.log(
    `Langy key backfill: ${DRY_RUN ? "would provision" : "provisioned"} ${provisioned}, skipped ${skipped} (already had one), failed ${failed}`,
  );

  await prisma.$disconnect();

  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});

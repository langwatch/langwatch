/**
 * Backfill script: mint the auto-managed Langy VirtualKey for every existing
 * application project that doesn't already have one.
 *
 * Symmetric with `backfill-langy-api-keys.ts`. Project creation eagerly
 * provisions both now (#4275), so this is for projects that pre-date the
 * eager hook AND projects whose runtime provision was skipped (no actor).
 *
 * Idempotent — re-running only provisions VKs for projects still missing one.
 * Hidden internal_governance projects are excluded.
 *
 * Run with:
 *   DATABASE_URL=... npx tsx scripts/backfill-langy-virtual-keys.ts
 *   DATABASE_URL=... npx tsx scripts/backfill-langy-virtual-keys.ts --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { backfillLangyVirtualKeys } from "../src/server/services/langy/LangyCredentialService";

const DRY_RUN = process.argv.includes("--dry-run");

const prisma = new PrismaClient();

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  const { provisioned, skipped, failed } = await backfillLangyVirtualKeys(
    prisma,
    { dryRun: DRY_RUN },
  );

  console.log(
    `Langy VK backfill: ${DRY_RUN ? "would provision" : "provisioned"} ${provisioned}, skipped ${skipped} (already had one or no admin to attribute), failed ${failed}`,
  );

  await prisma.$disconnect();

  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});

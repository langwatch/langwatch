/**
 * One-off seed script for platform-published IngestionTemplate rows.
 *
 * Idempotent: re-running upserts each row to match the seeds module
 * verbatim (so platform-team edits to displayName / OTTL / etc. flow on
 * the next run).
 *
 * Usage (langwatch/ workspace):
 *   pnpm tsx scripts/seed-platform-ingestion-templates.ts
 *
 * Output (JSON on stdout):
 *   { created: <n>, updated: <n>, total: <n> }
 *
 * Run after `prisma migrate deploy` to populate the catalog before
 * Lane-B's /me Trace Ingest tile-grid renders. Ops can run this on
 * each release to pick up platform-team edits.
 */

import { prisma } from "~/server/db";
import { PostgresIngestionTemplateAdapter } from "@langwatch/enterprise-governance-server";

async function main() {
  const result = await PostgresIngestionTemplateAdapter.create({
    database: prisma,
  })
    .build()
    .syncPlatformCatalog();
  process.stdout.write(
    JSON.stringify({
      created: result.created,
      updated: result.updated,
      archived: result.archived,
      total: result.created + result.updated,
    }) + "\n",
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`seed-platform-ingestion-templates failed: ${err}\n`);
  process.exit(1);
});

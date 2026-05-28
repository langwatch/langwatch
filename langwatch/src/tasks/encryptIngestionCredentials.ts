/**
 * One-off backfill: encrypt any pull-mode ingestion credentials that were
 * written before the at-rest encryption landed.
 *
 *   - IngestionSource.parserConfig.credentials (s3_polling / http_polling /
 *     claude_compliance / copilot_studio upstream secrets)
 *   - UserIngestionBinding.encryptedCredential
 *
 * Idempotent: the helpers skip values already wrapped in the `enc:v1:`
 * envelope, so re-running is a no-op for already-migrated rows.
 *
 *   pnpm task encryptIngestionCredentials
 */
import {
  encryptCredential,
  encryptParserConfigCredentials,
} from "@ee/governance/services/activity-monitor/ingestionCredentials";
import { Prisma } from "@prisma/client";

import { prisma } from "../server/db";

export default async function main() {
  let sourcesUpdated = 0;
  const sources = await prisma.ingestionSource.findMany({
    select: { id: true, parserConfig: true },
  });
  for (const source of sources) {
    const parserConfig = source.parserConfig as Record<string, unknown> | null;
    if (!parserConfig || typeof parserConfig.credentials !== "object") continue;
    if (parserConfig.credentials === null) continue;
    const encrypted = encryptParserConfigCredentials(parserConfig)!;
    await prisma.ingestionSource.update({
      where: { id: source.id },
      data: { parserConfig: encrypted as Prisma.InputJsonValue },
    });
    sourcesUpdated++;
    console.log(`  Encrypted credentials for ingestion source ${source.id}`);
  }

  let bindingsUpdated = 0;
  const bindings = await prisma.userIngestionBinding.findMany({
    select: { id: true, encryptedCredential: true },
  });
  for (const binding of bindings) {
    const cred = binding.encryptedCredential;
    // Already-encrypted rows are tagged strings; only object/plaintext rows
    // need wrapping.
    if (cred === null || typeof cred !== "object") continue;
    await prisma.userIngestionBinding.update({
      where: { id: binding.id },
      data: { encryptedCredential: encryptCredential(cred) },
    });
    bindingsUpdated++;
    console.log(`  Encrypted credential for binding ${binding.id}`);
  }

  console.log(
    `Migration complete. Sources updated: ${sourcesUpdated}, bindings updated: ${bindingsUpdated}`,
  );
}

/**
 * Data migration: Encrypt existing plaintext customKeys in the ModelProvider table.
 *
 * Background:
 * - ModelProvider.customKeys was stored as a plain JSON object (unencrypted)
 * - The new system encrypts keys at rest using AES-256-GCM
 * - After encryption, the JSON column stores a JSON string (the ciphertext)
 * - Prisma reads a JSON string value back as `typeof string`, while a
 *   JSON object value comes back as `typeof object`
 *
 * This script is idempotent: if data is already encrypted (string type), it is skipped.
 *
 * Usage:
 *   pnpm task migrateModelProviderKeys
 */

import { prisma } from "../server/db";
import { encrypt } from "../utils/encryption";

// ============================================================================
// Types
// ============================================================================

/** Minimal row shape needed by the migration logic */
interface ModelProviderRow {
  id: string;
  projectId: string;
  customKeys: unknown;
}

// ============================================================================
// Pure migration logic (no DB dependency)
// ============================================================================

/**
 * Determine whether a customKeys value is already encrypted.
 *
 * After encryption, the JSON column contains a JSON string (ciphertext),
 * which Prisma deserializes as a `string`. Before encryption, it contains
 * a JSON object, which Prisma deserializes as an `object`.
 */
function isAlreadyEncrypted(customKeys: unknown): boolean {
  if (typeof customKeys === "string") return true;
  return false;
}

/**
 * Migrate a single ModelProvider row's customKeys.
 *
 * Pure function: takes a row, returns the encrypted value or null if
 * no migration is needed (already encrypted, null, or undefined).
 */
export function migrateModelProviderKeysRow({
  row,
}: {
  row: ModelProviderRow;
}): string | null {
  // Null/undefined: nothing to migrate
  if (row.customKeys == null) return null;

  // Already encrypted: skip
  if (isAlreadyEncrypted(row.customKeys)) return null;

  // Plaintext JSON object: serialize and encrypt
  const serialized = JSON.stringify(row.customKeys);
  return encrypt(serialized);
}

// ============================================================================
// Task entry point (called by pnpm task migrateModelProviderKeys)
// ============================================================================

export default async function main() {
  console.log("Starting model provider keys encryption migration...");

  const projects = await prisma.project.findMany({
    select: { id: true },
  });

  console.log(`Found ${projects.length} projects to process.`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const project of projects) {
    const rows = await prisma.modelProvider.findMany({
      where: { projectId: project.id },
      select: {
        id: true,
        projectId: true,
        customKeys: true,
      },
    });

    for (const row of rows) {
      const encryptedKeys = migrateModelProviderKeysRow({ row });

      if (encryptedKeys === null) {
        skippedCount++;
        continue;
      }

      await prisma.modelProvider.update({
        where: { id: row.id, projectId: row.projectId },
        data: { customKeys: encryptedKeys },
      });
      updatedCount++;
      console.log(`  Encrypted keys for provider ${row.id}`);
    }
  }

  console.log(
    `Migration complete. Updated: ${updatedCount}, Skipped: ${skippedCount}`
  );
}

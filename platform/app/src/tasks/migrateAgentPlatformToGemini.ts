/**
 * Data migration: fold Google Agent Platform provider rows into Gemini.
 *
 * Background:
 * - Agent Platform shipped briefly as its own provider
 *   (`google_agent_platform`), holding a key, project and location.
 * - It is actually Gemini's second door: same models, same wire shape,
 *   different host — so the provider folded into `gemini`, whose
 *   credential now optionally carries the project and location
 *   (specs/model-providers/google-agent-platform.feature).
 * - Rows stored under the old provider would otherwise be orphaned: the
 *   registry no longer knows `google_agent_platform`, so the UI hides
 *   them and nothing can dispatch them.
 *
 * The fold renames the credential fields and flips the provider column;
 * scope entries, enabled state and everything else on the row stay
 * untouched. Idempotent: reruns find no `google_agent_platform` rows.
 *
 * Usage:
 *   pnpm task migrateAgentPlatformToGemini
 */

import { prisma } from "../server/db";
import { decrypt, encrypt } from "../utils/encryption";

// ============================================================================
// Pure migration logic (no DB dependency)
// ============================================================================

/**
 * Field-name mapping from the retired provider's credential shape to
 * Gemini's. Values pass through untouched — only the names change.
 */
const KEY_RENAMES: Record<string, string> = {
  GOOGLE_AGENT_PLATFORM_API_KEY: "GEMINI_API_KEY",
  GOOGLE_AGENT_PLATFORM_PROJECT: "GEMINI_PROJECT",
  GOOGLE_AGENT_PLATFORM_LOCATION: "GEMINI_LOCATION",
};

/**
 * Rename an Agent Platform credential's fields to the Gemini names.
 *
 * Pure function, exported for the unit test binding the migration
 * scenario. Unknown fields pass through under their own names so a row
 * that somehow carries extras loses nothing.
 */
export function foldAgentPlatformKeys(
  customKeys: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(customKeys).map(([key, value]) => [
      KEY_RENAMES[key] ?? key,
      value,
    ]),
  );
}

/**
 * The display name the folded row should carry. A row still wearing the
 * retired provider's default name becomes "Gemini" (suffixed if the
 * organization already has one, matching the create-time convention);
 * a customer-renamed row keeps its name.
 */
export function foldedRowName({
  currentName,
  takenNames,
}: {
  currentName: string;
  takenNames: string[];
}): string {
  if (currentName !== "Google Agent Platform") return currentName;
  if (!takenNames.includes("Gemini")) return "Gemini";
  let suffix = 2;
  while (takenNames.includes(`Gemini ${suffix}`)) suffix += 1;
  return `Gemini ${suffix}`;
}

// ============================================================================
// Task entry point
// ============================================================================

export default async function execute() {
  const rows = await prisma.modelProvider.findMany({
    where: { provider: "google_agent_platform" },
    select: {
      id: true,
      name: true,
      organizationId: true,
      customKeys: true,
    },
  });

  console.log(`Found ${rows.length} google_agent_platform row(s) to fold`);

  for (const row of rows) {
    // customKeys is encrypted as a whole JSON blob (see
    // ModelProviderRepository.encryptCustomKeys), so the rename has to
    // happen through decrypt/encrypt rather than in SQL.
    let foldedKeys: string | null = null;
    if (typeof row.customKeys === "string") {
      const decrypted: unknown = JSON.parse(decrypt(row.customKeys));
      if (decrypted && typeof decrypted === "object") {
        foldedKeys = encrypt(
          JSON.stringify(
            foldAgentPlatformKeys(decrypted as Record<string, unknown>),
          ),
        );
      }
    }

    const siblings = await prisma.modelProvider.findMany({
      where: {
        organizationId: row.organizationId,
        provider: "gemini",
      },
      select: { name: true },
    });

    await prisma.modelProvider.update({
      where: { id: row.id },
      data: {
        provider: "gemini",
        name: foldedRowName({
          currentName: row.name,
          takenNames: siblings.map((s) => s.name),
        }),
        ...(foldedKeys === null ? {} : { customKeys: foldedKeys }),
      },
    });

    console.log(`Folded row ${row.id} into gemini`);
  }

  console.log("Done");
}

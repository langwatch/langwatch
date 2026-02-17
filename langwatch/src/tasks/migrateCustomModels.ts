/**
 * Data migration: Convert legacy string[] custom models to CustomModelEntry[] objects.
 *
 * Background:
 * - ModelProvider.customModels and customEmbeddingsModels were stored as string[]
 * - The new system stores CustomModelEntry[] objects with full metadata
 * - Registry models are now always included automatically, so any legacy entries
 *   that match the registry should be dropped
 *
 * This script is idempotent: if data is already in object format, it is skipped.
 *
 * Usage:
 *   pnpm task migrateCustomModels
 */

import { prisma } from "../server/db";
import type { CustomModelEntry } from "../server/modelProviders/customModel.schema";
import { isLegacyCustomModels } from "../server/modelProviders/customModel.schema";
import { getProviderModelOptions } from "../server/modelProviders/registry";

// ============================================================================
// Types
// ============================================================================

/** Minimal row shape needed by the migration logic */
interface ModelProviderRow {
  id: string;
  provider: string;
  customModels: unknown;
  customEmbeddingsModels: unknown;
}

/** Return type for registry lookup (matches getProviderModelOptions signature) */
type RegistryLookup = (
  provider: string,
  mode: "chat" | "embedding",
) => { value: string; label: string }[];

/** Result of migrating a single row. null means no update needed. */
type MigrationResult = {
  customModels: CustomModelEntry[] | null;
  customEmbeddingsModels: CustomModelEntry[] | null;
} | null;

// ============================================================================
// Default parameters for converted models
// ============================================================================

const CHAT_DEFAULTS = {
  supportedParameters: ["temperature"],
  maxTokens: 8192,
} as const;

const EMBEDDING_DEFAULTS = {
  supportedParameters: [] as string[],
  maxTokens: null,
} as const;

// ============================================================================
// Pure migration logic (no DB dependency)
// ============================================================================

/**
 * Convert a single legacy model string to a CustomModelEntry object.
 */
function convertStringToEntry({
  modelId,
  mode,
}: {
  modelId: string;
  mode: "chat" | "embedding";
}): CustomModelEntry {
  const defaults = mode === "chat" ? CHAT_DEFAULTS : EMBEDDING_DEFAULTS;

  return {
    modelId,
    displayName: modelId,
    mode,
    maxTokens: defaults.maxTokens,
    supportedParameters: [...defaults.supportedParameters] as CustomModelEntry["supportedParameters"],
  };
}

/**
 * Migrate a single field (customModels or customEmbeddingsModels).
 *
 * @returns The migrated array, or null if no migration is needed (already migrated or null input)
 */
function migrateField({
  value,
  mode,
  registryModelIds,
}: {
  value: unknown;
  mode: "chat" | "embedding";
  registryModelIds: Set<string>;
}): CustomModelEntry[] | null {
  // Null/undefined: nothing to migrate
  if (value == null) return null;

  // Not an array: nothing to migrate
  if (!Array.isArray(value)) return null;

  // Already in new format (first element has modelId property): skip
  if (!isLegacyCustomModels(value)) return null;

  // Empty legacy array: also nothing to migrate
  if (value.length === 0) return null;

  // Filter out registry models and convert the rest
  const filtered = (value as string[]).filter(
    (modelId) => !registryModelIds.has(modelId),
  );

  return filtered.map((modelId) => convertStringToEntry({ modelId, mode }));
}

/**
 * Migrate a single ModelProvider row's custom models data.
 *
 * Pure function: takes a row and a registry lookup function, returns the
 * migrated fields or null if no update is needed.
 */
export function migrateCustomModelsRow({
  row,
  registryLookup,
}: {
  row: ModelProviderRow;
  registryLookup: RegistryLookup;
}): MigrationResult {
  const chatRegistryIds = new Set(
    registryLookup(row.provider, "chat").map((m) => m.value),
  );
  const embeddingRegistryIds = new Set(
    registryLookup(row.provider, "embedding").map((m) => m.value),
  );

  const migratedCustomModels = migrateField({
    value: row.customModels,
    mode: "chat",
    registryModelIds: chatRegistryIds,
  });

  const migratedCustomEmbeddingsModels = migrateField({
    value: row.customEmbeddingsModels,
    mode: "embedding",
    registryModelIds: embeddingRegistryIds,
  });

  // If neither field needs migration, return null
  if (migratedCustomModels === null && migratedCustomEmbeddingsModels === null) {
    return null;
  }

  return {
    customModels: migratedCustomModels,
    customEmbeddingsModels: migratedCustomEmbeddingsModels,
  };
}

// ============================================================================
// Task entry point (called by pnpm task migrateCustomModels)
// ============================================================================

export default async function main() {
  console.log("Starting custom models migration...");

  const rows = await prisma.modelProvider.findMany({
    select: {
      id: true,
      provider: true,
      customModels: true,
      customEmbeddingsModels: true,
    },
  });

  console.log(`Found ${rows.length} model provider rows to process.`);

  let updatedCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    const result = migrateCustomModelsRow({
      row,
      registryLookup: getProviderModelOptions,
    });

    if (result === null) {
      skippedCount++;
      continue;
    }

    const updateData: Record<string, unknown> = {};
    if (result.customModels !== null) {
      updateData.customModels = result.customModels;
    }
    if (result.customEmbeddingsModels !== null) {
      updateData.customEmbeddingsModels = result.customEmbeddingsModels;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.modelProvider.update({
        where: { id: row.id },
        data: updateData,
      });
      updatedCount++;
      console.log(
        `  Updated provider ${row.id} (${row.provider}): ` +
          `customModels=${result.customModels?.length ?? "unchanged"}, ` +
          `customEmbeddingsModels=${result.customEmbeddingsModels?.length ?? "unchanged"}`,
      );
    }
  }

  console.log(
    `Migration complete. Updated: ${updatedCount}, Skipped: ${skippedCount}`,
  );
}

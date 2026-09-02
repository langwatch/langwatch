/**
 * The row-level conversions two one-off data migrations perform.
 *
 * Both are PURE, and that is what puts them here rather than in the runner:
 * what a row becomes is the feature's rule, and the walk over the table — which
 * projects, which client, which credential — is the running process's. A runner
 * that also owned the rule would make the rule untestable without a database.
 *
 * The custom-model conversion turns the legacy `string[]` columns into
 * `CustomModelEntry[]` objects, dropping entries the registry now supplies
 * automatically. It is idempotent: a row already in object form is skipped.
 *
 * The credential conversion encrypts a `customKeys` object that was written
 * before the column was encrypted at rest. It is idempotent the same way, and
 * it takes the deployment's own cipher rather than constructing one, because
 * the ciphertext is a WIRE FORMAT: rows written here are read by every process,
 * so a second implementation of the cipher would write rows nothing can read.
 */

import { isLegacyCustomModels, type CustomModelEntry } from "@langwatch/model-provider-contract";
import type { ModelProviderCredentialCipherPort } from "../ports/model-provider.port";

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
    supportedParameters: [
      ...defaults.supportedParameters,
    ] as CustomModelEntry["supportedParameters"],
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
// Credential encryption
// ============================================================================

/** Minimal row shape the credential conversion reads. */
interface ModelProviderCredentialRow {
  id: string;
  customKeys: unknown;
}

/**
 * Whether a `customKeys` value has already been encrypted.
 *
 * The encrypted form is a JSON string holding the ciphertext, which Prisma
 * reads back as a `string`; the plaintext form is a JSON object, which comes
 * back as an `object`. The two types are the whole discriminator, which is what
 * makes a re-run of this migration a no-op instead of a second encryption.
 */
function isAlreadyEncrypted(customKeys: unknown): boolean {
  return typeof customKeys === "string";
}

/**
 * The ciphertext one row's `customKeys` becomes, or `null` when the row needs
 * no update — already encrypted, or holding nothing.
 */
export function migrateModelProviderKeysRow({
  row,
  cipher,
}: {
  row: ModelProviderCredentialRow;
  cipher: ModelProviderCredentialCipherPort;
}): string | null {
  if (row.customKeys == null) return null;
  if (isAlreadyEncrypted(row.customKeys)) return null;

  return cipher.encrypt(JSON.stringify(row.customKeys));
}

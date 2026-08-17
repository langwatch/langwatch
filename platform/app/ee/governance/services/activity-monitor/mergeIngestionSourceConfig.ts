// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Merge of the two config inputs an IngestionSource can be created with.
 *
 * There is one `parserConfig` JSONB column and no `pullConfig` column; the
 * puller worker reads `source.parserConfig` as the adapter config. The
 * service accepts both input names and merges them, and `parserConfig` wins
 * on key conflicts because it is the canonical input for push-mode sources.
 *
 * That default is wrong for a specific set of keys. `adapter` decides which
 * puller runs, `credentials` is what the worker decrypts and presents to the
 * upstream API, and `schedule` decides when. A caller who puts any of those
 * in `parserConfig` — by copying an example, by round-tripping a source
 * through an export, or by mistake — silently redirects or de-authenticates
 * the puller, and the result looks like a configured source that does not
 * work. Those keys belong to pullConfig, so they are stripped from the
 * parserConfig side rather than allowed to win.
 *
 * Extracted from the Prisma `create()` call it used to live inside so
 * precedence is provable without a database.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */

/**
 * Keys that belong to the pull config and must never be taken from
 * `parserConfig`. Framework-level only — adapter-specific transport fields
 * are validated by each adapter's own schema.
 */
export const PULL_CONFIG_OWNED_FIELDS = [
  "adapter",
  "credentials",
  "schedule",
] as const;

export type PullConfigOwnedField = (typeof PULL_CONFIG_OWNED_FIELDS)[number];

export interface MergeConfigInput {
  pullConfig?: Record<string, unknown> | null;
  parserConfig?: Record<string, unknown> | null;
}

export interface MergeConfigResult {
  merged: Record<string, unknown>;
  /**
   * Keys dropped from `parserConfig` because pullConfig owns them. Non-empty
   * means the caller sent something that would have silently changed puller
   * behaviour; worth logging, and worth asserting in tests.
   */
  strippedFromParserConfig: PullConfigOwnedField[];
}

/**
 * Merge pull and parser config. `parserConfig` wins in general; pullConfig
 * wins for the keys it owns.
 */
export function mergeIngestionSourceConfig({
  pullConfig,
  parserConfig,
}: MergeConfigInput): MergeConfigResult {
  const pull = pullConfig ?? {};
  const parser = parserConfig ?? {};

  const strippedFromParserConfig: PullConfigOwnedField[] = [];
  const parserWithoutOwned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(parser)) {
    const owned = PULL_CONFIG_OWNED_FIELDS.find((field) => field === key);
    // Only a conflict if pullConfig actually supplied the key. A push-mode
    // source with no pullConfig at all keeps whatever it sent.
    if (owned !== undefined && Object.hasOwn(pull, key)) {
      strippedFromParserConfig.push(owned);
      continue;
    }
    parserWithoutOwned[key] = value;
  }

  return {
    merged: { ...pull, ...parserWithoutOwned },
    strippedFromParserConfig,
  };
}

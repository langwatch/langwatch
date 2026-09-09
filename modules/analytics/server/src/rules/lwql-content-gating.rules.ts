/**
 * LangWatchQL analytics SQL — where captured content lives, derived rather than listed.
 * @see @langwatch/data-privacy-contract — the source of truth
 * @see specs/analytics/lwql-api.feature
 */

import {
  CONTENT_CATEGORIES,
  CONTENT_KEY_CATALOG,
  type ContentCategory,
} from "@langwatch/data-privacy-contract";
import type { FieldProtection } from "./lwql-field-protection.rules.ts";
import { clickHouseLiteral } from "./langwatch-ql-sql-literal.rules.ts";

/**
 * Which read-time gate governs each data-privacy content category.
 */
const CATEGORY_GATE: Record<ContentCategory, FieldProtection> = {
  input: "input",
  output: "output",
  system: "input",
  tools: "input",
};

/**
 * Every span-attribute key that carries captured content, in the data-privacy catalog's own
 * spelling, sorted so the generated SQL is stable across runs.
 */
export const CONTENT_ATTRIBUTE_KEYS: readonly string[] = CONTENT_CATEGORIES.flatMap(
  (category) => CONTENT_KEY_CATALOG[category],
)
  .filter((key, index, keys) => keys.indexOf(key) === index)
  .sort();

/**
 * Key prefixes that carry the same content in exploded form. SDKs that emit indexed message
 * arrays write `gen_ai.prompt.0.content` rather than `gen_ai.prompt`, so an exact-key filter
 * alone would drop the blob and leave the pieces.
 */
export const CONTENT_ATTRIBUTE_KEY_PREFIXES: readonly string[] = CONTENT_ATTRIBUTE_KEYS.map(
  (key) => `${key}.`,
);

/** The gate governing a content category, per {@link CATEGORY_GATE}. */
export function gateForContentCategory(category: ContentCategory): FieldProtection {
  return CATEGORY_GATE[category];
}

/**
 * Whether an attribute key carries captured content. The runtime twin of the SQL predicate
 * {@link contentKeyExclusionSql} builds, so a test can assert the two agree on a key rather
 * than trusting that the generated SQL says what this says.
 */
export function isContentAttributeKey(key: string): boolean {
  return (
    CONTENT_ATTRIBUTE_KEYS.includes(key) ||
    CONTENT_ATTRIBUTE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/**
 * The `mapFilter` lambda body that keeps a map key, as ClickHouse SQL. `k` is the lambda's key
 * parameter.
 */
export function contentKeyExclusionSql(keyParameter = "k"): string {
  const keys = CONTENT_ATTRIBUTE_KEYS.map((value) => clickHouseLiteral(value)).join(", ");
  const prefixes = CONTENT_ATTRIBUTE_KEY_PREFIXES.map((value) => clickHouseLiteral(value)).join(
    ", ",
  );
  return (
    `${keyParameter} NOT IN (${keys}) ` +
    `AND NOT arrayExists(p -> startsWith(${keyParameter}, p), [${prefixes}])`
  );
}

/**
 * A `Map` column with every content-carrying key removed.
 */
export function contentFilteredMapSql(qualifiedColumn: string): string {
  return `mapFilter((k, v) -> ${contentKeyExclusionSql("k")}, ${qualifiedColumn})`;
}

/**
 * Governed analytics SQL — where captured content lives, derived rather than
 * listed.
 *
 * The governed views must never smuggle captured customer content past the
 * visibility policy. Two shapes carry it:
 *
 *  1. Dedicated columns (`trace_summaries.ComputedInput`, …), each declared in
 *     the catalog with the gate that governs it.
 *  2. Keys *inside* an attribute map (`stored_spans.SpanAttributes`), which no
 *     ClickHouse grant can reach — column grants gate columns, not map keys.
 *
 * This module answers (2) by deriving the content keys from the data-privacy
 * policy's own catalog, {@link CONTENT_KEY_CATALOG}, so the views cannot drift
 * from the policy that decides what "content" means. A second hand-written list
 * would be a second thing to keep in sync, and the one that goes stale is
 * always the copy.
 *
 * @see ../../../data-privacy/dropKeyCatalog.ts — the source of truth
 * @see specs/analytics/governed-sql-api.feature
 */

import {
  CONTENT_CATEGORIES,
  type ContentCategory,
} from "../../../data-privacy/dataPrivacy.types";
import { CONTENT_KEY_CATALOG } from "../../../data-privacy/dropKeyCatalog";
import type { FieldProtection } from "../../../traces/projection/catalog";
import { clickHouseLiteral } from "../sqlText";

/**
 * Which read-time gate governs each data-privacy content category.
 *
 * `Protections` collapses the four categories onto two captured-content flags
 * (`canSeeCapturedInput` / `canSeeCapturedOutput`), because system instructions
 * and tool calls ride inside the captured conversation rather than having a
 * read-time flag of their own — see `dropKeyCatalog.ts`, which strips the
 * `system` and `tools` roles out of the same chat arrays the input and output
 * keys hold. Mapping them onto the input gate keeps them behind a permission
 * rather than inventing a third flag no caller can be checked against.
 */
const CATEGORY_GATE: Record<ContentCategory, FieldProtection> = {
  input: "input",
  output: "output",
  system: "input",
  tools: "input",
};

/**
 * Every span-attribute key that carries captured content, in the data-privacy
 * catalog's own spelling, sorted so the generated SQL is stable across runs.
 *
 * The union of all four categories on purpose: a governed view has no viewer,
 * so it cannot decide per caller which categories are permitted. It removes all
 * of them from the map and re-exposes the ones a caller may see as dedicated,
 * gated columns.
 */
export const CONTENT_ATTRIBUTE_KEYS: readonly string[] = [
  ...new Set(
    CONTENT_CATEGORIES.flatMap((category) => CONTENT_KEY_CATALOG[category]),
  ),
].sort();

/**
 * Key prefixes that carry the same content in exploded form.
 *
 * SDKs that emit indexed message arrays write `gen_ai.prompt.0.content` rather
 * than `gen_ai.prompt`, so an exact-key filter alone would drop the blob and
 * leave the pieces. Derived from the exact keys (`<key>.`) rather than written
 * out, so a key added to the data-privacy catalog brings its exploded form with
 * it.
 */
export const CONTENT_ATTRIBUTE_KEY_PREFIXES: readonly string[] =
  CONTENT_ATTRIBUTE_KEYS.map((key) => `${key}.`);

/** The gate governing a content category, per {@link CATEGORY_GATE}. */
export function gateForContentCategory(
  category: ContentCategory,
): FieldProtection {
  return CATEGORY_GATE[category];
}

/**
 * Whether an attribute key carries captured content.
 *
 * The runtime twin of the SQL predicate {@link contentKeyExclusionSql} builds,
 * so a test can assert the two agree on a key rather than trusting that the
 * generated SQL says what this says.
 */
export function isContentAttributeKey(key: string): boolean {
  return (
    CONTENT_ATTRIBUTE_KEYS.includes(key) ||
    CONTENT_ATTRIBUTE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/**
 * The `mapFilter` lambda body that keeps a map key, as ClickHouse SQL.
 *
 * `k` is the lambda's key parameter. Written as a positive "keep" predicate
 * because that is what `mapFilter` takes; the negation lives here rather than
 * at each call site, where getting it backwards would silently expose exactly
 * the keys it was meant to remove.
 */
export function contentKeyExclusionSql(keyParameter = "k"): string {
  const keys = CONTENT_ATTRIBUTE_KEYS.map(clickHouseLiteral).join(", ");
  const prefixes =
    CONTENT_ATTRIBUTE_KEY_PREFIXES.map(clickHouseLiteral).join(", ");
  return (
    `${keyParameter} NOT IN (${keys}) ` +
    `AND NOT arrayExists(p -> startsWith(${keyParameter}, p), [${prefixes}])`
  );
}

/**
 * A `Map` column with every content-carrying key removed.
 *
 * The map is the one place a governed view can leak content without naming a
 * gated column, so the filter is applied to *every* map the views expose —
 * including resource attributes, where content has no business being but an SDK
 * is free to put it.
 *
 * Takes the column already qualified with the view's source alias, because a
 * bare name inside a view body resolves to a projection alias of the same name.
 */
export function contentFilteredMapSql(qualifiedColumn: string): string {
  return `mapFilter((k, v) -> ${contentKeyExclusionSql("k")}, ${qualifiedColumn})`;
}

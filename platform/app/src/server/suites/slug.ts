/**
 * Suite slugs.
 *
 * Test suite slugs and run plan slugs share one per-project namespace, enforced by
 * the unique (projectId, slug). A name a person picks may already be slugged by
 * another suite, so the slug takes a numeric suffix rather than the write being
 * refused.
 *
 * A run plan's slug is derived from its NAME, never from its config: two plans
 * may hold the same config and differ only by name, so a config-derived key
 * collides. See specs/suites/run-plan-identity-by-name.feature.
 */

import { nanoid } from "nanoid";

/** How many numeric suffixes are tried before a random one is used. */
const MAX_NUMERIC_SUFFIX = 102;

/**
 * The first free slug of the `<base>`, `<base>-2`, `<base>-3` ... series, or a
 * randomly suffixed one after {@link MAX_NUMERIC_SUFFIX} candidates.
 *
 * `takenSlugs` may hold any slug of the project; only the ones matching the
 * series are considered, so an unrelated slug never pushes the counter up.
 */
export function pickFreeSlug(params: {
  baseSlug: string;
  takenSlugs: Iterable<string>;
}): string {
  const escaped = params.baseSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const seriesPattern = new RegExp(`^${escaped}(-\\d+)?$`);
  const taken = new Set(
    [...params.takenSlugs].filter((slug) => seriesPattern.test(slug)),
  );

  if (!taken.has(params.baseSlug)) {
    return params.baseSlug;
  }
  for (let index = 2; index <= MAX_NUMERIC_SUFFIX; index++) {
    const candidate = `${params.baseSlug}-${index}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${params.baseSlug}-${nanoid(8)}`;
}

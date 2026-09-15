/**
 * The Default test suite: every scenario belongs to exactly one; a write
 * naming none files here. `testSuiteId` stays nullable — enforced on the write path.
 */

/** The name the migration wrote and the write path recreates. */
export const DEFAULT_SUITE_NAME = "Default";

/** The slug the Default suite takes when the project has it free. */
export const DEFAULT_SUITE_SLUG = "default";

/** How many numeric suffixes are tried before a random one is used. */
const MAX_NUMERIC_SUFFIX = 102;

/**
 * The first free slug of the `<base>`, `<base>-2`, ... series. `takenSlugs`
 * may hold any project slug; only matching ones count.
 */
export function pickFreeSuiteSlug(params: {
  baseSlug: string;
  takenSlugs: Iterable<string>;
  randomSuffix: () => string;
}): string {
  const escaped = params.baseSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const seriesPattern = new RegExp(`^${escaped}(-\\d+)?$`);
  const taken = new Set([...params.takenSlugs].filter((slug) => seriesPattern.test(slug)));

  if (!taken.has(params.baseSlug)) return params.baseSlug;
  for (let index = 2; index <= MAX_NUMERIC_SUFFIX; index++) {
    const candidate = `${params.baseSlug}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${params.baseSlug}-${params.randomSuffix()}`;
}

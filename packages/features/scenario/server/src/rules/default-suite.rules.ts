/**
 * The Default test suite.
 *
 * Every scenario belongs to exactly one suite. A caller that writes a scenario
 * without naming one files it here, and the project's Default suite is created
 * on that first write if it has none. `Scenario.testSuiteId` stays nullable, so
 * the invariant is enforced on the write path and not by the column: an
 * archived scenario keeps whatever suite it had, and a code-pushed scenario has
 * no row at all.
 *
 * @see specs/suites/default-suite.feature
 */

/** The name the migration wrote and the write path recreates. */
export const DEFAULT_SUITE_NAME = "Default";

/** The slug the Default suite takes when the project has it free. */
export const DEFAULT_SUITE_SLUG = "default";

/** How many numeric suffixes are tried before a random one is used. */
const MAX_NUMERIC_SUFFIX = 102;

/**
 * The first free slug of the `<base>`, `<base>-2`, `<base>-3` ... series.
 *
 * `takenSlugs` may hold any slug of the project; only the ones matching the
 * series are considered, so an unrelated slug never pushes the counter up.
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

const INTERNAL_SET_PREFIX = "__internal__";
export const SUITE_SET_SUFFIX = "__suite";

export function isSuiteSetId(setId: string): boolean {
  return setId.startsWith(INTERNAL_SET_PREFIX) && setId.endsWith(SUITE_SET_SUFFIX);
}

export function getSuiteSetId(suiteId: string): string {
  return `${INTERNAL_SET_PREFIX}${suiteId}${SUITE_SET_SUFFIX}`;
}

export function tryExtractSuiteId(setId: string): string | null {
  if (!isSuiteSetId(setId)) return null;
  return setId.slice(INTERNAL_SET_PREFIX.length, -SUITE_SET_SUFFIX.length);
}

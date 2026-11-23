/**
 * Whether a sidebar section is open: collapsed by default, open when its field
 * is filtered on, and the reader's own open or close always wins.
 * See specs/traces-v2/filter-bar-interactions.feature.
 */
export function isSectionOpen({
  readerChoice,
  filtered,
}: {
  readerChoice: boolean | undefined;
  filtered: boolean;
}): boolean {
  return readerChoice ?? filtered;
}

/**
 * The pure part of regenerating the built-in statement list: which commits it names.
 * @see specs/lwql/query-origin.feature
 */

/**
 * The covered commits, newest first. A newer fixture commit goes to the front and older
 * versions to the back, so the oldest commit stays the oldest. Blank commits are dropped.
 */
export function mergeCoverageCommits({
  existing,
  newest,
  older,
}: {
  existing: readonly string[];
  newest: string;
  older: readonly string[];
}): string[] {
  const merged = existing.includes(newest) || newest === "" ? [...existing] : [newest, ...existing];
  for (const commit of older) if (commit !== "" && !merged.includes(commit)) merged.push(commit);
  return merged;
}

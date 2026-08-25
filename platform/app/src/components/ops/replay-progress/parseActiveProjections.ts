/**
 * Parses the "+"-delimited `currentProjection` status string into the list
 * of projection names currently being replayed.
 */
export function parseActiveProjections(currentProjection?: string | null): string[] {
  return currentProjection?.split("+").filter(Boolean) ?? [];
}

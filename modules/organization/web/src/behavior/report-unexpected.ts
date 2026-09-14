/** Diagnostic logging for cache-invalidation failures: already confirmed to user. */

export function reportUnexpected(error: unknown, tags: Record<string, string>): void {
  console.error("[organization-web]", tags, error);
}

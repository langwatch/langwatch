/**
 * Auto-generated commit message for a version created by syncing local
 * (CLI/SDK) config data over an existing remote version, used when the
 * caller did not supply their own commit message. Reuses the differences
 * already computed by `compareConfigContent` so the message says what
 * actually changed instead of a generic "Updated from local file".
 */
export function describeLocalFileUpdate(differences: string[] | undefined): string {
  if (!differences?.length) {
    return "Updated from local file";
  }
  return `Updated from local file (${differences.join("; ")})`;
}

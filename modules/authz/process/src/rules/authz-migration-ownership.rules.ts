/**
 * The sources this migration owns in the Grant head — its own, plus the
 * three-stage rollout it replaces (ADR-110 collapsed genesis-import,
 * backfill-b and cutover-import into this one migration).
 */
export const MIGRATION_OWNED_SOURCES = [
  "migration",
  "genesis-import",
  "backfill-b",
  "cutover-import",
] as const;

export function isMigrationOwnedSource(source: string): boolean {
  return (MIGRATION_OWNED_SOURCES as readonly string[]).includes(source);
}

/**
 * The D01 backfill's name — the stable state-table key the write gate reads
 * and the migration registers under, so the latch and the migration share
 * one constant. Renaming orphans every stored record (the standard
 * migration-name rule); what operators read is the migration's `title`.
 */
export const IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME =
  "identity-d01-identifier-backfill" as const;

/**
 * The D01 backfill's name — the stable state-table key the write gate reads
 * and the migration registers under, so the latch and the migration share
 * one constant. Renaming orphans every stored record (the standard
 * migration-name rule); what operators read is the migration's `title`.
 */
export const IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME =
  "identity-d01-identifier-backfill" as const;

/**
 * The D04 connection grandfather's name — the stable state-table key. Nothing
 * reads it as a latch today: the routing flip is `SSOCONN_ROUTING`, not this
 * record, because the flag has to be rollable back in one move fleet-wide
 * while finalization is per organization. What the record carries is the
 * routing proof's verdict, which is what the flip's exit gate reads.
 */
export const IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME =
  "identity-d04-connection-grandfather" as const;

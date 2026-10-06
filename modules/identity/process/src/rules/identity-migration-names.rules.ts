/**
 * The D01 backfill's name — the stable state-table key the write gate reads
 * and the migration registers under. Renaming orphans every stored record;
 * operators read the migration's `title` instead.
 */
export const IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME =
  "identity-d01-identifier-backfill" as const;

/**
 * The SSO domain-ownership backfill's name — the stable state-table key.
 * It writes the ownership rows for connections folded before the fold wrote them.
 */
export const IDENTITY_SSO_DOMAIN_OWNERSHIP_MIGRATION_NAME =
  "identity-sso-domain-ownership-backfill" as const;

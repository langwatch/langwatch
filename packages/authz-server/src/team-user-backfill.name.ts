/** The backfill's registered migration name. Lives alone so the legacy
 *  fallback gate (which the browser evaluates via the package root) can
 *  read it without pulling the migration itself — the migration needs
 *  `node:crypto` for grant identity and is server-only behind the
 *  `./migration` subpath. */
export const TEAM_USER_BACKFILL_MIGRATION_NAME = "authz-team-user-backfill";

/** The genesis import's registered migration name. Lives alone for the same
 *  reason the backfill's does: a browser-reachable module may need to name
 *  the migration, while the migration itself needs `node:crypto` for grant
 *  identity and stays behind the server-only `./migration` subpath. */
export const GRANTS_GENESIS_IMPORT_MIGRATION_NAME =
  "authz-grants-genesis-import";

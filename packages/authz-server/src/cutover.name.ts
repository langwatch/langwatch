/** The cutover migration's registered migration name. Lives alone for the
 *  same reason the other two do: the rollback wiring and the ops surface
 *  name the migration from modules that must not pull the migration itself —
 *  it needs `node:crypto` for grant identity and stays behind the
 *  server-only `./migration` subpath. */
export const GRANTS_CUTOVER_MIGRATION_NAME = "authz-grants-cutover";

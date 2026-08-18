/**
 * `@langwatch/authz-server/migration` — the backfill runner's entrypoint,
 * split from the package root on purpose. The root entry is (indirectly)
 * evaluated by the browser today: the app's client bundle reaches
 * `server/api/rbac.ts` through `utils/permissionsConfig.ts`, and rbac pulls
 * the shadow fork, which imports this package. Everything on the root is
 * therefore browser-evaluable by construction — pure reducers, mappings,
 * service classes. Grant identity derivation is not (`node:crypto`, KSUID),
 * so the migration that needs it lives behind this server-only subpath.
 */
export { GRANTS_CUTOVER_MIGRATION_NAME } from "./cutover.name";
export {
  GrantsCutoverMigration,
  normalizedAdminEmails,
  PLATFORM_AUTHZ_TENANT_ID,
} from "./cutover.migration";
export type {
  CutoverDeps,
  CutoverResourceDiff,
  UnmatchedAdminEmailsReport,
} from "./cutover.migration";
export { GRANTS_GENESIS_IMPORT_MIGRATION_NAME } from "./genesis-import.name";
export {
  GENESIS_ACTOR_ID,
  GrantsGenesisImportMigration,
} from "./genesis-import.migration";
export type {
  GenesisDiff,
  GenesisImportDeps,
} from "./genesis-import.migration";
export { bindingIdentityKey, deriveGrantId } from "./ledger/grant-identity";
export { TeamUserBackfillMigration } from "./team-user-backfill.migration";
export type {
  BackfillGrantEmission,
  GrantsLedgerEmitter,
  ParityDiff,
  TeamUserBackfillDeps,
} from "./team-user-backfill.migration";

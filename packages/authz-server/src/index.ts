/**
 * @langwatch/authz-server — the server-side runtime of the unified
 * authorization engine (ADR-092), in the app-layer service/repository
 * shape: service CLASSES over repository INTERFACES.
 *
 *   AuthzCollectorService   COLLECT policies over AuthzReadRepository
 *   AuthzService            can / check / authorize / effectivePermissions
 *                           (+ the §9 owner ceiling and the §12 epoch cache
 *                           inside the instance)
 *   GrantsService           the one write surface, over AuthzGrantsRepository
 *   AuthzShadowService      the legacy resolvers' engine comparison
 *
 * No storage engine lives here, and no environment read either: every knob
 * arrives as a closure through a service's options. The app implements the
 * repository interfaces with Prisma
 * (platform/app/src/server/authz/repositories/) and composes everything
 * once in its runtime (platform/app/src/server/authz/runtime.ts). The pure
 * half (registry, roles, decide()) is `@langwatch/authz`.
 */
export { AuthzCollectorService } from "./authz-collector.service";
export type { AuthzCollectorOptions } from "./authz-collector.service";
export {
  BindingMissingError,
  type BindingPrincipalWhere,
  DuplicateBindingError,
  type AuthzGrantsRepository,
  type GrantWriteActor,
  type OffboardCounts,
  type RoleBindingWrite,
} from "./authz-grants.repository";
export type {
  AuthzReadRepository,
  CustomRolePermissionsRow,
  OrganizationRole,
  ScopeLineageRepository,
  ShareLinkRow,
} from "./authz-read.repository";
export type {
  AuthzGenesisRepository,
  AuthzMigrationRepository,
  ExistingTeamBinding,
  LegacyBindingRow,
  LegacyRoleRow,
  LegacyTeamRow,
  OrganizationMemberFact,
  OrganizationScopeInventory,
  RoleHeadRow,
  TeamBindingWrite,
} from "./authz-migration.repository";
export { AuthzShadowService } from "./authz-shadow.service";
export type { AuthzShadowOptions } from "./authz-shadow.service";
export { AuthzService } from "./authz.service";
export type {
  AuthzEpochReader,
  AuthzServiceOptions,
} from "./authz.service";
export { DuplicateGrantError, GrantValidationError } from "./grant-validation";
export { GrantsService } from "./grants.service";
export type {
  AuthzAuditWriter,
  AuthzEpochBumper,
  GrantPrincipal,
  GrantRole,
  GrantsServiceDeps,
} from "./grants.service";
export { OffboardIncompleteError } from "./offboard";
export type { OffboardResult } from "./offboard";
export { TEAM_USER_BACKFILL_MIGRATION_NAME } from "./team-user-backfill.name";
export {
  grantFactToCompatBinding,
  grantFactToRow,
  grantRowToFact,
  roleFactToRow,
  roleRowToFact,
} from "./ledger/projection-mapping";
export type {
  CompatBindingRowShape,
  GrantPrincipalTypeDb,
  GrantRowShape,
  GrantScopeTypeDb,
  RoleRowShape,
} from "./ledger/projection-mapping";
export {
  emptyGrantsLedgerState,
  reduceGrantsLedger,
} from "./ledger/grants-ledger.reducer";
export type {
  GrantEventSource,
  GrantFact,
  GrantsLedgerActor,
  GrantsLedgerCutover,
  GrantsLedgerEvent,
  GrantsLedgerState,
  LedgerMigrationStatus,
  LedgerMigrationTenantState,
  LedgerPrincipal,
  LedgerPrincipalType,
  LedgerScope,
  LedgerScopeType,
  LegacyBindingRole,
  ResourceGrantTerms,
  RoleFact,
} from "./ledger/grants-ledger.reducer";

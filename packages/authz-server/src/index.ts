/**
 * @langwatch/authz-server — the server-side runtime of the unified
 * authorization engine (ADR-092), in the app-layer service/repository
 * shape: service CLASSES over repository INTERFACES.
 *
 *   AuthzCollectorService   COLLECT policies over AuthzReadRepository
 *   AuthzService            can / check / authorize / effectivePermissions,
 *                           plus the id-shaped checkByIds / canAnyByIds /
 *                           canBatchByIds for callers holding ids rather
 *                           than a resolved scope (+ the §9 owner ceiling
 *                           and the §12 epoch cache inside the instance)
 *   GrantsService           the one write surface, over AuthzGrantsRepository
 *
 * No storage engine lives here, and no environment read either: every knob
 * arrives as a closure through a service's options. The app implements the
 * repository interfaces with Prisma
 * (platform/app/src/server/app-layer/authz/repositories/) and composes everything
 * once in its runtime (platform/app/src/server/app-layer/authz/runtime.ts). The pure
 * half (registry, roles, decide()) is `@langwatch/authz`.
 */
export { AuthzCollectorService } from "./authz-collector.service";
export type { AuthzCollectorOptions } from "./authz-collector.service";
export {
  BindingMissingError,
  type BindingPrincipalWhere,
  DuplicateBindingError,
  type AuthzGrantsRepository,
  type OffboardCounts,
  type RoleBindingWrite,
} from "./authz-grants.repository";
export type {
  AuthzReadRepository,
  CustomRolePermissionsRow,
  OrganizationMembership,
  OrganizationRole,
  ScopeLineageRepository,
  ShareLinkRow,
} from "./authz-read.repository";
export type {
  AuthzCutoverRepository,
  AuthzGenesisRepository,
  AuthzMigrationRepository,
  ExistingTeamBinding,
  ExternalMemberFact,
  GrantHeadRow,
  LegacyBindingRow,
  LegacyRoleRow,
  LegacyTeamRow,
  OrganizationMemberFact,
  OrganizationScopeInventory,
  ProjectCredentialFact,
  ResourceGrantRow,
  ResourceGrantUsageSeed,
  RoleHeadRow,
  ShareLinkFactRow,
  TeamBindingWrite,
} from "./authz-migration.repository";
export { AuthzService } from "./authz.service";
export type {
  AuthzEpochReader,
  AuthzServiceOptions,
} from "./authz.service";
export {
  assertExpiryInFuture,
  DuplicateGrantError,
  GrantExpiryInPastError,
  GrantExpiryUnsupportedError,
  GrantValidationError,
} from "./grant-validation";
export { GrantsService } from "./grants.service";
export type {
  AuthzAuditWriter,
  AuthzEpochBumper,
  GrantActor,
  GrantPrincipal,
  GrantRole,
  GrantsServiceDeps,
} from "./grants.service";
export { OffboardIncompleteError } from "./offboard";
export type { OffboardResult } from "./offboard";
export {
  grantFactToCompatBinding,
  grantFactToCompatShareLink,
  grantFactToRow,
  grantRowToFact,
  groupMembershipFactToRow,
  groupMembershipRowToFact,
  PRINCIPAL_TO_DB,
  RESOURCE_KIND_TO_DB,
  roleFactToRow,
  roleRowToFact,
  SHARE_LINK_PERMISSION,
  SHARE_VISIBILITY_BY_PRINCIPAL,
  SHARE_VISIBILITY_BY_PRINCIPAL_DB,
  shareVisibilityAudience,
} from "./ledger/projection-mapping";
export type {
  CompatBindingRowShape,
  CompatShareLinkRowShape,
  GrantPrincipalTypeDb,
  GrantResourceKindDb,
  GrantRowShape,
  GrantScopeTypeDb,
  GroupMembershipRowShape,
  RoleRowShape,
  ShareLinkAudience,
} from "./ledger/projection-mapping";
// Grant identity derivation is deliberately NOT re-exported here: it imports
// `node:crypto`, and this root entry is browser-evaluable by construction
// (see the header of ./migration.ts). The values live on
// `@langwatch/authz-server/migration`; only the erased types stay.
export type {
  BindingIdentityInput,
  BindingIdentityPrincipal,
} from "./ledger/grant-identity";
export {
} from "./ledger/facts";
export {
  GRANT_EVENT_SOURCES,
  groupMembershipAggregateId,
} from "./ledger/facts";
export type {
  GrantEventSource,
  GrantFact,
  GrantsLedgerActor,
  GroupMembershipFact,
  LedgerPrincipal,
  MigrationTenantStatus,
  LedgerPrincipalType,
  LedgerScope,
  LedgerScopeType,
  LegacyBindingRole,
  ResourceGrantTerms,
  RoleFact,
} from "./ledger/facts";

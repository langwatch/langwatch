/**
 * @langwatch/authz-server — the server-side runtime of the unified
 * authorization engine (ADR-092), in the app-layer service/repository
 * shape: service CLASSES over repository INTERFACES.
 *
 *   AuthzCollectorService   COLLECT policies over AuthzReadRepository
 *   AuthzService            can / check / authorize / effectivePermissions
 *                           (+ the §12 epoch cache inside the instance)
 *   GrantsService           the one write surface, over AuthzGrantsRepository
 *   AuthzShadowService      the legacy resolvers' engine comparison
 *
 * No storage engine lives here. The app implements the repository
 * interfaces with Prisma (platform/app/src/server/authz/repositories/) and
 * composes everything once in its runtime
 * (platform/app/src/server/authz/runtime.ts). The pure half (registry,
 * roles, decide()) is `@langwatch/authz`.
 */
export { AuthzCollectorService } from "./authz-collector.service";
export {
  type BindingPrincipalWhere,
  DuplicateBindingError,
  type AuthzGrantsRepository,
  type OffboardCounts,
  type RoleBindingWrite,
} from "./authz-grants.repository";
export type {
  AuthzReadRepository,
  CustomRolePermissionsRow,
  OrganizationRole,
  ShareLinkRow,
} from "./authz-read.repository";
export { AuthzShadowService } from "./authz-shadow.service";
export { AuthzService } from "./authz.service";
export type {
  AuthzEpochReader,
  AuthzServiceOptions,
} from "./authz.service";
export {
  GrantsService,
  GrantValidationError,
  OffboardIncompleteError,
} from "./grants.service";
export type {
  AuthzAuditWriter,
  AuthzEpochBumper,
  GrantPrincipal,
  GrantRole,
  GrantsServiceDeps,
} from "./grants.service";

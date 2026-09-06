export { RoleApp, type RoleAppDependencies, type RoleCaller } from "./app/role.app.ts";
export { createRolesRestApp } from "./transport/api-rest/role.api.ts";
export {
  RoleBindingTrpcApi,
  roleBindingTrpcInputSchemas,
  type RoleBindingTrpcContext,
  type RoleBindingTrpcProcedures,
} from "./transport/api-trpc/role-binding.api.ts";
export {
  RoleTrpcApi,
  roleTrpcInputSchemas,
  type RoleTrpcAccess,
  type RoleTrpcContext,
  type RoleTrpcPorts,
  type RoleTrpcProcedures,
} from "./transport/api-trpc/role.api.ts";
export {
  PostgresRoleAdapter,
  type PostgresRoleAdapterOptions,
} from "./adapters/postgres.role.adapter.ts";
export { RolePermissionPort, RoleScopePort } from "./ports/role.port.ts";
export { RoleService, type RoleServiceDependencies } from "./services/role.service.ts";

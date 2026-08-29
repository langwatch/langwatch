export { RoleApp, type RoleAppDependencies, type RoleCaller } from "./app/role.app";
export { createRolesRestApp } from "./api/app-rest/role.api";
export {
  RoleBindingTrpcApi,
  roleBindingTrpcInputSchemas,
  type RoleBindingTrpcContext,
  type RoleBindingTrpcProcedures,
} from "./api/app-trpc/role-binding.api";
export {
  RoleTrpcApi,
  roleTrpcInputSchemas,
  type DeclaredProcedure,
  type RoleTrpcContext,
  type RoleTrpcProcedures,
} from "./api/app-trpc/role.api";
export {
  PostgresRoleAdapter,
  type PostgresRoleAdapterOptions,
} from "./adapters/postgres.role.adapter";
export { RolePermissionPort, RoleScopePort } from "./ports/role.port";
export { RoleService, type RoleServiceDependencies } from "./services/role.service";

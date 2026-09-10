export type { RoleInfrastructure } from "./app/role.app.ts";
export { roleRepositories } from "./repositories/role-repositories.registry.ts";
export { roleServer } from "./role.server.ts";
export { roleBindingTrpcTransport } from "./transport/role-binding.trpc.ts";
export { roleRest, roleRestFacts } from "./transport/role.rest.ts";
export { roleTrpcTransport } from "./transport/role.trpc.ts";

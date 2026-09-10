import { defineModule } from "@langwatch/runtime-composition";
import { AuthzApp } from "./app/authz.app.ts";
import { authzRepositories } from "./repositories/authz-repositories.registry.ts";
import { authzRoleBindingRest } from "./transport/authz-role-binding.rest.ts";
import { authzTrpcTransport } from "./transport/authz.trpc.ts";

export type { AuthzInfrastructure, AuthzSetup } from "./app/authz.app.ts";
export const authzServer = defineModule("authz")
  .withRepositories(authzRepositories)
  .withApp(AuthzApp)
  .withTransports(authzRoleBindingRest, authzTrpcTransport)
  .build();

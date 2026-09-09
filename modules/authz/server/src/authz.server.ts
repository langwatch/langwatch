import { defineFeature } from "@langwatch/runtime-composition";
import { AuthzApp } from "./app/authz.app.ts";
import { authzRoleBindingRest } from "./transport/authz-role-binding.rest.ts";
import { authzTrpcTransport } from "./transport/authz.trpc.ts";

export type { AuthzInfrastructure, AuthzSetup } from "./app/authz.app.ts";
export const authzServer = defineFeature("authz")
  .withApp(AuthzApp)
  .withTransports(authzRoleBindingRest, authzTrpcTransport)
  .build();

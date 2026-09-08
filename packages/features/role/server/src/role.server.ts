import { defineFeature } from "@langwatch/runtime-composition";
import { RoleApp } from "./app/role.app.ts";
import { roleRepositories } from "./repositories/role-repositories.registry.ts";
import { roleBindingTrpcTransport } from "./transport/role-binding.trpc.ts";
import { roleRest } from "./transport/role.rest.ts";
import { roleTrpcTransport } from "./transport/role.trpc.ts";

export const roleServer = defineFeature("role")
  .withRepositories(roleRepositories)
  .withApp(RoleApp)
  .withTransports(roleRest, roleTrpcTransport, roleBindingTrpcTransport)
  .build();

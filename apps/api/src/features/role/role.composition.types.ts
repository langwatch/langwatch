/** Kept separate so importing the router/app type never pulls in the installer. */
import type { RoleApi } from "@langwatch/role-contract";
import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createRoleBindingTrpcRouter, createRoleTrpcRouter } from "./role-trpc.mount.ts";

/** The two namespaces and the `ctx.app.roles` slice they both answer from. */
export type ComposedRoleFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    role: ReturnType<typeof createRoleTrpcRouter<ApiTrpcContext>>;
    roleBinding: ReturnType<typeof createRoleBindingTrpcRouter<ApiTrpcContext>>;
  };
  /**
   * For `ctx.app.roles`, and for every process collaborator that validates a
   * custom role — the organization invitations read assignability through it.
   */
  app: RoleApi;
}>;

/** Kept separate from the composition so importing the router/app type never pulls in adapters. */
import type { AuthzApp } from "@langwatch/authz-server";
import type { RoleService } from "@langwatch/role-contract";
import type { RoleApp } from "@langwatch/role-server";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createTeamTrpcRouter } from "../organization/organization-trpc.mount.ts";
import type { createRoleTrpcRouter } from "./role-trpc.mount.ts";

/** The two namespaces, the `ctx.app` slices, and the service the invites read. */
export type ComposedRoleFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    role: ReturnType<typeof createRoleTrpcRouter>;
    team: ReturnType<typeof createTeamTrpcRouter>;
  };
  /** For `ctx.app.roles` — the same application both role surfaces read. */
  app: RoleApp;
  /** For `ctx.app.authzApp`. */
  authzApp: AuthzApp;
  /**
   * The role service under {@link ComposedRoleFeature.app}.
   */
  roles: RoleService;
}>;

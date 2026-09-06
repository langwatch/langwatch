/**
 * ComposedRoleFeature, apart from the composition that builds it.
 *
 * The record type names this feature's application and its router; the
 * composition beside it opens repositories, adapters and byte stores. Every
 * program that only names `AppRouter` reaches this record, so the two live in
 * separate modules and the type's module imports no adapter.
 */
import type { AuthzApp } from "@langwatch/authz-server";
import type { RoleService } from "@langwatch/role-contract";
import type { RoleApp } from "@langwatch/role-server";
import type { ApiTrpcFeatureMount } from "../../api.application";
import type { createTeamTrpcRouter } from "../organization/organization-trpc.mount";
import type { createRoleTrpcRouter } from "./role-trpc.mount";

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

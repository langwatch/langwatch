/** Binds the feature's declared procedures to this process's execution path. */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { RoleApi } from "@langwatch/role-contract";
import { roleBindingTrpcTransport, roleTrpcTransport } from "@langwatch/role-server";

/**
 * The one slice of the process context both namespaces read. `role.*` and
 * `roleBinding.*` are two wire names for one application, because who holds a
 * role and what that role grants are the same question asked from two ends.
 */
export interface RoleHostContext {
  app: Readonly<{ roles: RoleApi }>;
}

export function createRoleTrpcRouter<TContext extends RoleHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(roleTrpcTransport, (ctx) => ctx.app.roles);
}

export function createRoleBindingTrpcRouter<TContext extends RoleHostContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(roleBindingTrpcTransport, (ctx) => ctx.app.roles);
}

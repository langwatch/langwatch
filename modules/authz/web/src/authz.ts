/**
 * RBAC settings family: two screens (/settings/roles, /settings/role-bindings)
 * with LOADER exports. Owning feature mounts Provider + port (ADR-004).
 */

import type { ComponentType } from "react";

export type AuthzScreenLoader = () => Promise<{ default: ComponentType }>;

export const authzScreens = {
  roles: () => import("./ui/sections/roles.screen.tsx"),
  roleBindings: () => import("./ui/sections/role-bindings.screen.tsx"),
} as const satisfies Record<string, AuthzScreenLoader>;

export type AuthzScreenName = keyof typeof authzScreens;

export { authzApi } from "./behavior/authz-api.ts";
export {
  AUTHZ_MANAGE_PERMISSION,
  AuthzHostPort,
  AuthzHostProvider,
  type AuthzFailureNotice,
  type AuthzHostScope,
  type AuthzPlanReading,
  type AuthzSuccessNotice,
} from "./model/authz-host.ts";

/**
 * The RBAC settings family, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry. What it exposes for each
 * page is a LOADER rather than a component, because the roles editor drags a
 * two-hundred-row permission matrix and a react-hook-form behind it, and none
 * of that belongs in the chunk that renders the rest of the application.
 *
 * TWO SCREENS, TWO ADDRESSES: `/settings/roles` and `/settings/role-bindings`.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is two things: the tRPC
 * Provider these hooks run on, and the host port that answers for the
 * organization, the reader's grants, the plan tier and the two notices. It also
 * applies the page guard — {@link AUTHZ_MANAGE_PERMISSION} — and the settings
 * chrome, in that order, because neither is a screen's to own.
 *
 * FOUR NAMES AND NO MORE. A public screen entry may not re-export the screen's
 * internals: the consumer compiles what the entry names, under its own
 * tsconfig. Loaders, the api, the port and the port's types.
 */

import type { ComponentType } from "react";

export type AuthzScreenLoader = () => Promise<{ default: ComponentType }>;

export const authzScreens = {
  roles: () => import("./roles.screen"),
  roleBindings: () => import("./role-bindings.screen"),
} as const satisfies Record<string, AuthzScreenLoader>;

export type AuthzScreenName = keyof typeof authzScreens;

export { authzApi } from "../../behavior/authz-api";
export {
  AUTHZ_MANAGE_PERMISSION,
  AuthzHostPort,
  AuthzHostProvider,
  type AuthzFailureNotice,
  type AuthzHostScope,
  type AuthzPlanReading,
  type AuthzSuccessNotice,
} from "../../model/authz-host";

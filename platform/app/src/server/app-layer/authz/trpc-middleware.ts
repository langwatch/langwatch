/**
 * ADR-092 §5, delivery-plan decision 25 — the app's four declared authz
 * middlewares, composed.
 *
 * The middlewares themselves are `@langwatch/trpc`'s: the scope resolution,
 * the blank-versus-missing split, the denial shape and the `AUTHZ_DECLARATION`
 * descriptor the router sweep reads are framework policy that no process gets
 * to vary. What is decided here is the three things portable code cannot
 * decide — who the caller is, which composed `AuthzService` answers for this
 * request, and which concrete handled errors the two role-shaped refusals
 * carry, since their codes and copy are what a client modal keys on.
 *
 * The service the authorization port resolves is the App-composed
 * `PermissionsService`, which owns the fork between the legacy walk and the
 * engine: a not-yet-migrated organization is decided by the walk and a
 * migrated one by the engine, chosen by the organization's migration status
 * alone. There is no shadow comparison at request time.
 */
import { createDeclaredAuthzMiddlewares } from "@langwatch/trpc";
import type { OrganizationUserRole } from "~/generated/prisma/client";
import type { Session } from "../../auth";
import type { App } from "../app";
import { LiteMemberRestrictedError, MembershipDisabledError } from "../permissions/errors";

/**
 * The request context these checks read and write. Named here rather than
 * imported from the tRPC context module so the authz layer keeps depending on
 * the App and the session alone.
 */
export type DeclaredAuthzRequestContext = {
  session: Session | null;
  /** The composed App the tRPC context factory injected. */
  app: App;
  permissionChecked: boolean;
  organizationRole?: OrganizationUserRole | null;
};

const declaredAuthz = createDeclaredAuthzMiddlewares<DeclaredAuthzRequestContext>({
  identity: {
    actor: (ctx) => {
      const user = ctx.session?.user;
      return user ? { id: user.id } : undefined;
    },
  },
  authorization: { forRequest: (ctx) => ctx.app.permissions },
  denials: {
    membershipDisabled: () => new MembershipDisabledError(),
    liteMemberRestricted: (resource) => new LiteMemberRestrictedError(resource),
  },
});

/** `.permission(p)` / `.permission(p, { via })`. */
export const checkDeclaredPermission = declaredAuthz.permission;

/** `.permissionAny(…)` — any one of the permissions is enough. */
export const checkDeclaredPermissionAny = declaredAuthz.permissionAny;

/** `.noPermission({ reason, allow })` — authenticated, deliberately unchecked. */
export const declaredNoPermission = declaredAuthz.noPermission;

/** `.authorizeInService({ reason, permissions })` — the service checks. */
export const declaredServiceAuthorization = declaredAuthz.serviceAuthorized;

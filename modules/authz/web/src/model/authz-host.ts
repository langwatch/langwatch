/**
 * What the Roles and Role Bindings screens ask of the application they are
 * mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package, and reaching for any of them is also what would make these screens
 * untestable outside a running application. They ask this port instead, and the
 * frontend feature that owns it — `apps/ui/src/features/authz` — answers it by
 * adapting the browser capabilities the application resolves.
 *
 * THE NINTH FAMILY TO DECLARE THIS SHAPE, after governance, gateway, the
 * personal workspace, automations, ops, agents, data governance, datasets and
 * the model providers. Every one of those recorded that a repeat is the signal
 * to promote it into one place, and every one left it, for the same reason:
 * promotion changes packages a page-family move does not own. Recorded again in
 * `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * WHAT THIS FAMILY ASKS THAT THE OTHERS DID NOT is {@link AuthzHostPort.plan}.
 * Both pages are Enterprise surfaces: without the plan they render a sales
 * block instead of the feature, and while the plan is still arriving they
 * render neither, because flashing "Contact sales" at an Enterprise customer is
 * worse than a spinner. A plan is a BILLING FACT and not a grant, so it cannot
 * come off the session capability — the same reason `isPlatformAdmin` sits on
 * the data-governance host rather than in its procedure map.
 *
 * WHAT IT DELIBERATELY DOES NOT ASK is a route reading. Neither page has ever
 * put anything in the URL: the bindings filter is four buttons over a list
 * already in memory, and every roles overlay is a dialog the page opens on
 * itself. There is no address to preserve, so inventing one would be a
 * behaviour change rather than a move.
 */

import { createContext, useContext } from "react";

/**
 * The grant both RBAC pages are behind.
 *
 * The route refuses a reader without it — `platform/app` said the same thing as
 * `withPermissionGuard("organization:manage")` on both pages, and
 * `pages/settings/__tests__/admin-page-guards.unit.test.ts` pinned it there
 * because a downgrade to `organization:view` once leaked full organization data
 * to every MEMBER. The write controls ask again, so the same components would
 * behave correctly under a read-only route if one is ever added.
 */
export const AUTHZ_MANAGE_PERMISSION = "organization:manage";

/** The organization these two pages are about. */
export type AuthzHostScope = {
  organizationId: string | undefined;
};

/**
 * The plan tier, and whether it has answered yet.
 *
 * `isLoading` is separate from `isEnterprise` because the three states are
 * genuinely three: still asking, Enterprise, and not Enterprise. Collapsing the
 * first into the third is what would show a paying customer a sales pitch for
 * the length of one round trip.
 */
export type AuthzPlanReading = {
  isEnterprise: boolean;
  isLoading: boolean;
};

/** A short confirmation of something the reader just did. */
export type AuthzSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as a screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: the wire
 * message of a handled error is its code slug, so a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
 */
export type AuthzFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/** The one thing the screens are handed. */
export abstract class AuthzHostPort {
  /** The organization these pages are about. */
  abstract scope(): AuthzHostScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  /** The plan tier that decides whether these pages are the feature or the pitch. */
  abstract plan(): AuthzPlanReading;

  abstract succeeded(notice: AuthzSuccessNotice): void;

  abstract failed(failure: AuthzFailureNotice): void;
}

const AuthzHostContext = createContext<AuthzHostPort | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const AuthzHostProvider = AuthzHostContext.Provider;

/**
 * The host these screens are mounted in.
 *
 * Missing means a screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useAuthzHost(): AuthzHostPort {
  const host = useContext(AuthzHostContext);
  if (!host) {
    throw new Error(
      "No AuthZ host is mounted above this screen; render it inside the authz frontend feature.",
    );
  }
  return host;
}

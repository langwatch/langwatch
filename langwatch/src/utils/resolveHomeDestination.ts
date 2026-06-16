export type LastVisitedHomeKind = "" | "project" | "personal";

export interface HomeDestinationInput {
  /** The destination the server persona resolver picked. */
  resolverDestination: string;
  /** True when the user set an explicit pin via the picker (User.lastHomePath). */
  isOverride: boolean;
  /** True when the governance UI (/me, /governance) is reachable for the org. */
  governanceUiEnabled: boolean;
  /** The implicit "last home visited" marker, written on each visit. */
  lastVisitedHomeKind: LastVisitedHomeKind;
  /** Slug of the user's current (last-visited) project, or null if none. */
  lastProjectSlug: string | null;
  /**
   * Slug of the org the persona resolver ran against. Carried as `?org=<slug>`
   * onto org-scoped governance homes (/me, /governance) so the destination
   * page re-pins to this org instead of inheriting a drifted project's org.
   * Null when no org is resolved (org-less bootstrap) — no param is appended.
   */
  organizationSlug?: string | null;
}

/**
 * Final `/` destination, honoring the user's last-visited home so it sticks
 * symmetrically both ways: /me and the last project they opened.
 *
 * The server persona resolver picks the DEFAULT for a user with no history
 * (e.g. /me for a personal-VK persona). Once the user has actually visited a
 * home, that visit sticks until they visit the other kind. Without this, a
 * personal-VK persona's default (/me) wins every time and a project the user
 * deliberately switched to never sticks on the next visit to `/`.
 *
 * Precedence:
 *  - An explicit picker pin (isOverride) is the deliberate choice and always wins.
 *  - Otherwise the last-visited kind decides: "personal" -> /me (only where the
 *    governance UI is reachable, since /me 404s without it), "project" -> the
 *    last-visited project's home.
 *  - With no visit history, the persona resolver's destination stands.
 */
export function resolveHomeDestination(input: HomeDestinationInput): string {
  return withOrganizationParam(
    resolveBaseDestination(input),
    input.organizationSlug ?? null,
  );
}

function resolveBaseDestination({
  resolverDestination,
  isOverride,
  governanceUiEnabled,
  lastVisitedHomeKind,
  lastProjectSlug,
}: HomeDestinationInput): string {
  if (isOverride) return resolverDestination;

  if (
    governanceUiEnabled &&
    lastVisitedHomeKind === "personal" &&
    resolverDestination !== "/me"
  ) {
    return "/me";
  }

  if (lastVisitedHomeKind === "project" && lastProjectSlug) {
    // The bare project slug is the project HOME (pages/[project]/index renders
    // HomePage); never append /messages, which is a legacy surface.
    return `/${lastProjectSlug}`;
  }

  return resolverDestination;
}

/**
 * `/me` and `/governance` are org-scoped pages that resolve their active org
 * from `selectedOrganizationId` — which, on a fresh login, can still point at a
 * different (non-governance) org than the one the persona resolver used to pick
 * this destination, so the page 404s behind its feature-flag guard. Carrying
 * the resolver's org as `?org=<slug>` lets `useOrgQueryParamSelection` re-pin
 * the page to the right org on landing (and strip the param), matching the
 * workspace switcher's per-org "My Workspace" links. Project homes are
 * project-scoped and need no org hint.
 */
function withOrganizationParam(
  destination: string,
  organizationSlug: string | null,
): string {
  if (!organizationSlug) return destination;
  if (destination === "/me" || destination === "/governance") {
    return `${destination}?org=${encodeURIComponent(organizationSlug)}`;
  }
  return destination;
}

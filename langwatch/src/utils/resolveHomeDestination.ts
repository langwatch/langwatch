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
export function resolveHomeDestination({
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

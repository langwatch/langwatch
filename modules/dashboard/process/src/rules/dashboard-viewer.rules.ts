import type { Actor } from "@langwatch/authorization";
import type { DashboardViewer } from "@langwatch/dashboard-contract";

/**
 * The person a REST call is made for, as the door's actor names them: the owner of a personal
 * API key, or the holder of an access token. A key that names nobody has no viewer, so the
 * scope rules read it as a project credential. Spec: dashboards-v2.feature AC196, AC197.
 */
export function viewerOfActor({ actor }: { actor: Actor | null }): { viewer?: DashboardViewer } {
  return actor?.type === "user" ? { viewer: { userId: actor.id } } : {};
}

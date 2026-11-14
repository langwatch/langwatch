import type { Actor } from "@langwatch/authorization";
import type { DashboardViewer } from "@langwatch/dashboard-contract";

/**
 * Who a REST call authors a board as: the person behind the actor, as for `viewerOfActor`. A key
 * that names nobody authors nothing, so the board is left without a creator.
 */
export function authorOfActor({ actor }: { actor: Actor | null }): { createdById?: string } {
  return actor?.type === "user" ? { createdById: actor.id } : {};
}

/**
 * The person a REST call is made for, as the door's actor names them: the owner of a personal
 * API key, or the holder of an access token. A key that names nobody has no viewer, so the
 * scope rules read it as a project credential. Spec: dashboards-v2.feature AC196, AC197.
 */
export function viewerOfActor({ actor }: { actor: Actor | null }): { viewer?: DashboardViewer } {
  return actor?.type === "user" ? { viewer: { userId: actor.id } } : {};
}

/**
 * The person a delete confirmation reads its record's name for: the key's owner, the same person
 * `viewerOfActor` names for the handler, so the card sees exactly what the delete would remove.
 * A key that names nobody has no viewer. Spec: langy-delete-confirmation.feature.
 */
export function viewerOfOwner({ ownerUserId }: { ownerUserId: string | null }): {
  viewer?: DashboardViewer;
} {
  return ownerUserId ? { viewer: { userId: ownerUserId } } : {};
}

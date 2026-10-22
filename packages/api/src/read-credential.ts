/** Who a read counts against, from what the door resolved
 * (specs/security/read-rate-limits.feature). */
import type { Actor, AuthzDeclaredScopeId } from "@langwatch/authorization";

import type { ReadCredential } from "./read-budget.ts";
import { isKeyDoor, recordedKeyOfDoor } from "./rest/key-credential.ts";

/** An operator acting as somebody counts as the operator; a person in a browser by person. */
export function actorReadCredential(actor: Actor | null): ReadCredential | null {
  if (actor?.type !== "user") return null;
  if (actor.impersonatorId) {
    return {
      id: actor.impersonatorId,
      type: "impersonation",
      impersonatorId: actor.impersonatorId,
      subjectUserId: actor.id,
    };
  }
  return { id: actor.id, type: "session" };
}

/** A key door counts by the key; a browser by the session's person; other doors not at all. */
export function restReadCredential({
  door,
  actor,
  scope,
  request,
}: {
  door: string;
  actor: Actor | null;
  scope: AuthzDeclaredScopeId | null;
  request: Request;
}): ReadCredential | null {
  if (door === "browser") return actorReadCredential(actor);
  if (!isKeyDoor(door)) return null;

  const key = recordedKeyOfDoor({ door, request });
  if (!key) return null;
  if (key.kind === "access_token") {
    return key.ownerUserId ? { id: key.ownerUserId, type: "access_token" } : null;
  }
  if (key.kind === "legacy_project_key") {
    return scope ? { id: scope.id, type: "legacy_project_key" } : null;
  }
  return key.apiKeyId ? { id: key.apiKeyId, type: key.kind } : null;
}

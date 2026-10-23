/** Who a read counts against, from what the door resolved
 * (specs/security/read-rate-limits.feature). */
import type { Actor } from "@langwatch/authorization";

import type { ReadCredential } from "./read-budget.ts";
import { recordedKeyCredentialOf } from "./rest/credential.ts";
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

/**
 * A key door counts by the key; a browser by the session's person; a CLI token by its
 * person, as an access token; other doors not at all.
 */
export function restReadCredential({
  door,
  actor,
  request,
}: {
  door: string;
  actor: Actor | null;
  request: Request;
}): ReadCredential | null {
  if (door === "browser") return actorReadCredential(actor);
  if (door === "cli_token") {
    return actor?.type === "user" ? { id: actor.id, type: "access_token" } : null;
  }
  if (!isKeyDoor(door)) return null;

  const key = recordedKeyOfDoor({ door, request });
  if (!key) return null;
  if (key.kind === "access_token") {
    return key.ownerUserId ? { id: key.ownerUserId, type: "access_token" } : null;
  }
  if (key.kind === "legacy_project_key") {
    const projectId = legacyKeyProjectOf({ door, request });
    return projectId ? { id: projectId, type: "legacy_project_key" } : null;
  }
  return key.apiKeyId ? { id: key.apiKeyId, type: key.kind } : null;
}

/**
 * The project a legacy key is, from what its door recorded. Never the request's scope: the
 * api_key door scopes a legacy key to its organization, and every project would share one budget.
 */
function legacyKeyProjectOf({
  door,
  request,
}: {
  door: "project" | "organization" | "api_key";
  request: Request;
}): string | null {
  const recorded = recordedKeyCredentialOf({ door, request });
  if (!recorded) return null;
  if ("type" in recorded) return recorded.type === "legacyProjectKey" ? recorded.project.id : null;

  return recorded.kind === "project" ? recorded.projectId : null;
}

import type { Actor } from "@langwatch/authorization";
import type { DatasetVersionAuthor } from "@langwatch/dataset-contract";

/**
 * Who a change is recorded as: the door's user, else the API key the request
 * presented (a project key has no owning user), else the platform itself.
 */
export function datasetAuthorOf(input: {
  actor: Actor | null;
  key?: { apiKeyId: string | null } | undefined;
}): DatasetVersionAuthor {
  const { actor, key } = input;
  if (actor?.type === "user") return { kind: "user", id: actor.id };
  if (actor?.type === "api_key") return { kind: "api_key", id: actor.id };
  if (!actor && key?.apiKeyId) return { kind: "api_key", id: key.apiKeyId };
  return { kind: "system", id: null };
}

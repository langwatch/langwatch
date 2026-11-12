import type { Actor } from "@langwatch/authorization";
import type { EvaluatorCaller } from "@langwatch/evaluator-contract";

/**
 * The caller a version and the deploy check name: the door's user, else the key the request
 * presented (a project key has no owning user), else an unattributed credential. Only a named
 * system actor skips the deploy check; an internal proof actor or anything newer fails closed.
 */
export function evaluatorCallerOf(input: {
  actor: Actor | null;
  key?: { apiKeyId: string | null } | undefined;
}): EvaluatorCaller {
  const { actor, key } = input;
  if (actor?.type === "user") return { type: "user", id: actor.id };
  if (actor?.type === "api_key") return { type: "api_key", id: actor.id };
  if (actor?.type === "system") return { type: "system" };
  return key?.apiKeyId ? { type: "api_key", id: key.apiKeyId } : { type: "unattributed" };
}

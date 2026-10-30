import type { LangWatchQLKeyReach } from "@langwatch/analytics-contract";
import { keyPrincipalOfApiKey } from "@langwatch/api/rest";
import type { RestResolvedProjectCredential } from "@langwatch/authorization";

/**
 * The reach a widget write must respect, as a run of the same key would: an API key, mapped by
 * the one function the key door uses. Other credentials have none, since a project key names its
 * own project and a person's token acts as the person.
 */
export function keyReachOfCredential({
  credential,
}: {
  credential: RestResolvedProjectCredential;
}): { keyReach?: LangWatchQLKeyReach } {
  const keyReach = keyPrincipalOfApiKey(credential);

  return keyReach ? { keyReach } : {};
}

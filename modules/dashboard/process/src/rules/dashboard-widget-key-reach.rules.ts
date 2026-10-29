import type { LangWatchQLKeyReach } from "@langwatch/analytics-contract";
import type { RestResolvedProjectCredential } from "@langwatch/authorization";

/**
 * The reach a widget write must respect, as a run of the same key would: an API key reads the
 * projects it holds `analytics:view` on. Other credentials have none here, since a project key
 * names its own project and a person's token acts as the person.
 */
export function keyReachOfCredential({
  credential,
}: {
  credential: RestResolvedProjectCredential;
}): { keyReach?: LangWatchQLKeyReach } {
  if (credential.type !== "apiKey") return {};

  const keyReach: LangWatchQLKeyReach = {
    kind: "apiKey",
    apiKeyId: credential.apiKeyId,
    userId: credential.userId,
    organizationId: credential.organizationId,
    resolvedProject: { id: credential.project.id, teamId: credential.project.teamId },
  };

  return { keyReach };
}

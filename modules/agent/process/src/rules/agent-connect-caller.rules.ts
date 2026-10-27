import type { AgentConnectCaller } from "@langwatch/agent-contract";
import type { RestResolvedProjectCredential } from "@langwatch/authorization";

/** The keys that may connect a process: the door refuses an ingestion or Langy session key. */
export const CONNECT_KEY_KINDS = ["api_key", "legacy_project_key"] as const;

/** The scope a process needs to connect. */
export const CONNECT_PERMISSION = "scenarios:manage";

/**
 * The flag that opens the connect routes, the connect socket and the model providers read to a
 * legacy project key.
 */
export const CONNECT_LEGACY_KEY_SCOPE = "legacy_project_key_connected_agents";

/**
 * The caller the project door resolved, in the principal form a live session stores
 * (`user:<id>`, `key:<id>`, `legacy-project:<id>`), so sessions survive a rolling deploy.
 */
export function connectCallerOf(credential: RestResolvedProjectCredential): AgentConnectCaller {
  const project = { id: credential.project.id, slug: credential.project.slug };

  switch (credential.type) {
    case "legacyProjectKey":
      return { project, userId: null, principalId: `legacy-project:${project.id}` };
    case "cliAccessToken":
      return { project, userId: credential.userId, principalId: `user:${credential.userId}` };
    case "apiKey":
      return {
        project,
        userId: credential.userId,
        principalId:
          credential.userId === null ? `key:${credential.apiKeyId}` : `user:${credential.userId}`,
      };
  }
}

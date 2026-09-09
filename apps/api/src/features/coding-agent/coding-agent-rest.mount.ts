/**
 * Binds the three coding-agent REST declarations to this process's doors: the
 * session events and the project rollup behind a project key, and the
 * organization rollup behind an organization key.
 */
import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  type MountableRestApp,
} from "@langwatch/api/rest";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import {
  codingAgentRest,
  codingAgentRestCaller,
  codingAgentRollupRest,
  codingAgentV1Rest,
  codingAgentV1RestCaller,
} from "@langwatch/coding-agent-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/coding-agent/sessions/:sessionId/events` behind a project key. */
export function mountCodingAgentRest(
  runtime: ApiRestRuntime,
  codingAgents: () => CodingAgentApi,
): MountableRestApp {
  return runtime.mount(codingAgentRest.router(), codingAgents);
}

/**
 * Mounts `/api/coding-agent/pull-request-usage` behind a project key. The
 * workspace travels with the caller because the personal-workspace guard is
 * applied to it, and the credential because it reads with its own bindings.
 */
export function mountCodingAgentRollupRest(
  runtime: ApiRestRuntime,
  codingAgents: () => CodingAgentApi,
): MountableRestApp {
  return runtime.mount(codingAgentRollupRest.router(), codingAgents, {
    facts: [
      bindRestMiddleware(codingAgentRestCaller, (context) => {
        const resolved = runtime.projectCredentialOf(context.req.raw);

        return {
          project: {
            isPersonal: resolved.project.isPersonal,
            ownerUserId: resolved.project.ownerUserId,
          },
          credential: credentialPrincipalOfToken(resolved),
        };
      }),
    ],
  });
}

/**
 * Mounts `/api/v1/coding-agent/pull-request-usage` behind an organization key.
 * It answers any authenticated caller: the projects the rollup covers are the
 * cut the caller may read, resolved inside the application.
 */
export function mountCodingAgentV1Rest(
  runtime: ApiRestRuntime,
  codingAgents: () => CodingAgentApi,
): MountableRestApp {
  return runtime.mount(codingAgentV1Rest.router(), codingAgents, {
    facts: [
      bindRestMiddleware(codingAgentV1RestCaller, (context) => {
        const credential = runtime.organizationCredentialOf(context.req.raw);

        return {
          apiKeyId: credential.apiKeyId,
          userId: credential.userId,
          // The member the credential acts as, or the credential itself where
          // it acts as nobody - one stable string per credential either way.
          actorId: credential.userId ?? `apikey:${credential.apiKeyId}`,
        };
      }),
    ],
  });
}

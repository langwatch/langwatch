/**
 * Binds the GitHub installation flow to this process's own graph: the session,
 * the organization-management answer, the audit trail and the post-install
 * backfill. Without a coding-agent application, linkage arrives at the recheck.
 */
import type { MountableRestApp } from "@langwatch/api/rest";
import type { AuthzService } from "@langwatch/authz-contract";
import type { CodingAgentApp } from "@langwatch/coding-agent-server";
import type { GithubApi } from "@langwatch/github-contract";
import { githubInstallRest, type GithubInstallApi } from "@langwatch/github-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";
import type { ApiAuditPort } from "../../api-request.policy.ts";

export type ApiGithubRestOptions = Readonly<{
  /** The SAME service the `github.*` tRPC namespace reads. */
  github: GithubApi | undefined;
  /**
   * `undefined` without a Better Auth transport, which makes the whole family
   * absent: `/install` and `/setup` need a session, and `/webhook` alone
   * (GitHub only delivers to it after `/setup`) is not a family.
   */
  session: ((request: Request) => Promise<{ id: string } | null>) | undefined;
  /** The AuthZ graph the organization-tier check runs on. */
  authz: AuthzService | undefined;
  /** Where a connection command — and a blocked rebind — is recorded. */
  audit: ApiAuditPort | undefined;
  /**
   * The install follow-up, where this process composed a coding-agent
   * application to run it. Narrowed to the one operation the flow calls: the
   * family relinks pull requests and reads nothing else about an agent.
   */
  codingAgents?: Pick<CodingAgentApp, "backfillPullRequestMappings"> | undefined;
}>;

/** Mounts `/api/github/*` and its two `github-langy` aliases. */
export function mountGithubInstallRest(
  runtime: ApiRestRuntime,
  app: GithubInstallApi,
): MountableRestApp {
  return runtime.mount(githubInstallRest.router(), () => app);
}

/**
 * `undefined` without the service, session port or AuthZ: a `/setup` that
 * can't resolve a session can't re-bind the flow to its caller, which is the
 * cross-tenant rebind the flow's guard chain exists to prevent.
 */
export function composeApiGithubRest(options: ApiGithubRestOptions): GithubInstallApi | undefined {
  const { github, session, authz, audit, codingAgents } = options;
  if (!github || !session || !authz) return undefined;

  return {
    github: () => github,
    resolveSession: async ({ request }) => {
      const actor = await session(request);

      return actor ? { user: { id: actor.id } } : null;
    },
    canManageOrganization: ({ userId, organizationId }) =>
      authz.hasPermission({ userId, permission: "organization:manage", organizationId }),
    // A deployment with no audit sink still connects GitHub; the two writes
    // this family makes are already logged, and refusing the install over a
    // missing trail would be the wrong trade.
    recordAudit: async (entry) => {
      await audit?.record({
        // The ACTION, not the URL: it is the stable identifier of what was
        // done, and the same one the packaged families' audit port writes.
        actorId: entry.userId,
        path: entry.action,
        input: { ...entry.args, organizationId: entry.organizationId },
        error: null,
      });
    },
    // Fire-and-forget at the family: `/setup` starts it and redirects, and a
    // failure is logged there rather than shown to the person connecting. A
    // deployment holding no coding agents resolves at the branch recheck.
    backfillPullRequestMappings: async ({ organizationId }) => {
      await codingAgents?.backfillPullRequestMappings({ organizationId });
    },
  };
}

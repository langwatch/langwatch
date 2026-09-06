/**
 * Post-install PR backfill reuses `codingAgents.*`; without it composed,
 * linkage arrives later via the periodic branch recheck instead.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { CodingAgentApp } from "@langwatch/coding-agent-server";
import type { GithubService } from "@langwatch/github-contract";
import type { GithubRestPorts, GithubRestSessionPort } from "@langwatch/github-server";

import type { ApiAuditPort } from "../../api-request.policy";

export type ApiGithubRestOptions = Readonly<{
  /** The SAME service the `github.*` tRPC namespace reads. */
  github: GithubService | undefined;
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
   * The coding-agent application this process composed, or none. The install
   * follow-up is its `backfillPullRequestMappings`.
   */
  codingAgents?: CodingAgentApp | undefined;
}>;

/**
 * `undefined` without the service, session port or AuthZ: a `/setup` that
 * can't resolve a session can't re-bind the flow to its caller, which is the
 * cross-tenant rebind the flow's guard chain exists to prevent.
 */
export function composeApiGithubRest(options: ApiGithubRestOptions): GithubRestPorts | undefined {
  const { github, session, authz } = options;
  if (!github || !session || !authz) return undefined;

  const resolveSession: GithubRestSessionPort = async (request) => {
    const actor = await session(request);
    return actor ? { user: { id: actor.id } } : null;
  };

  const audit = options.audit;
  const codingAgents = options.codingAgents;
  return {
    github: () => github,
    // Fire-and-forget at the family: `/setup` starts it and redirects, and a
    // failure is logged there rather than shown to the person connecting.
    ...(codingAgents
      ? {
          backfillPullRequestMappings: ({ organizationId }: { organizationId: string }) =>
            codingAgents.backfillPullRequestMappings({ organizationId }),
        }
      : {}),
    session: resolveSession,
    canManageOrganization: ({ userId, organizationId }) =>
      authz.hasPermission({
        userId,
        permission: "organization:manage",
        organizationId,
      }),
    // A deployment with no audit sink still connects GitHub; the two writes
    // this family makes are already logged, and refusing the install over a
    // missing trail would be the wrong trade.
    audit: async (entry) => {
      await audit?.record({
        actorId: entry.userId,
        // The ACTION, not the URL: it is the stable identifier of what was
        // done, and the same one the packaged families' audit port writes.
        path: entry.action,
        input: { ...entry.args, organizationId: entry.organizationId },
        error: null,
      });
    },
  };
}

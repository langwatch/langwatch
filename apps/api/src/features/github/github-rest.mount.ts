/**
 * The API process's GitHub App installation door.
 *
 * Behaviour is package-owned (`@langwatch/github-server`); this supplies the
 * three answers the flow reaches that GitHub does not own — who is signed in,
 * whether that person may manage the organization they are connecting for, and
 * where the connection command is recorded.
 *
 * ONE NAMED ABSENCE. The pull-request backfill that runs after a successful
 * install is not supplied: it lives on the coding-agent SERVICE and this
 * process composes only the application above it. Its effect is a cache of
 * what GitHub already knows, and the periodic branch recheck rebuilds the same
 * mapping — so the linkage arrives later rather than not at all, which is why
 * the port is optional rather than a stand-in that throws.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { GithubService } from "@langwatch/github-contract";
import type { GithubRestPorts, GithubRestSessionPort } from "@langwatch/github-server";

import type { ApiAuditPort } from "../../api-request.policy";

export type ApiGithubRestOptions = Readonly<{
  /** The SAME service the `github.*` tRPC namespace reads. */
  github: GithubService | undefined;
  /**
   * How this process turns a request into a signed-in person.
   *
   * `undefined` where the deployment supplied no Better Auth transport, which
   * is what makes the whole family absent: `/install` and `/setup` are both
   * bound to a session, and `/webhook` alone is not a family — GitHub delivers
   * to it only for an installation `/setup` recorded.
   */
  session: ((request: Request) => Promise<{ id: string } | null>) | undefined;
  /** The AuthZ graph the organization-tier check runs on. */
  authz: AuthzService | undefined;
  /** Where a connection command — and a blocked rebind — is recorded. */
  audit: ApiAuditPort | undefined;
}>;

/**
 * Composes the GitHub REST ports, or none.
 *
 * `undefined` without the service, the session port or AuthZ. Absent beats
 * mounted at each of them: a `/setup` that cannot resolve a session cannot
 * re-bind the flow to the user who started it, and recording an installation
 * for a caller it cannot identify is the cross-tenant rebind the flow's whole
 * guard chain exists to prevent.
 */
export function composeApiGithubRest(options: ApiGithubRestOptions): GithubRestPorts | undefined {
  const { github, session, authz } = options;
  if (!github || !session || !authz) return undefined;

  const resolveSession: GithubRestSessionPort = async (request) => {
    const actor = await session(request);
    return actor ? { user: { id: actor.id } } : null;
  };

  const audit = options.audit;
  return {
    github: () => github,
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

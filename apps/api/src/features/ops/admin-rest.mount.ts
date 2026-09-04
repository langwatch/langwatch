/**
 * The back office's collaborators, composed from this process's own graph.
 *
 * `/api/admin/impersonate` and `/api/admin/:resource` are answered to instance
 * STAFF, which is not an RBAC grain: the family asks the Ops application
 * whether the acting person is on the staff list, and hides itself from
 * everybody else. So the two things it cannot do for itself are reading who is
 * acting and reading the raw auth session an impersonation is started against.
 *
 * Those are two questions, not one. The actor is read as the IMPERSONATOR
 * where there is one, so an admin who is currently impersonating somebody
 * stays the person a back-office write is attributed to; the auth session is
 * the row whose id impersonation is started and stopped against, and a request
 * whose cookie has since expired has an actor and no session to attach to.
 *
 * Absent where this process composed no browser-session transport or no Ops
 * application: the family is left off rather than mounted, because its own
 * refusal for a non-staff caller is a 404-shaped hide, and an operator could
 * not tell that apart from a deployment that never wired the door.
 */
import type { AuthService } from "@langwatch/auth-contract";
import type { AdminRestPorts, OpsApp } from "@langwatch/ops-server";

import type { ApiBrowserSessionTransportPort } from "../../app/api-auth.composition";

export type ApiAdminRestOptions = Readonly<{
  /** The operator application, where this process composed one. */
  ops: OpsApp | undefined;
  /**
   * The browser-session pair the whole process authenticates people through,
   * where it composed one. The SAME pair every other session door reads, so
   * two doors cannot decide differently about who somebody is.
   */
  session: Readonly<{ auth: AuthService; sessions: ApiBrowserSessionTransportPort }> | undefined;
}>;

/** The back office's ports, or none where either half is missing. */
export function composeApiAdminRest(options: ApiAdminRestOptions): AdminRestPorts | undefined {
  const { ops, session } = options;
  if (!ops || !session) return undefined;

  return {
    ops: () => ops,
    sessions: {
      resolveActor: async (request) => {
        const verified = await session.sessions.tryResolveVerifiedSession(request);
        if (!verified) return null;
        const resolved = await session.auth.tryResolveBrowserSession({ verified });
        if (!resolved) return null;
        return {
          user: {
            id: resolved.user.id,
            email: resolved.user.email,
            ...(resolved.user.impersonator ? { impersonator: resolved.user.impersonator } : {}),
          },
        };
      },
      resolveAuthSession: async (request) => {
        const verified = await session.sessions.tryResolveVerifiedSession(request);
        return verified ? { id: verified.session.id } : null;
      },
    },
  };
}

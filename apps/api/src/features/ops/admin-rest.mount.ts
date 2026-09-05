/**
 * The back office's collaborators, composed from this process's own graph.
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

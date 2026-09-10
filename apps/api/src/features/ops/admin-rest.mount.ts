/**
 * `/api/admin` — the back office, over `runtime.mount`. Both halves are the
 * process's own: the operator application the `ops.*` namespace already
 * answers from, and the ONE browser-session pair every other handler-managed
 * door reads, so two doors can never decide differently about who somebody is.
 */
import type { BrowserSessionApi } from "@langwatch/auth-contract";
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";
import { adminActor, adminAuthSession, adminRest, type AdminRestPorts } from "@langwatch/ops-server";
import type { OpsApp } from "@langwatch/ops-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";
import type { ApiBrowserSessionTransport } from "../../app/api-auth.composition.ts";

export type ApiAdminRestOptions = Readonly<{
  /** The operator application, where this process composed one. */
  ops: OpsApp | undefined;
  /**
   * The browser-session pair the whole process authenticates people through,
   * where it composed one. The SAME pair every other session door reads, so
   * two doors cannot decide differently about who somebody is.
   */
  session: Readonly<{ auth: BrowserSessionApi; sessions: ApiBrowserSessionTransport }> | undefined;
}>;

/** The back office's ports, or none where either half is missing. */
export function composeApiAdminRest(options: ApiAdminRestOptions): AdminRestPorts | undefined {
  const { ops, session } = options;
  if (!ops || !session) return undefined;

  return {
    ops: () => ops,
    resolveActor: async (request) => {
      const verified = await session.sessions.tryResolveVerifiedSession(request);
      if (!verified) return null;
      const resolved = await session.auth.tryResolveBrowserSession({ verified });
      if (!resolved) return null;

      return {
        id: resolved.user.id,
        email: resolved.user.email,
        ...(resolved.user.impersonator ? { impersonator: resolved.user.impersonator } : {}),
      };
    },
    resolveAuthSession: async (request) => {
      const verified = await session.sessions.tryResolveVerifiedSession(request);

      return verified ? { id: verified.session.id } : null;
    },
  };
}

/** Mounts `/api/admin` behind the back office's own two session facts. */
export function mountAdminRest(runtime: ApiRestRuntime, ports: AdminRestPorts): MountableRestApp {
  return runtime.mount(adminRest.router(), ports.ops, {
    facts: [
      bindRestMiddleware(adminActor, (context) => ports.resolveActor(context.req.raw)),
      bindRestMiddleware(adminAuthSession, (context) => ports.resolveAuthSession(context.req.raw)),
    ],
  });
}

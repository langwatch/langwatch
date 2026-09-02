/**
 * The BROWSER SESSION, resolved for a REST family that answers its own
 * refusals.
 *
 * The sibling of {@link ApiHandlerManagedCredentials}, and it exists for the
 * same reason: a handful of families declare
 * `handlerManagedAuth({ credential: "session" })` because they resolve a
 * signed-in person themselves and publish refusal bodies that predate both
 * error envelopes — a bare `{ error }` at 401 for a signed-out caller and at
 * 403 for one without the permission. Routing them onto the framework chain
 * would change the wire on endpoints the studio, the playground and the
 * dataset generator call.
 *
 * It resolves through the SAME Better Auth transport and the SAME `AuthService`
 * the process's tRPC boundary authenticates on, and checks the permission
 * through the SAME `AuthzService`, so the two doors cannot decide differently
 * about a person.
 *
 * A deployment that composed no browser-session transport composes NONE of
 * this: the families that take it are left unmounted rather than mounted over
 * a resolver that answers null, because a door that refuses every signed-in
 * person is worse than one that is honestly not there.
 */
import type { AuthService } from "@langwatch/auth-contract";
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";

import type { ApiBrowserSessionTransportPort } from "./api-auth.composition";

/** The signed-in person a handler reads, or nothing. */
export type HandlerManagedSession = Readonly<{ user: Readonly<{ id: string }> }>;

/** What a family taking this port calls. */
export type ApiHandlerManagedSessionPort = Readonly<{
  /** The signed-in person behind this request, or null for an anonymous one. */
  resolve(request: Request): Promise<HandlerManagedSession | null>;
  /** Whether that person holds one permission on one project. */
  permitted(input: {
    session: HandlerManagedSession;
    projectId: string;
    permission: AuthzPermission;
  }): Promise<boolean>;
}>;

export class ApiHandlerManagedSession implements ApiHandlerManagedSessionPort {
  static create(options: {
    auth: AuthService;
    sessions: ApiBrowserSessionTransportPort;
    authz: AuthzService;
  }): ApiHandlerManagedSession {
    return new ApiHandlerManagedSession(options.auth, options.sessions, options.authz);
  }

  private constructor(
    private readonly auth: AuthService,
    private readonly sessions: ApiBrowserSessionTransportPort,
    private readonly authz: AuthzService,
  ) {}

  async resolve(request: Request): Promise<HandlerManagedSession | null> {
    const verified = await this.sessions.tryResolveVerifiedSession(request);
    if (!verified) return null;
    const session = await this.auth.tryResolveBrowserSession({ verified });
    if (!session) return null;
    return { user: { id: session.user.id } };
  }

  permitted(input: {
    session: HandlerManagedSession;
    projectId: string;
    permission: AuthzPermission;
  }): Promise<boolean> {
    return this.authz.hasPermission({
      userId: input.session.user.id,
      permission: input.permission,
      projectId: input.projectId,
    });
  }
}

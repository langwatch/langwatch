import type { AuthService, VerifiedBrowserSession } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import { ApiAuthenticationPort } from "../api-request.policy";

const logger = createLogger("langwatch:api:auth");

export type BetterAuthSessionLookup = Readonly<{
  api: Readonly<{
    getSession(input: { headers: Headers }): Promise<VerifiedBrowserSession | null>;
  }>;
}>;

/** The Better Auth request boundary required by the API process. */
export abstract class ApiBrowserSessionTransportPort {
  /** A missing or unusable Better Auth session resolves to null. */
  abstract tryResolveVerifiedSession(request: Request): Promise<VerifiedBrowserSession | null>;
}

/** Adapts Better Auth's verified browser session lookup to the API process. */
export class BetterAuthBrowserSessionTransportAdapter extends ApiBrowserSessionTransportPort {
  static create(transport: BetterAuthSessionLookup): BetterAuthBrowserSessionTransportAdapter {
    return new BetterAuthBrowserSessionTransportAdapter(transport);
  }

  private constructor(private readonly transport: BetterAuthSessionLookup) {
    super();
  }

  async tryResolveVerifiedSession(request: Request): Promise<VerifiedBrowserSession | null> {
    try {
      return await this.transport.api.getSession({ headers: request.headers });
    } catch (error) {
      logger.error(
        { error },
        "Better Auth browser-session lookup failed; treating request as anonymous",
      );
      return null;
    }
  }
}

export type ApiAuthSessionDependencies = Readonly<{
  auth: AuthService;
  sessions: ApiBrowserSessionTransportPort;
}>;

/**
 * Required process composition for browser-session authentication.
 *
 * The API package cannot construct Auth's persistence graph: the host must
 * supply the one already-composed Auth service and Better Auth transport.
 */
export abstract class ApiAuthSessionCompositionPort {
  abstract compose(): ApiAuthSessionDependencies;
}

/** Converts one verified browser session into the request actor vocabulary. */
export class AuthSessionApiAuthenticationAdapter extends ApiAuthenticationPort {
  static create(options: ApiAuthSessionDependencies): AuthSessionApiAuthenticationAdapter {
    return new AuthSessionApiAuthenticationAdapter(options.auth, options.sessions);
  }

  private constructor(
    private readonly auth: AuthService,
    private readonly sessions: ApiBrowserSessionTransportPort,
  ) {
    super();
  }

  async authenticate(request: Request): Promise<{ id: string } | null> {
    try {
      const verified = await this.sessions.tryResolveVerifiedSession(request);
      if (!verified) return null;
      const session = await this.auth.tryResolveBrowserSession({ verified });
      return session ? { id: session.user.id } : null;
    } catch (error) {
      logger.error({ error }, "Browser-session resolution failed; treating request as anonymous");
      return null;
    }
  }
}

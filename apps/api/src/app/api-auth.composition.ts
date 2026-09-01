import type { AuthService, VerifiedBrowserSession } from "@langwatch/auth-contract";
import { PostgresAuthAdapter } from "@langwatch/auth-server";
import { issuerForProviderId, PostgresIdentityEmailAdapter } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { RedisConnection } from "@langwatch/redis-client";
import { PostgresUserAdapter } from "@langwatch/user-server";
import { ApiAuthenticationPort } from "../api-request.policy";
import { UnavailableApiUserAvatarStorageAdapter } from "./api-user-avatar-storage.adapter";

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

/**
 * The cookie names a Better Auth session token can arrive under.
 *
 * The name is `<prefix>.session_token`, where the prefix is the deployment's
 * `advanced.cookiePrefix` (`better-auth` unless it says otherwise) and where a
 * secure deployment adds `__Secure-` or `__Host-` in front of the whole thing.
 * Matching the suffix rather than any single literal is what keeps this
 * question answerable without this process knowing the other tier's cookie
 * configuration — which is exactly the configuration it does not hold.
 *
 * `session_data` is deliberately not matched: it is the cached payload, not the
 * credential, and a request can carry it without carrying a token.
 */
const SESSION_TOKEN_COOKIE = /(?:^|;\s*)([^=;\s]*session_token)=/g;

/** The session-token cookie names on a request, values never read. */
function presentedSessionCookies(request: Request): string[] {
  const cookie = request.headers.get("cookie");
  if (!cookie) return [];
  return [...cookie.matchAll(SESSION_TOKEN_COOKIE)].flatMap(([, name]) => (name ? [name] : []));
}

/**
 * Adapts Better Auth's verified browser session lookup to the API process.
 *
 * Two failures are told apart here, and keeping them apart is the point. A
 * request carrying no session cookie resolves to null because the caller is
 * anonymous, which is the ordinary case and says nothing. A request that DID
 * present a session token and still resolved to nothing is a refusal — the
 * token is expired or revoked, or this transport and the tier that minted it
 * disagree about the signing secret, the cookie prefix or the provider
 * configuration behind them.
 *
 * The second case is logged. A Better Auth misconfiguration has already taken
 * sign-in down in production once, and what made it expensive was that the
 * refusal was indistinguishable from an anonymous request: every caller was
 * simply treated as signed out, with nothing in any log to say a credential had
 * been presented and rejected. Cookie NAMES are recorded and values never are —
 * the name is what tells an operator which cookie configuration the browser is
 * actually using.
 */
export class BetterAuthBrowserSessionTransportAdapter extends ApiBrowserSessionTransportPort {
  static create(transport: BetterAuthSessionLookup): BetterAuthBrowserSessionTransportAdapter {
    return new BetterAuthBrowserSessionTransportAdapter(transport);
  }

  private constructor(private readonly transport: BetterAuthSessionLookup) {
    super();
  }

  async tryResolveVerifiedSession(request: Request): Promise<VerifiedBrowserSession | null> {
    const presented = presentedSessionCookies(request);
    try {
      const verified = await this.transport.api.getSession({ headers: request.headers });
      if (!verified && presented.length > 0) {
        logger.warn(
          { cookies: presented },
          "Better Auth rejected a browser session token this request presented; the caller is treated as anonymous",
        );
      }
      return verified;
    } catch (error) {
      logger.error(
        { error, cookies: presented },
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
 * A host implements it when it already owns the graph; otherwise the process
 * composes {@link ApiAuthComposition} for itself over its own guarded client
 * and takes only the Better Auth transport from the deployment.
 */
export abstract class ApiAuthSessionCompositionPort {
  abstract compose(): ApiAuthSessionDependencies;
}

/** Reports the composition decisions a missing collaborator would otherwise hide. */
export abstract class ApiAuthAbsenceReportPort {
  abstract absent(reason: "no-database" | "no-tenancy" | "no-browser-session-transport"): void;
}

export type ApiAuthCompositionOptions = {
  database: PrismaConnection;
  /**
   * The organization service the user service resolves a person's workspaces
   * through — the same instance the rest of this process serves from, never a
   * second one, or two graphs would answer for one organization.
   */
  organizations: OrganizationService;
  /**
   * The deployment's Better Auth request boundary.
   *
   * The one collaborator on this graph a package cannot build; see
   * {@link ApiAuthComposition} for why.
   */
  browserSessions: ApiBrowserSessionTransportPort;
  /**
   * The process's Redis, where it has one.
   *
   * Better Auth caches live sessions there under its own key prefix, so
   * revoking a session has to clear that cache as well as the row. A process
   * with no Redis revokes the rows only, which is correct for a deployment that
   * keeps its sessions in Postgres alone and wrong for one that does not — so
   * the connection is passed rather than assumed absent.
   */
  redis?: RedisConnection | null;
  /** Names this process in the refusal an avatar upload produces. */
  processName: string;
};

/**
 * The API process's own Auth service, composed rather than received — and the
 * one half of it that is still received.
 *
 * `API_UNAVAILABLE_PRODUCT_ADAPTERS` named `IdentityEmailService` and the
 * Better Auth browser-session transport together, because the entry is one
 * option a host fills: `ApiAuthSessionCompositionPort` hands over the Auth
 * service and the transport as a pair. They are not one gap.
 *
 * `IdentityEmailService` was never process-bound. It reads the `Identifier`
 * projection and one migration-state row, and `PostgresIdentityEmailAdapter`
 * is both over the client this process already composes. The user service
 * under it is the packaged `PostgresUserAdapter` over the same client, with
 * its avatar storage declared absent
 * ({@link UnavailableApiUserAvatarStorageAdapter}) because writing an avatar
 * needs a stored-object application and reading a profile does not.
 *
 * The transport IS process-bound, and the difference is worth stating exactly.
 * It is not a session table this package could query; it is one configured
 * Better Auth server instance, and everything that decides whether a cookie
 * verifies lives in that instance's options: the signing secret, the base URL
 * and trusted origins, the cookie prefix, the session model mapping, the
 * secondary-storage prefix, the mounted social and generic-OIDC providers with
 * the provider ids a stored account row is keyed by, the identity storage
 * adapter, and the request hooks. A second instance composed here from a
 * different option set would not fail — it would verify nothing and answer
 * `null`, which reads to every caller as "signed out". That is the failure
 * mode a Better Auth provider-id mismatch has already produced in production,
 * and it stayed expensive precisely because nothing recorded the refusal.
 *
 * So the transport is supplied, and its absence is a composition decision this
 * process announces rather than papers over: without it there is no way to
 * authenticate a browser caller, so no request policy is built and the doors
 * that authenticate through one are not mounted.
 */
export class ApiAuthComposition extends ApiAuthSessionCompositionPort {
  /**
   * Composes the Auth graph only when this process holds everything it reads
   * through.
   *
   * Absent beats mounted at every one of these gaps, for the reason the secret
   * and agents doors already follow: a door that answers every call with a 500
   * — or, worse here, one that answers every call with "signed out" — is worse
   * than a door that is not there.
   */
  static tryCompose(
    options: Omit<ApiAuthCompositionOptions, "database" | "organizations" | "browserSessions"> & {
      database: PrismaConnection | undefined;
      organizations: OrganizationService | undefined;
      browserSessions: ApiBrowserSessionTransportPort | undefined;
      report?: ApiAuthAbsenceReportPort;
    },
  ): ApiAuthComposition | undefined {
    if (!options.database) {
      options.report?.absent("no-database");
      return undefined;
    }
    if (!options.organizations) {
      options.report?.absent("no-tenancy");
      return undefined;
    }
    if (!options.browserSessions) {
      options.report?.absent("no-browser-session-transport");
      return undefined;
    }
    return ApiAuthComposition.compose({
      ...options,
      database: options.database,
      organizations: options.organizations,
      browserSessions: options.browserSessions,
    });
  }

  static compose(options: ApiAuthCompositionOptions): ApiAuthComposition {
    // The typed client satisfies each feature's structural database port on its
    // own terms, and every repository underneath takes the same typed client.
    // No assertion sits at this seam, and none should.
    const database = options.database.client;
    const users = PostgresUserAdapter.create({
      database,
      // The issuer a credential account row is stored under is a persisted
      // format, so it is minted by the package that owns the format rather
      // than restated here — a root that spelled the prefix out would write
      // rows the other tier's queries do not find.
      credentialIssuer: issuerForProviderId("credential"),
      organizations: options.organizations,
      avatarStorage: UnavailableApiUserAvatarStorageAdapter.create({
        processName: options.processName,
      }),
    }).build();

    return new ApiAuthComposition({
      auth: PostgresAuthAdapter.create({
        database,
        redis: options.redis ?? null,
        identityEmails: PostgresIdentityEmailAdapter.create({ database }).build(),
        users,
      }).build(),
      sessions: options.browserSessions,
    });
  }

  private constructor(private readonly dependencies: ApiAuthSessionDependencies) {
    super();
  }

  compose(): ApiAuthSessionDependencies {
    return this.dependencies;
  }
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
      if (!session) {
        // Better Auth verified the cookie and the Auth service still found no
        // live session: the row is gone, revoked, or was never this process's
        // to see. Distinct from an anonymous caller for the same reason the
        // transport's own refusal is, and silent for the same cost.
        logger.warn(
          { sessionId: verified.session.id, userId: verified.user.id },
          "Better Auth verified a browser session the Auth service could not resolve; the caller is treated as anonymous",
        );
        return null;
      }
      return { id: session.user.id };
    } catch (error) {
      logger.error({ error }, "Browser-session resolution failed; treating request as anonymous");
      return null;
    }
  }
}

import type { AuthService, VerifiedBrowserSession } from "@langwatch/auth-contract";
import { PostgresAuthAdapter, type SignUpVerificationPort } from "@langwatch/auth-server";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { issuerForProviderId, PostgresIdentityEmailAdapter } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { RedisConnection } from "@langwatch/redis-client";
import { PostgresUserAdapter, type UserAvatarStoragePort } from "@langwatch/user-server";
import type { UserService } from "@langwatch/user-contract";
import { ApiUserAvatarStorageAdapter } from "../features/user/user-avatar-storage.adapter";
import type { ApiBrowserSessionConfig } from "../platform/config/api.config";
import { ApiAuthenticationPort } from "../api-request.policy";
import type { ApiTrpcSession } from "../app-trpc/app-trpc.context";
import {
  announceApiBetterAuthAbsences,
  composeApiBetterAuth,
  type ApiPasswordResetMailPort,
} from "./api-better-auth.composition";

const logger = createLogger("langwatch:api:auth");

export type BetterAuthSessionLookup = Readonly<{
  /** The fetch-compatible boundary the `/api/auth/*` catch-all hands off to. */
  handler(request: Request): Promise<Response>;
  api: Readonly<{
    getSession(input: { headers: Headers }): Promise<VerifiedBrowserSession | null>;
  }>;
}>;

/**
 * The Better Auth instance this process composed, and the origin it verifies against.
 * Published so the `/api/auth` REST family can be mounted over the SAME instance the
 * session transport already reads.
 */
export type ApiComposedBetterAuth = Readonly<{
  transport: BetterAuthSessionLookup;
  baseUrl: string;
}>;

/** The Better Auth request boundary required by the API process. */
export abstract class ApiBrowserSessionTransportPort {
  /** A missing or unusable Better Auth session resolves to null. */
  abstract tryResolveVerifiedSession(request: Request): Promise<VerifiedBrowserSession | null>;
}

/**
 * The cookie names a Better Auth session token can arrive under.
 */
const SESSION_TOKEN_COOKIE = /(?:^|;\s*)([^=;\s]*session_token)=/g;

/** The session-token cookie names on a request, values never read. */
function presentedSessionCookies(request: Request): string[] {
  const cookie = request.headers.get("cookie");
  if (!cookie) return [];
  return [...cookie.matchAll(SESSION_TOKEN_COOKIE)].flatMap(([, name]) => (name ? [name] : []));
}

/**
 * Adapts Better Auth's verified browser session lookup to the API process. Two failures
 * are told apart here, and keeping them apart is the point.
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
  /**
   * The user directory the Auth service already resolves a signed-in person through.
   */
  users: UserService;
}>;

/**
 * Required process composition for browser-session authentication.
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
   * A host's own Better Auth request boundary, where it has one.
   */
  browserSessions?: ApiBrowserSessionTransportPort | undefined;
  /**
   * The deployment's browser-session identity, read from its environment. Without it —
   * and without an injected transport — there is no way to verify a browser caller, and
   * the Auth graph is not composed.
   */
  browserSession?: ApiBrowserSessionConfig | undefined;
  /** `"email"`, or the federated provider id this deployment mounted. */
  authProvider?: string | undefined;
  /** Whether this is the hosted product rather than a self-hosted install. */
  isSaas?: boolean | undefined;
  /** The grant ledger an SSO domain auto-join writes its membership through. */
  authzGrants?: AuthzGrantsService | undefined;
  /** The gateway a password-reset link leaves through. */
  mail?: ApiPasswordResetMailPort | undefined;
  /** Sign-up's address confirmation, for the passkey ceremony. */
  signUpVerification?: SignUpVerificationPort | undefined;
  /**
   * The process's Redis, where it has one. Better Auth caches live sessions there under
   * its own key prefix, so revoking a session has to clear that cache as well as the row.
   */
  redis?: RedisConnection | null;
  /**
   * Where an uploaded avatar's bytes are written.
   */
  avatarStorage?: UserAvatarStoragePort | undefined;
  /** Names this process in the refusal an avatar upload produces. */
  processName: string;
};

/**
 * The API process's own Auth service, composed rather than received — and the one half of
 * it that is still received.
 */
export class ApiAuthComposition extends ApiAuthSessionCompositionPort {
  /**
   * Composes the Auth graph only when this process holds everything it reads through.
   */
  static tryCompose(
    options: Omit<ApiAuthCompositionOptions, "database" | "organizations"> & {
      database: PrismaConnection | undefined;
      organizations: OrganizationService | undefined;
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
    if (!options.browserSessions && !options.browserSession) {
      options.report?.absent("no-browser-session-transport");
      return undefined;
    }
    return ApiAuthComposition.compose({
      ...options,
      database: options.database,
      organizations: options.organizations,
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
      avatarStorage:
        options.avatarStorage ??
        ApiUserAvatarStorageAdapter.absent({ processName: options.processName }),
    }).build();

    const auth = PostgresAuthAdapter.create({
      database,
      redis: options.redis ?? null,
      identityEmails: PostgresIdentityEmailAdapter.create({ database }).build(),
      users,
    }).build();

    const supplied = options.browserSessions;
    if (supplied) {
      return new ApiAuthComposition({ auth, sessions: supplied, users }, undefined);
    }

    const betterAuth = ApiAuthComposition.composeBetterAuth({ options, database, auth, users });
    return new ApiAuthComposition(
      {
        auth,
        sessions: BetterAuthBrowserSessionTransportAdapter.create(betterAuth.transport),
        users,
      },
      betterAuth,
    );
  }

  /**
   * Composes the deployment's Better Auth instance over this process's own graph.
   */
  private static composeBetterAuth({
    options,
    database,
    auth,
    users,
  }: {
    options: ApiAuthCompositionOptions;
    database: PrismaConnection["client"];
    auth: AuthService;
    users: UserService;
  }): ApiComposedBetterAuth {
    const configuration = options.browserSession;
    if (!configuration) {
      throw new Error(
        "No Better Auth transport was supplied and this deployment named no browser-session identity",
      );
    }

    announceApiBetterAuthAbsences(logger);

    return {
      transport: composeApiBetterAuth({
        configuration,
        database,
        auth,
        users,
        redis: options.redis ?? null,
        authProvider: options.authProvider,
        isSaas: options.isSaas === true,
        authzGrants: options.authzGrants,
        mail: options.mail,
        signUpVerification: options.signUpVerification,
        logger,
      }) as unknown as BetterAuthSessionLookup,
      baseUrl: configuration.baseUrl,
    };
  }

  private constructor(
    private readonly dependencies: ApiAuthSessionDependencies,
    /** The instance this process composed, or nothing where a host supplied one. */
    readonly betterAuth: ApiComposedBetterAuth | undefined,
  ) {
    super();
  }

  compose(): ApiAuthSessionDependencies {
    return this.dependencies;
  }
}

/** Converts one verified browser session into the request actor vocabulary. */
export class AuthSessionApiAuthenticationAdapter extends ApiAuthenticationPort {
  /**
   * Narrower than {@link ApiAuthSessionDependencies} on purpose: turning a verified
   * session into an actor needs the Auth service and the transport and nothing else.
   */
  static create(
    options: Pick<ApiAuthSessionDependencies, "auth" | "sessions">,
  ): AuthSessionApiAuthenticationAdapter {
    return new AuthSessionApiAuthenticationAdapter(options.auth, options.sessions);
  }

  private constructor(
    private readonly auth: AuthService,
    private readonly sessions: ApiBrowserSessionTransportPort,
  ) {
    super();
  }

  async authenticate(request: Request): Promise<ApiTrpcSession | null> {
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
      return session;
    } catch (error) {
      logger.error({ error }, "Browser-session resolution failed; treating request as anonymous");
      return null;
    }
  }
}

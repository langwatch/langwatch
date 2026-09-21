import { ApiKeyApi } from "@langwatch/api-key-contract";
/**
 * Auth module application: browser sessions and signed-out door. One application
 * for one person; reaches all state through member dependencies, not ambient.
 */
import {
  AuthApi,
  assertAuthServerConfig,
  authServerConfig,
  AuthUnavailableError,
  AuthValidateRateLimitedError,
  type AuthApi as AuthApiContract,
  type AuthServerConfig,
  type BrowserSession,
  type BrowserSessionInventoryEntry,
  type CliAccessSession,
  type InviteLanding,
  type SignUpVerificationResult,
  type VerifiedBrowserSession,
} from "@langwatch/auth-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { IdentityEmailService, RoutingDecision } from "@langwatch/identity-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { resolveRequestBound } from "@langwatch/plans";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { Secret } from "@langwatch/secrets";
import { nowInstant, type Instant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import type { BetterAuthTransport } from "../channels/http/http.better-auth.channel.ts";
import type { AuthRepositories } from "../repositories/auth.repositories.ts";
import { PrismaAuthDirectoryRepository } from "../repositories/prisma/prisma.auth-directory.repository.ts";
import { RedisAuthSessionCacheRepository } from "../repositories/redis/redis.auth-session-cache.repository.ts";
import { BrowserSessionService } from "../services/browser-session.service.ts";
import { CliDeviceSessionService } from "../services/cli-device-session.service.ts";
import {
  SignUpVerificationService,
  type SignUpAccountDirectory,
  type SignUpAccountFactory,
  type SignUpVerificationMailer,
} from "../services/signup-verification.service.ts";
import type { AuthRestFederatedLogout, AuthRestSession } from "../transport/auth.rest.ts";
import { buildBetterAuth, type BetterAuthDeploymentIdentity } from "./auth-composition.build.ts";
import type { AuthDirectory } from "./auth.members.ts";

/**
 * The account rows sign-up reads and confirms. Auth owns neither: the `User`
 * table is the user module's, so the process hands over the two reads rather
 * than a connection, and the account MINT goes through `UserApi` itself.
 */
export interface AuthAccountRows extends SignUpAccountDirectory {
  /** The link came back, so the address is proven. */
  markAddressConfirmed(input: { email: string }): Promise<void>;
}

/**
 * The invitation a landing page reads, and the reissue request behind it. Both
 * run over the organization module's rows, so both arrive from the process.
 */
export interface AuthInviteDirectory {
  readLanding(input: Readonly<{ inviteCode: string }>): Promise<InviteLanding>;
  requestFresh(input: Readonly<{ inviteCode: string }>): Promise<void>;
}

/** The sign-up ceremony's collaborators, present together or absent together. */
export type AuthSignUpCollaborators = Readonly<{
  accounts: AuthAccountRows;
  mailer: SignUpVerificationMailer;
  /** The public base URL the confirmation link is built from. */
  baseUrl: string;
}>;

/**
 * The closed members this module reads through {@link reads}, restated as a
 * named tuple so `publicBaseUrl` (a process fact, not one of the fourteen)
 * can be appended to the runtime list below without losing this typing.
 */
const AUTH_CLOSED_READS = reads("logger", "prisma", "redis", "rateLimiter", "secrets");

/**
 * Process-supplied infrastructure. Declared members required at boot;
 * front-door features need identity, organization, and mail peers.
 */
export type AuthInfrastructure = MembersRead<typeof AUTH_CLOSED_READS> &
  Readonly<{
    /** The public base URL this process was deployed under, or absent where
     * it named none — the process's own fact (`packages/process-server`),
     * never a module-declared env spelling. */
    publicBaseUrl: string | undefined;
    /** The address the identifier ledger holds for a person, where it holds
     * one. `undefined` until the front-door wiring lane supplies identity's
     * service — the session read then falls back to the stored user's own
     * address, which is the documented chain, not a degraded one. */
    identityEmails: IdentityEmailService | undefined;
    /** Where an address signs in. The decision object IS the contract.
     * `undefined` until the front-door wiring lane supplies it. */
    route:
      | ((
          input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
        ) => Promise<RoutingDecision>)
      | undefined;
    /**
     * The sign-up ceremony, or nothing. Absent together and that is not an
     * accident: without a base URL a confirmation link points at nowhere, and
     * without a mail gateway it is never sent.
     */
    signUp: AuthSignUpCollaborators | null;
    /** The invitation reads, or nothing where this process composed none. */
    invites: AuthInviteDirectory | null;
    /** This deployment's sign-in mode, ADR-027's single source of truth.
     * `undefined` until the front-door wiring lane supplies it. */
    authProvider: (() => Promise<string>) | undefined;
    /** The federated provider id Better Auth's federation gate reads — distinct
     * from `authProvider` above (ADR-027's resolver). Unresolved; see the handoff. */
    federatedProvider: string | undefined;
    /** Whether this is the hosted product: the process's own fact, supplied
     * as a member. The flag itself has a ruling of its own pending. */
    isSaas: boolean;
    /** Names this process in every refusal below. */
    processName: string;
    /** Process time, injected so session expiry has deterministic tests. */
    now?: (() => Instant) | undefined;
  }>;

type AuthSetup = FeatureSetup<
  typeof AuthApp.dependencies,
  AuthInfrastructure,
  AuthServerConfig,
  AuthRepositories
>;

export class AuthApp implements AuthApiContract {
  static readonly contract = AuthApi;
  static readonly dependencies = {
    users: UserApi,
    /** The credential ledger the legacy `X-Auth-Token` check resolves through. */
    apiKeys: ApiKeyApi,
    /** This deployment's flag store, for the born-finalized entrance. */
    featureFlags: FeatureFlagApi,
  };
  static readonly config = authServerConfig;
  /** `secrets` resolves NEXTAUTH_SECRET (ADR-132); `publicBaseUrl` is the
   * process's own fact. A process that cannot supply one refuses at boot. */
  static readonly reads = [...AUTH_CLOSED_READS, "publicBaseUrl", "isSaas"] as const;
  /** The browser-session key. Only the identity built from it ever escapes (ADR-132). */
  static readonly secrets = {
    session: Secret.load("NEXTAUTH_SECRET", { optional: true }),
  } as const;

  readonly #sessions: BrowserSessionService;
  readonly #cliSessions: CliDeviceSessionService;
  readonly #signUp: SignUpVerificationService | null;
  readonly #members: AuthInfrastructure;
  readonly #dependencies: { apiKeys: ApiKeyApi; featureFlags: FeatureFlagApi };
  /**
   * The deployment's ONE Better Auth instance, or nothing where it named no
   * browser-session identity. Assigned once in {@link AuthApp.create}: it must
   * revoke sessions on the same application every other caller revokes through.
   */
  #betterAuth: BetterAuthTransport | null = null;
  /** The identity {@link AuthApp.create} resolved, held for {@link baseUrl}. */
  #browserSession: BetterAuthDeploymentIdentity | undefined;

  /** This deployment's answer to {@link AuthApp.offersPasskeys}. */
  #offersPasskeys = false;

  offersPasskeys(): boolean {
    return this.#offersPasskeys;
  }

  private constructor(
    sessions: BrowserSessionService,
    cliSessions: CliDeviceSessionService,
    signUp: SignUpVerificationService | null,
    members: AuthInfrastructure,
    dependencies: { apiKeys: ApiKeyApi; featureFlags: FeatureFlagApi },
  ) {
    this.#sessions = sessions;
    this.#cliSessions = cliSessions;
    this.#signUp = signUp;
    this.#members = members;
    this.#dependencies = dependencies;
  }

  static create(setup: AuthSetup): Promise<AuthApp> {
    const { members, repositories, dependencies, config } = setup;
    const now = members.now ?? nowInstant;

    const app = new AuthApp(
      BrowserSessionService.create({
        sessions: repositories.sessions,
        cache: RedisAuthSessionCacheRepository.create({ redis: members.redis }),
        identityEmails: members.identityEmails,
        users: dependencies.users,
        now,
      }),
      CliDeviceSessionService.create({
        store: repositories.cliSessions,
      }),
      signUpVerification({ members, repositories, now, users: dependencies.users }),
      members,
      { apiKeys: dependencies.apiKeys, featureFlags: dependencies.featureFlags },
    );

    app.#offersPasskeys = config.passkeysEnabled;

    return setup.secrets.into(AuthApp.secrets.session, (sessionSecret) => {
      assertAuthServerConfig(config, sessionSecret);

      const identity: BetterAuthDeploymentIdentity | undefined =
        config.sessionUrl && sessionSecret
          ? {
              secret: sessionSecret,
              baseUrl: config.sessionUrl,
              publicBaseUrl: members.publicBaseUrl,
              mfaEnrollmentOpen: config.mfaEnrollmentOpen,
              passkeysEnabled: config.passkeysEnabled,
              passkeyHandleSecret: config.passkeyHandleSecret ?? sessionSecret,
            }
          : undefined;
      app.#browserSession = identity;

      if (identity) {
        app.#betterAuth = buildBetterAuth({
          identity,
          prisma: members.prisma,
          redis: members.redis,
          auth: app,
          users: dependencies.users,
          authProvider: members.federatedProvider,
          isSaas: members.isSaas,
          logger: members.logger,
        });
      } else {
        members.logger.info(
          { module: "auth" },
          "This process named no browser-session identity (NEXTAUTH_SECRET and NEXTAUTH_URL), so it composes no Better Auth instance: every browser caller reads as signed out and the sign-in door refuses",
        );
      }

      return app;
    });
  }

  /** The deployment's ONE Better Auth instance, or the refusal that names why there is none. */
  betterAuth(): BetterAuthTransport {
    if (!this.#betterAuth) {
      throw new AuthUnavailableError({
        capability:
          "browser-session identity (NEXTAUTH_SECRET and NEXTAUTH_URL), so it composes no sign-in door",
        processName: this.#members.processName,
      });
    }

    return this.#betterAuth;
  }

  /**
   * Whether Better Auth accepts the session token these headers carry.
   * Answers "nobody" rather than refusing when this process composed no
   * instance — an unconfigured deployment has anonymous callers, not failing ones.
   */
  async tryVerifyBrowserSession(input: {
    headers: Headers;
  }): Promise<VerifiedBrowserSession | null> {
    if (!this.#betterAuth) return null;

    return (await this.#betterAuth.api.getSession({
      headers: input.headers,
    })) as VerifiedBrowserSession | null;
  }

  /** The session the browser's own poll reads, verified and then resolved. */
  async resolveSession(request: Request): Promise<AuthRestSession | null> {
    const verified = await this.tryVerifyBrowserSession({ headers: request.headers });

    return this.tryResolveBrowserSession({ verified });
  }

  /**
   * The project a legacy `X-Auth-Token` names, by slug. Every call probes a
   * secret and gets a yes/no answer, so a caller that names itself is counted
   * first: past the registry's per-minute ceiling the probe stops answering.
   */
  async findProjectSlugByToken(input: {
    token: string;
    callerKey?: string;
  }): Promise<string | null> {
    if (input.callerKey !== undefined) {
      await this.countValidateCall(input.callerKey);
    }

    const resolved = await this.#dependencies.apiKeys.findResolvedToken({ token: input.token });

    return resolved?.project.slug ?? null;
  }

  /** One probe of the token check, against the registry's per-IP ceiling. */
  private async countValidateCall(callerKey: string): Promise<void> {
    const requests = resolveRequestBound("authValidatePerIpPerMinute", "ENTERPRISE");
    const decision = await this.#members.rateLimiter.check(`auth-validate:${callerKey}`, {
      requests,
      seconds: 60,
    });

    if (!decision.allowed) {
      throw new AuthValidateRateLimitedError({ retryAfterSeconds: decision.retryAfterSeconds });
    }
  }

  featureFlags(): FeatureFlagApi {
    return this.#dependencies.featureFlags;
  }

  directory(): AuthDirectory {
    return PrismaAuthDirectoryRepository.create(this.#members.prisma);
  }

  /** The origin every state-changing auth request is checked against. An
   * operation rather than a getter: the feature-API proxy the sign-in door
   * reads this through serves operations only. */
  baseUrl(): string {
    return this.#browserSession?.baseUrl ?? "";
  }

  /**
   * Where a GET logout lands. Local: ending the identity provider's own session
   * needs its end-session endpoint, and this module reads none.
   */
  readonly federatedLogout: AuthRestFederatedLogout = () => Promise.resolve(null);

  /**
   * ADR-116 §3's birth context. Identity doesn't export the adapter, so this
   * refuses to avoid finalized/legacy row mixing.
   */
  runWithIdentityBirth<T>(_run: () => Promise<T>): Promise<T> {
    return Promise.reject(
      new AuthUnavailableError({
        capability:
          "identity birth context (@langwatch/identity-process publishes no BetterAuthIdentityBirthAdapter), so it cannot run a born-finalized sign-up",
        processName: this.#members.processName,
      }),
    );
  }

  tryResolveBrowserSession(input: {
    verified: VerifiedBrowserSession | null;
  }): Promise<BrowserSession | null> {
    return this.#sessions.tryResolveBrowserSession(input);
  }

  async findCliAccessSession(input: {
    authorization: string | null | undefined;
  }): Promise<CliAccessSession | null> {
    const record = await this.#cliSessions.resolveAccessToken(input.authorization);
    if (!record) return null;

    return {
      userId: record.user_id,
      organizationId: record.organization_id,
      ...(record.client_info
        ? {
            clientInfo: {
              deviceLabel: record.client_info.device_label,
              hostname: record.client_info.hostname,
            },
          }
        : {}),
    };
  }

  revokeCliAccessToken(input: {
    authorization: string | null | undefined;
    userId: string;
  }): Promise<void> {
    return this.#cliSessions.revokeAccessToken({
      authHeader: input.authorization,
      userId: input.userId,
    });
  }

  listBrowserSessions(input: {
    userId: string;
    currentSessionId?: string | undefined;
  }): Promise<readonly BrowserSessionInventoryEntry[]> {
    return this.#sessions.listBrowserSessions(input);
  }

  endBrowserSession(input: {
    userId: string;
    sessionId: string;
    currentSessionId?: string | undefined;
  }): Promise<{ ended: number }> {
    return this.#sessions.endBrowserSession(input);
  }

  revokeAllBrowserSessions(input: { userId: string }): Promise<void> {
    return this.#sessions.revokeAllBrowserSessions(input);
  }

  revokeBrowserSession(input: { sessionId: string }): Promise<void> {
    return this.#sessions.revokeBrowserSession(input);
  }

  revokeOtherBrowserSessions(input: { userId: string; keepSessionId: string }): Promise<void> {
    return this.#sessions.revokeOtherBrowserSessions(input);
  }

  /** Meters through the counter every process supplies, the same one the token
   *  check counts against — a throttle refuses by its own code, never as an
   *  absent collaborator. specs/identity/signin-signup-screens.feature. */
  async isWithinBudget(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; retryAfterSeconds?: number | undefined }>> {
    const decision = await this.#members.rateLimiter.check(input.key, {
      requests: input.max,
      seconds: input.windowSeconds,
    });

    return { allowed: decision.allowed, retryAfterSeconds: decision.retryAfterSeconds };
  }

  route(
    input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
  ): Promise<RoutingDecision> {
    const route = this.#members.route;
    if (!route) {
      throw new AuthUnavailableError({
        capability: "sign-in routing directory, so it cannot decide where this address signs in",
        processName: this.#members.processName,
      });
    }
    return route(input);
  }

  async addressIsRegistered(input: Readonly<{ email: string }>): Promise<boolean> {
    return this.requireSignUp().addressIsRegistered(input);
  }

  async requestSignUpVerification(input: Readonly<{ email: string }>): Promise<void> {
    return this.requireSignUp().requestVerification(input);
  }

  async completeSignUpVerification(
    input: Readonly<{ token: string }>,
  ): Promise<SignUpVerificationResult> {
    return this.requireSignUp().completeVerification(input);
  }

  async readInviteLanding(input: Readonly<{ inviteCode: string }>): Promise<InviteLanding> {
    return this.requireInvites().readLanding(input);
  }

  async requestFreshInvite(input: Readonly<{ inviteCode: string }>): Promise<void> {
    return this.requireInvites().requestFresh(input);
  }

  resolveAuthProvider(): Promise<string> {
    const authProvider = this.#members.authProvider;
    if (!authProvider) {
      throw new AuthUnavailableError({
        capability: "sign-in mode configuration, so it cannot name this deployment's auth provider",
        processName: this.#members.processName,
      });
    }
    return authProvider();
  }

  /** The ceremony, or the refusal that names why this process has none. */
  private requireSignUp(): SignUpVerificationService {
    if (!this.#signUp) {
      throw new AuthUnavailableError({
        capability:
          "mail gateway with a public base URL, so it cannot send a sign-up confirmation link",
        processName: this.#members.processName,
      });
    }

    return this.#signUp;
  }

  private requireInvites(): AuthInviteDirectory {
    const invites = this.#members.invites;
    if (!invites) {
      throw new AuthUnavailableError({
        capability:
          "invitation service, so it cannot ask this organization's admins to reissue the invitation",
        processName: this.#members.processName,
      });
    }

    return invites;
  }
}

/** The ceremony this process can run, or nothing where a collaborator is missing. */
function signUpVerification({
  members,
  repositories,
  now,
  users,
}: {
  members: AuthInfrastructure;
  repositories: AuthRepositories;
  now: () => Instant;
  users: UserApi;
}): SignUpVerificationService | null {
  const signUp = members.signUp;
  if (!signUp) return null;

  const accounts: SignUpAccountFactory = {
    // Nobody has been asked for a name on this path: the person typed an
    // address and a password into a log-in form. Onboarding asks.
    createCredentialAccount: async ({ email, passwordHash }) => {
      await users.createCredentialUser({ name: null, email, passwordHash });
    },
    markAddressConfirmed: (input) => signUp.accounts.markAddressConfirmed(input),
  };

  return SignUpVerificationService.create({
    tokens: repositories.signUpTokens,
    mailer: signUp.mailer,
    directory: signUp.accounts,
    accounts,
    buildVerificationUrl: ({ token }) =>
      `${signUp.baseUrl}/auth/signup?verify=${encodeURIComponent(token)}`,
    now,
  });
}

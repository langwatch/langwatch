import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
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
  FrontDoorRateLimitedError,
  NoAddressToConfirmError,
  type AuthApi as AuthApiContract,
  type AuthServerConfig,
  type BrowserSession,
  type BrowserSessionInventoryEntry,
  type CliAccessSession,
  type CliTokenRecordEntry,
  type InviteLanding,
  type LegacySsoAccessQuery,
  type ReleaseHeldAccountResult,
  type SaveSignInSecurityInput,
  type SaveSignInSecurityResult,
  SIGN_IN_SECURITY_ENTERPRISE_REFUSAL,
  type SignInSecuritySettings,
  type SignUpVerificationResult,
  type VerifiedBrowserSession,
  type AuthUsageCount,
} from "@langwatch/auth-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { SsoApi } from "@langwatch/enterprise-sso-contract";
import {
  configuredAuthProvider,
  resolveSignInProviders,
} from "@langwatch/enterprise-sso-contract/sign-in-providers";
import {
  EnterprisePlanRequiredError,
  EntitlementApi,
  isEnterpriseTier,
} from "@langwatch/entitlement-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  IdentityApi,
  type IdentityEmailService,
  type RoutingDecision,
  type SignedInWith,
} from "@langwatch/identity-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { sessionSecret, signInProviderSecrets } from "@langwatch/secrets";
import { nowInstant, type Instant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import type { BetterAuthTransport } from "../channels/http/http.better-auth.channel.ts";
import type { AuthRepositories } from "../repositories/auth.repositories.ts";
import { PrismaAuthDirectoryRepository } from "../repositories/prisma/prisma.auth-directory.repository.ts";
import { PrismaBetterAuthHooksRepository } from "../repositories/prisma/prisma.better-auth-hooks.repository.ts";
import { RedisAuthSessionCacheRepository } from "../repositories/redis/redis.auth-session-cache.repository.ts";
import { keyedIdentifierHasher } from "../rules/sign-in-identifier-hash.rules.ts";
import { resolveDialableIdentityProviderOrigins } from "../rules/trusted-origins.rules.ts";
import { BrowserSessionService } from "../services/browser-session.service.ts";
import { CliDeviceSessionService } from "../services/cli-device-session.service.ts";
import { FederatedAccountReadsService } from "../services/federated-account-reads.service.ts";
import {
  LegacySsoAccessService,
  type LegacySsoAccessConnections,
  type LegacySsoAccessMemberships,
} from "../services/legacy-sso-access.service.ts";
import { SessionBoundService } from "../services/session-bound.service.ts";
import {
  SignInLockoutService,
  type SignInLockoutEvidence,
} from "../services/sign-in-lockout.service.ts";
import {
  SignInSecuritySettingsService,
  type SignInSecurityMembers,
  type SignInSecurityPlanGate,
  type SignInSecurityReleaseEvidence,
} from "../services/sign-in-security-settings.service.ts";
import {
  SignUpVerificationService,
  type SignUpAccountDirectory,
  type SignUpAccountFactory,
  type SignUpVerificationMailer,
} from "../services/signup-verification.service.ts";
import type { AuthRestFederatedLogout, AuthRestSessionAnswer } from "../transport/auth.rest.ts";
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
const AUTH_CLOSED_READS = reads(
  "encryption",
  "logger",
  "prisma",
  "redis",
  "rateLimiter",
  "secrets",
);

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
    /** Whether this is the hosted product: the process's own fact, supplied
     * as a member. The flag itself has a ruling of its own pending. */
    isSaas: boolean;
    /** The deployment's environment name — the process's own fact (`NODE_ENV`
     * has one owner). Read for what is trusted outside production only. */
    nodeEnvironment: string | undefined;
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
    /** Whose connections decide what a federated sign-in arrives into. */
    identity: IdentityApi,
    /** Who the members of an organization are, when a cutover asks auth what
     *  the retiring connection still holds open for them. */
    organizations: OrganizationApi,
    /** Where a lock-out is appended so an auditor can still read it (GAC-09). */
    auditLog: AuditLogApi,
    /** Whether an organization's plan carries the sign-in security rules. */
    entitlements: EntitlementApi,
    /** Whether a signed license permits platform single sign-on (ADR-027). */
    licensing: LicensingApi,
    /** The sign-in providers, shaped for Better Auth by enterprise SSO. */
    sso: SsoApi,
  };
  static readonly config = authServerConfig;
  /** `secrets` resolves NEXTAUTH_SECRET (ADR-132); `publicBaseUrl` is the
   * process's own fact. A process that cannot supply one refuses at boot. */
  static readonly reads = [
    ...AUTH_CLOSED_READS,
    "publicBaseUrl",
    "isSaas",
    "nodeEnvironment",
  ] as const;
  /** The browser-session key. Only the identity built from it ever escapes (ADR-132). */
  static readonly secrets = {
    session: sessionSecret,
    ...signInProviderSecrets,
  } as const;

  readonly #sessions: BrowserSessionService;
  readonly #cliSessions: CliDeviceSessionService;
  readonly #signUp: SignUpVerificationService | null;
  readonly #members: AuthInfrastructure;
  readonly #dependencies: { apiKeys: ApiKeyApi; featureFlags: FeatureFlagApi };
  /** The `Account` rows a retiring connection is judged over — auth's own,
   *  swept for a peer that owns none of them (ADR-129). */
  readonly #legacySsoAccess: LegacySsoAccessService;
  /** The provider side of the same rows: which ways in somebody holds. */
  readonly #federatedAccounts: FederatedAccountReadsService;
  /** The administrator's side of the two sign-in security rules. */
  readonly #signInSecurity: SignInSecuritySettingsService;
  /**
   * Composes the deployment's ONE Better Auth instance on first use (it asks
   * the SSO peer, which construction may not), or nothing where it named no
   * browser-session identity. Every caller shares {@link AuthApp.#betterAuth}.
   */
  #composeBetterAuth: (() => Promise<BetterAuthTransport>) | null = null;
  #betterAuth: Promise<BetterAuthTransport> | null = null;
  /** The identity {@link AuthApp.create} resolved, held for {@link baseUrl}. */
  #browserSession: BetterAuthDeploymentIdentity | undefined;

  /** This deployment's answer to {@link AuthApp.offersPasskeys}. */
  #offersPasskeys = false;

  offersPasskeys(): boolean {
    return this.#offersPasskeys;
  }

  /** This deployment's answer to {@link AuthApp.offersTwoStepVerification}. */
  #offersTwoStepVerification = false;

  offersTwoStepVerification(): boolean {
    return this.#offersTwoStepVerification;
  }

  getSignedInWith(input: { userId: string; sessionId: string }): Promise<SignedInWith> {
    return this.#sessions.getSignedInWith(input);
  }

  /** This deployment's answer to {@link AuthApp.issuesOwnPasswords} (D09). */
  #issuesOwnPasswords = false;

  issuesOwnPasswords(): boolean {
    return this.#issuesOwnPasswords;
  }

  /** This deployment's answer to {@link AuthApp.findDialableIdentityProviderOrigins}. */
  #dialableIdentityProviderOrigins: string[] = [];

  findDialableIdentityProviderOrigins(): string[] {
    return [...this.#dialableIdentityProviderOrigins];
  }

  private constructor({
    sessions,
    cliSessions,
    signUp,
    members,
    dependencies,
    legacySsoAccess,
    federatedAccounts,
    signInSecurity,
  }: {
    sessions: BrowserSessionService;
    cliSessions: CliDeviceSessionService;
    signUp: SignUpVerificationService | null;
    members: AuthInfrastructure;
    dependencies: { apiKeys: ApiKeyApi; featureFlags: FeatureFlagApi };
    legacySsoAccess: LegacySsoAccessService;
    federatedAccounts: FederatedAccountReadsService;
    signInSecurity: SignInSecuritySettingsService;
  }) {
    this.#sessions = sessions;
    this.#cliSessions = cliSessions;
    this.#signUp = signUp;
    this.#members = members;
    this.#dependencies = dependencies;
    this.#legacySsoAccess = legacySsoAccess;
    this.#federatedAccounts = federatedAccounts;
    this.#signInSecurity = signInSecurity;
  }

  static async create(setup: AuthSetup): Promise<AuthApp> {
    const { members, repositories, dependencies, config } = setup;
    const now = members.now ?? nowInstant;
    const accountRows = PrismaBetterAuthHooksRepository.create(members.prisma);

    const sessions = BrowserSessionService.create({
      sessions: repositories.sessions,
      cache: members.redis
        ? RedisAuthSessionCacheRepository.create({ redis: members.redis })
        : null,
      identityEmails: members.identityEmails,
      users: dependencies.users,
      sessionBound: SessionBoundService.create({
        settings: repositories.signInSecurity,
        activity: repositories.sessions,
        now,
      }),
      now,
    });

    const app = new AuthApp({
      sessions,
      cliSessions: CliDeviceSessionService.create({
        store: repositories.cliSessions,
      }),
      signUp: buildSignUpVerification({ members, repositories, now, users: dependencies.users }),
      members,
      dependencies: { apiKeys: dependencies.apiKeys, featureFlags: dependencies.featureFlags },
      legacySsoAccess: LegacySsoAccessService.create({
        accounts: accountRows,
        memberships: legacyAccessMemberships(dependencies.organizations),
        connections: legacyAccessConnections(dependencies.identity),
      }),
      federatedAccounts: FederatedAccountReadsService.create({ accounts: accountRows }),
      signInSecurity: SignInSecuritySettingsService.create({
        settings: repositories.signInSecurity,
        locks: repositories.signInLocks,
        members: signInSecurityMembers(dependencies.organizations),
        plan: signInSecurityPlanGate(dependencies.entitlements),
        evidence: auditedReleaseEvidence(dependencies.auditLog),
        sessions,
      }),
    });

    app.#offersPasskeys = config.passkeysEnabled;
    app.#offersTwoStepVerification = config.mfaEnrollmentOpen;
    app.#issuesOwnPasswords = config.localPasswords;
    app.#dialableIdentityProviderOrigins = resolveDialableIdentityProviderOrigins({
      trustedIdpOrigins: config.trustedIdpOrigins,
      idpSimulatorUrl: config.idpSimulatorUrl,
      isProduction: members.nodeEnvironment === "production",
    });

    const signInProviders = await resolveSignInProviders({
      config: config.signInProviders,
      into: setup.secrets.into,
      baseUrl: config.sessionUrl ?? "",
    });

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
        app.#composeBetterAuth = () =>
          buildBetterAuth({
            identity,
            signInLockout: SignInLockoutService.create({
              locks: repositories.signInLocks,
              settings: repositories.signInSecurity,
              directory: {
                findUserIdFor: async ({ identifier }) =>
                  (await dependencies.users.findByEmail({ email: identifier }))?.id ?? null,
              },
              evidence: auditedLockoutEvidence(dependencies.auditLog),
              hashIdentifier: keyedIdentifierHasher(sessionSecret),
              now,
            }),
            prisma: members.prisma,
            encryption: members.encryption,
            redis: members.redis,
            auth: app,
            users: dependencies.users,
            identityApi: dependencies.identity,
            signInRouting: members.route ?? null,
            authProvider: configuredAuthProvider(config.signInProviders).provider,
            signInProviders,
            licensing: dependencies.licensing,
            sso: dependencies.sso,
            isSaas: members.isSaas,
            localPasswords: config.localPasswords,
            trustedIdpOrigins: config.trustedIdpOrigins,
            idpSimulatorUrl: config.idpSimulatorUrl,
            isProduction: members.nodeEnvironment === "production",
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

  retireLegacySsoAccess(
    input: LegacySsoAccessQuery,
  ): Promise<{ retired: number; remaining: number }> {
    return this.#legacySsoAccess.retire(input);
  }

  countLegacySsoAccess(input: LegacySsoAccessQuery): Promise<number> {
    return this.#legacySsoAccess.count(input);
  }

  getSignInSecuritySettings(input: { organizationId: string }): Promise<SignInSecuritySettings> {
    return this.#signInSecurity.get(input);
  }

  saveSignInSecuritySettings(input: SaveSignInSecurityInput): Promise<SaveSignInSecurityResult> {
    return this.#signInSecurity.save(input);
  }

  releaseHeldAccount(input: {
    organizationId: string;
    userId: string;
    actorUserId: string;
  }): Promise<ReleaseHeldAccountResult> {
    return this.#signInSecurity.release(input);
  }

  findFederatedAccountProviders(input: { userId: string }): Promise<string[]> {
    return this.#federatedAccounts.findProvidersForUser(input);
  }

  getSsoSetupStatus(input: {
    userId: string;
    email: string;
  }): Promise<{ pendingSsoSetup: boolean }> {
    return this.#federatedAccounts.getSsoSetupStatus(input);
  }

  /** The deployment's ONE Better Auth instance, or the refusal that names why there is none. */
  async betterAuth(): Promise<BetterAuthTransport> {
    const compose = this.#composeBetterAuth;
    if (!compose) {
      throw new AuthUnavailableError({
        capability:
          "browser-session identity (NEXTAUTH_SECRET and NEXTAUTH_URL), so it composes no sign-in door",
        processName: this.#members.processName,
      });
    }

    this.#betterAuth ??= compose().catch((error: unknown) => {
      this.#betterAuth = null;
      throw error;
    });
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
    if (!this.#composeBetterAuth) return null;

    return (await (
      await this.betterAuth()
    ).api.getSession({
      headers: input.headers,
    })) as VerifiedBrowserSession | null;
  }

  /** The session the browser's own poll reads, verified and then resolved. */
  async resolveSession(request: Request): Promise<AuthRestSessionAnswer> {
    const verified = await this.tryVerifyBrowserSession({ headers: request.headers });
    const session = await this.tryResolveBrowserSession({ verified });

    return session === null ? { kind: "anonymous" } : { kind: "signed_in", session };
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
    const record = await this.#cliSessions
      .getAccessToken(input.authorization)
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "cli_session_record_not_found") {
          return null;
        }
        throw error;
      });
    if (!record) return null;

    return {
      userId: record.user_id,
      organizationId: record.organization_id,
      ...(record.cli_api_key_id ? { cliApiKeyId: record.cli_api_key_id } : {}),
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

  findCliTokenRecordsForUser(input: { userId: string }): Promise<CliTokenRecordEntry[]> {
    return this.#cliSessions.findTokenRecordsForUser(input);
  }

  revokeCliTokens(input: {
    userId: string;
    tokenKeys?: readonly string[] | undefined;
  }): Promise<{ revokedCount: number }> {
    return this.#cliSessions.revokeTokens(input);
  }

  async countUsage(input: { at: number }): Promise<AuthUsageCount> {
    return { signedInUsers: await this.#sessions.countSignedInUsers(input) };
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

  async requestNewAccountVerification(input: Readonly<{ email: string }>): Promise<void> {
    return this.requireSignUp().requestNewAccountVerification(input);
  }

  /** Metered on the caller rather than the address, like the token check's own probe. */
  async sendMyAddressConfirmation(
    input: Readonly<{ actorId: string; email: string | null }>,
  ): Promise<void> {
    if (!input.email) throw new NoAddressToConfirmError();

    const budget = await this.isWithinBudget({
      key: `frontDoor.sendMyAddressConfirmation:${input.actorId}`,
      windowSeconds: 60 * 60,
      max: 10,
    });
    if (!budget.allowed) {
      throw new FrontDoorRateLimitedError("Too many attempts. Please try again later.", {
        retryAfterSeconds: budget.retryAfterSeconds,
      });
    }

    await this.requestSignUpVerification({ email: input.email });
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
function buildSignUpVerification({
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

/** The members a cutover is asked about, from the module that owns the rows. */
function legacyAccessMemberships(organizations: OrganizationApi): LegacySsoAccessMemberships {
  return {
    listMemberIds: async ({ organizationId }) => {
      const members = await organizations.getAllMembers({ organizationId });
      return members.map((member) => member.id);
    },
  };
}

/** The provider the retiring connection speaks to, from the module that
 *  registered it: auth is told a connection, never a name it does not own. */
function legacyAccessConnections(identity: IdentityApi): LegacySsoAccessConnections {
  return {
    getProvider: (args) => identity.ssoConnectionReads().getProvider(args),
  };
}

/**
 * Where a lock is appended (GAC-09). An address with no account behind it
 * still gets a row — those are precisely the rows an attack shows up in —
 * and no row ever carries the address or the credential that was tried.
 */
function signInSecurityMembers(organizations: OrganizationApi): SignInSecurityMembers {
  return {
    findMemberUserIds: async ({ organizationId }) =>
      (await organizations.getAllMembers({ organizationId })).map((member) => member.id),
    isMember: (input) => organizations.isMember(input),
  };
}

function signInSecurityPlanGate(entitlements: EntitlementApi): SignInSecurityPlanGate {
  return {
    assertEntitled: async ({ organizationId }) => {
      const plan = await entitlements.getActivePlan({ organizationId });
      if (!isEnterpriseTier(plan.type)) {
        throw new EnterprisePlanRequiredError(SIGN_IN_SECURITY_ENTERPRISE_REFUSAL);
      }
    },
  };
}

function auditedReleaseEvidence(auditLog: AuditLogApi): SignInSecurityReleaseEvidence {
  return {
    released: async ({ organizationId, userId, actorUserId }) => {
      await auditLog.record({
        userId: actorUserId,
        organizationId,
        action: "identity.sign_in.lock_released",
        targetKind: "user",
        targetId: userId,
      });
    },
  };
}

function auditedLockoutEvidence(auditLog: AuditLogApi): SignInLockoutEvidence {
  return {
    locked: async ({ userId, failedCount, consecutiveLockouts, lockedUntil }) => {
      await auditLog.record({
        ...(userId === null ? {} : { userId }),
        action: "identity.sign_in_locked_out",
        metadata: {
          failedCount,
          consecutiveLockouts,
          lockedUntil: lockedUntil.toString(),
          addressHadAccount: userId !== null,
        },
      });
    },
    escalated: async ({ userId, consecutiveLockouts }) => {
      await auditLog.record({
        ...(userId === null ? {} : { userId }),
        action: "identity.sign_in_lockout_escalated",
        metadata: { consecutiveLockouts, addressHadAccount: userId !== null },
      });
    },
  };
}

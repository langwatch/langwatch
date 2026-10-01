import { OrganizationInvalidCredentialsError } from "@langwatch/api";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
/**
 * Auth module application: browser sessions and signed-out door. One application
 * for one person; reaches all state through member dependencies, not ambient.
 */
import {
  AuthApi,
  assertAuthServerConfig,
  cliAccessTokenKey,
  authBrowserConfig,
  authServerConfig,
  AuthUnavailableError,
  FrontDoorRateLimitedError,
  NoAddressToConfirmError,
  type AuthApi as AuthApiContract,
  type AuthServerConfig,
  type BrowserSessionInventoryEntry,
  type BrowserSessionResolution,
  type BrowserSessionVerification,
  type CliAccessSession,
  type CliTokenRecordEntry,
  type InviteLanding,
  type LegacySsoAccessQuery,
  type ReleaseHeldAccountResult,
  type SaveSignInSecurityInput,
  type SaveSignInSecurityResult,
  SIGN_IN_SECURITY_ENTERPRISE_REFUSAL,
  type SignInSecuritySettings,
  type VerifiedBrowserSession,
  type AuthUsageCount,
  type AddressConfirmation,
  type SignUpEnrollment,
  type SignUpVerificationRequest,
  type PriorSession,
  type AuthFederatedPasswordChange,
  type AuthFederatedPasswordOutcome,
} from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { NurturingApi } from "@langwatch/enterprise-nurturing-contract";
import { SsoApi } from "@langwatch/enterprise-sso-contract";
import {
  configuredAuthProvider,
  isNamedProviderMounted,
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
  type EmailIdentifierAdded,
  IdentityApi,
  type IdentityEmailService,
  type RoutingDecision,
  type SignedInWith,
  SignInMethodPolicyService,
} from "@langwatch/identity-contract";
import type { EventingParticipation, FeatureSetup } from "@langwatch/kernel";
import type { MailSender } from "@langwatch/mail";
import { NotificationService } from "@langwatch/notification-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { type MembersRead } from "@langwatch/process-stores/members";
import {
  internalSlackSignupsWebhook,
  Secret,
  sessionSecret,
  signInProviderSecrets,
} from "@langwatch/secrets";
import { nowInstant, type Instant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import { auth0PasswordChannels } from "../channels/auth0-password-channels.registry.ts";
import { cliDeviceSettlementChannels } from "../channels/cli-device-settlement-channels.registry.ts";
import type { BetterAuthTransport } from "../channels/http/http.better-auth.channel.ts";
import { isBornFinalizedSignUp } from "../channels/http/http.born-finalized-opt-in.channel.ts";
import { passwordResetMailChannels } from "../channels/password-reset-mail-channels.registry.ts";
import { signUpVerificationMailChannels } from "../channels/sign-up-verification-mail-channels.registry.ts";
import { signupAnnouncementChannels } from "../channels/signup-announcement-channels.registry.ts";
import {
  type AuthLifecycleDefinition,
  buildAuthLifecyclePipeline,
} from "../eventing/auth-lifecycle.pipeline.ts";
import type { AuthRepositories } from "../repositories/auth.repositories.ts";
import { PrismaAuthDirectoryRepository } from "../repositories/prisma/prisma.auth-directory.repository.ts";
import { PrismaBetterAuthHooksRepository } from "../repositories/prisma/prisma.better-auth-hooks.repository.ts";
import { RedisAuthSessionCacheRepository } from "../repositories/redis/redis.auth-session-cache.repository.ts";
import type { AuthSessionPoll } from "../rules/auth-session-poll.rules.ts";
import { keyedIdentifierHasher } from "../rules/sign-in-identifier-hash.rules.ts";
import { resolveDialableIdentityProviderOrigins } from "../rules/trusted-origins.rules.ts";
import { AddressConfirmationService } from "../services/address-confirmation.service.ts";
import { AuthDoorService } from "../services/auth-door.service.ts";
import {
  AuthLifecycleNoticeService,
  type AuthLifecycleSenders,
} from "../services/auth-lifecycle-notice.service.ts";
import { AuthProviderService } from "../services/auth-provider.service.ts";
import { BrowserSessionService } from "../services/browser-session.service.ts";
import type { CliDeviceApprovalFrame } from "../services/cli-device-approval.service.ts";
import {
  CliDeviceFlowService,
  type CliBrowserSession,
  type CliDeviceCodeLookup,
  type CliDeviceFlowAnswer,
  type CliDeviceFlowCollaborators,
} from "../services/cli-device-flow.service.ts";
import { CliDeviceSessionService } from "../services/cli-device-session.service.ts";
import { FederatedAccountReadsService } from "../services/federated-account-reads.service.ts";
import { FederatedPasswordService } from "../services/federated-password.service.ts";
import {
  LegacySsoAccessService,
  type LegacySsoAccessConnections,
  type LegacySsoAccessMemberships,
} from "../services/legacy-sso-access.service.ts";
import { PriorSessionService } from "../services/prior-session.service.ts";
import { ProjectAuthTokenService } from "../services/project-auth-token.service.ts";
import {
  ProviderAccountLinkService,
  type ProviderAccountRow,
} from "../services/provider-account-link.service.ts";
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
import { SignUpEnrollmentService } from "../services/sign-up-enrollment.service.ts";
import { SignupAnnouncementService } from "../services/signup-announcement.service.ts";
import {
  SignUpVerificationService,
  type SignUpVerificationDeps,
} from "../services/signup-verification.service.ts";
import type { SsoIssuerDirectory } from "../services/sso-registered-issuers.service.ts";
import {
  TwoStepVerificationService,
  type TwoStepProtocol,
} from "../services/two-step-verification.service.ts";
import type { AuthRestFederatedLogout } from "../transport/auth.rest.ts";
import {
  buildBetterAuth,
  passwordResetSender,
  type BetterAuthDeploymentIdentity,
} from "./auth-composition.build.ts";

/**
 * The invitation a landing page reads, and the reissue request behind it. Both
 * run over the organization module's rows, so both arrive from the process.
 */
export interface AuthInviteDirectory {
  readLanding(input: Readonly<{ inviteCode: string }>): Promise<InviteLanding>;
  requestFresh(input: Readonly<{ inviteCode: string }>): Promise<void>;
}

/**
 * The closed members this module reads as a literal, restated as a
 * named tuple so `publicBaseUrl` (a process fact, not one of the fourteen)
 * can be appended to the runtime list below without losing this typing.
 */
const AUTH_CLOSED_READS = [
  "encryption",
  "logger",
  "prisma",
  "redis",
  "rateLimiter",
  "secrets",
] as const;

/**
 * Process-supplied infrastructure. Declared members required at boot;
 * front-door features need identity, organization, and notification peers.
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
    /** The invitation reads, or nothing where this process composed none. */
    invites: AuthInviteDirectory | null;
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

/** The peers the app keeps past construction; identity decides where an address signs in. */
type AuthAppPeers = Readonly<{
  apiKeys: ApiKeyApi;
  featureFlags: FeatureFlagApi;
  identity: Pick<IdentityApi, "routeSignIn" | "sendOwnAddressConfirmation">;
  nurturing: Pick<NurturingApi, "recordSignal">;
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
    /** Whether this installation names a way to send email, before a confirmation is offered. */
    notifications: NotificationService,
    /** The sign-in providers, shaped for Better Auth by enterprise SSO. */
    sso: SsoApi,
    /** Whether a CLI approver may still hand out a shared project's key (`project:manage`). */
    authz: AuthzApi,
    /** Told a person's sessions and domain auto-joins by the worker's subscriber (§9). */
    nurturing: NurturingApi,
  };
  static readonly config = authServerConfig;
  static readonly publicConfig = authBrowserConfig.project;
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
    /** The Auth0 Management app's secret; absent, the login app's stands in, as main's did. */
    auth0ManagementSecret: Secret.load("AUTH0_MGMT_CLIENT_SECRET", { optional: true }),
    /** LangWatch's own sign-ups Slack webhook, shared with organization, billing and identity. */
    internalSlackSignupsWebhook,
  } as const;

  readonly #sessions: BrowserSessionService;
  /** The `/api/auth` door: Better Auth's handshake, the session poll and sign-out. */
  readonly #door: AuthDoorService;
  /** The legacy `X-Auth-Token` check. */
  readonly #projectTokens: ProjectAuthTokenService;
  readonly #cliSessions: CliDeviceSessionService;
  readonly #cliDeviceFlow: CliDeviceFlowService;
  readonly #signUp: SignUpVerificationService | null;
  readonly #members: AuthInfrastructure;
  readonly #dependencies: AuthAppPeers;
  /** The `Account` rows a retiring connection is judged over — auth's own,
   *  swept for a peer that owns none of them (ADR-129). */
  readonly #legacySsoAccess: LegacySsoAccessService;
  /** The provider side of the same rows: which ways in somebody holds. */
  readonly #federatedAccounts: FederatedAccountReadsService;
  /** The administrator's side of the two sign-in security rules. */
  readonly #signInSecurity: SignInSecuritySettingsService;
  /** A confirmed link proposal's provider account, written through Better Auth. */
  readonly #providerAccountLinks: ProviderAccountLinkService;
  /** The methods a proven sign-up address may enrol. */
  readonly #signUpEnrollment: SignUpEnrollmentService;
  /** Whether the caller's own address is confirmed. */
  readonly #addressConfirmation: AddressConfirmationService;
  /** Why a signed-out visitor is here, off their own cookie. */
  readonly #priorSessions: PriorSessionService;
  /** The session factors two-step verification reads, and turning it off. */
  readonly #twoStep: TwoStepVerificationService;
  /** Where a session and a domain auto-join are recorded as auth's events. */
  readonly #lifecycle: AuthLifecycleNoticeService;
  /** This deployment's sign-in mode, set once the provider secrets resolve. */
  #authProviders: AuthProviderService | null = null;
  /** The Auth0 tenant's password change; set once the provider secrets resolve. */
  #federatedPasswords: FederatedPasswordService | null = null;
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
    cliDeviceFlow,
    signUp,
    members,
    dependencies,
    legacySsoAccess,
    federatedAccounts,
    signInSecurity,
    connectionIssuers,
    signUpEnrollment,
    addressConfirmation,
    priorSessions,
    twoStep,
  }: {
    sessions: BrowserSessionService;
    cliSessions: CliDeviceSessionService;
    cliDeviceFlow: Omit<CliDeviceFlowCollaborators, "session">;
    signUp: SignUpVerificationService | null;
    members: AuthInfrastructure;
    dependencies: AuthAppPeers;
    legacySsoAccess: LegacySsoAccessService;
    federatedAccounts: FederatedAccountReadsService;
    signInSecurity: SignInSecuritySettingsService;
    connectionIssuers: Pick<SsoIssuerDirectory, "findIssuersForConnection">;
    signUpEnrollment: SignUpEnrollmentService;
    addressConfirmation: AddressConfirmationService;
    priorSessions: PriorSessionService;
    twoStep: TwoStepVerificationService;
  }) {
    this.#sessions = sessions;
    this.#cliSessions = cliSessions;
    this.#cliDeviceFlow = CliDeviceFlowService.create({
      collaborators: { ...cliDeviceFlow, session: (headers) => this.#cliBrowserSession(headers) },
    });
    this.#signUp = signUp;
    this.#members = members;
    this.#dependencies = dependencies;
    this.#legacySsoAccess = legacySsoAccess;
    this.#federatedAccounts = federatedAccounts;
    this.#signInSecurity = signInSecurity;
    this.#signUpEnrollment = signUpEnrollment;
    this.#addressConfirmation = addressConfirmation;
    this.#priorSessions = priorSessions;
    this.#twoStep = twoStep;
    this.#lifecycle = AuthLifecycleNoticeService.create({
      reportError: (error) =>
        members.logger.error({ error }, "a sign-in milestone was not recorded for nurturing"),
    });
    this.#providerAccountLinks = ProviderAccountLinkService.create({
      issuers: connectionIssuers,
      accounts: { createAccount: (row) => this.#createProviderAccount(row) },
    });
    this.#projectTokens = ProjectAuthTokenService.create({
      apiKeys: dependencies.apiKeys,
      rateLimiter: members.rateLimiter,
    });
    this.#door = AuthDoorService.create({
      betterAuth: () => this.betterAuth(),
      isBornFinalizedSignUp: (request) =>
        isBornFinalizedSignUp({
          featureFlags: dependencies.featureFlags,
          directory: PrismaAuthDirectoryRepository.create(members.prisma),
          request,
        }),
      baseUrl: () => this.baseUrl(),
      runWithIdentityBirth: (run) => this.runWithIdentityBirth(run),
      verifyBrowserSession: (input) => this.verifyBrowserSession(input),
      resolveBrowserSession: (input) => this.resolveBrowserSession(input),
      revokeBrowserSession: (input) => this.revokeBrowserSession(input),
    });
  }

  static async create(setup: AuthSetup): Promise<AuthApp> {
    const { members, repositories, dependencies, config } = setup;
    /** Every mail auth sends goes out through notification, which owns the gateway. */
    const mailer: MailSender = { send: (content) => dependencies.notifications.sendEmail(content) };
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

    const cliSessions = CliDeviceSessionService.create({
      store: repositories.cliSessions,
      settlements: members.redis
        ? cliDeviceSettlementChannels.live.create(members.redis)
        : cliDeviceSettlementChannels.memory.create(),
    });

    const app = new AuthApp({
      sessions,
      cliSessions,
      cliDeviceFlow: {
        sessions: () => cliSessions,
        directory: () => PrismaAuthDirectoryRepository.create(members.prisma),
        apiKeys: () => dependencies.apiKeys,
        ensurePersonalWorkspace: (input) => dependencies.users.ensurePersonalWorkspace(input),
        canManageProject: ({ userId, projectId }) =>
          dependencies.authz.hasProjectPermission({
            userId,
            projectId,
            permission: "project:manage",
          }),
        featureFlags: () => dependencies.featureFlags,
        publicBaseUrl: () => members.publicBaseUrl,
      },
      signUp: buildSignUpVerification({
        members,
        mailer,
        repositories,
        now,
        users: dependencies.users,
        route: (input) => dependencies.identity.routeSignIn(input),
        isWithinBudget: (input) => app.isWithinBudget(input),
        isEmailUnconfigured: async () => {
          const view = await dependencies.notifications.getMailDelivery();
          return view.provider === undefined && !view.misconfigured;
        },
      }),
      members,
      dependencies: {
        apiKeys: dependencies.apiKeys,
        featureFlags: dependencies.featureFlags,
        identity: dependencies.identity,
        nurturing: dependencies.nurturing,
      },
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
      connectionIssuers: {
        findIssuersForConnection: (args) =>
          dependencies.identity.ssoIssuers().findIssuersForConnection(args),
      },
      signUpEnrollment: SignUpEnrollmentService.create({
        validateAddressProof: (input) => app.requireSignUp().validateAddressProof(input),
        validateUnconfirmedAddressProof: (input) =>
          app.requireSignUp().validateUnconfirmedAddressProof(input),
        route: (input) => app.route(input),
        addressIsTaken: async ({ email }) =>
          (await dependencies.users.findByEmail({ email })) !== null,
        resolveDefaultMethods: async () => {
          const policy = await SignInMethodPolicyService.create({
            resolveAuthProvider: () => app.resolveAuthProvider(),
            federationLicensed: () => dependencies.licensing.isPlatformSsoLicensed(),
            offersPasskeys: () => config.passkeysEnabled,
            issuesOwnPasswords: () => config.localPasswords,
            selfHosted: () => !members.isSaas,
          }).resolvePolicy();
          return policy.defaultMethods;
        },
        passwordIsAllowed: async () =>
          (await app.resolveAuthProvider()) === "email" || config.localPasswords,
      }),
      addressConfirmation: AddressConfirmationService.create({
        isConfirmed: async ({ email }) =>
          (await dependencies.users.findByEmail({ email }))?.emailVerified === true,
        hasMailDelivery: async () =>
          (await dependencies.notifications.getMailDelivery()).provider !== undefined,
      }),
      priorSessions: PriorSessionService.create({
        sessions: repositories.sessions,
        findEmail: async ({ userId }) =>
          (await dependencies.users.findById({ id: userId }))?.email ?? null,
        now,
      }),
      twoStep: TwoStepVerificationService.create({
        sessions: repositories.sessions,
        protocol: betterAuthTwoStepProtocol(() => app.betterAuth()),
        now,
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
    const auth0ManagementSecret = await setup.secrets.into(
      AuthApp.secrets.auth0ManagementSecret,
      (value) => value,
    );
    app.#federatedPasswords = FederatedPasswordService.create({
      accounts: accountRows,
      auth0: auth0PasswordChannels.http.create({
        issuer: config.signInProviders.auth0Issuer,
        mgmtClientId: config.auth0ManagementClientId ?? config.signInProviders.auth0ClientId,
        mgmtClientSecret: auth0ManagementSecret ?? signInProviders.auth0ClientSecret,
      }),
    });
    app.#authProviders = AuthProviderService.create({
      configuredProvider: configuredAuthProvider(config.signInProviders).provider,
      providerMounted: isNamedProviderMounted(signInProviders),
      platformSsoAllowed: () => dependencies.licensing.isPlatformSsoLicensed(),
    });

    const signupAnnouncements = await setup.secrets.into(
      AuthApp.secrets.internalSlackSignupsWebhook,
      (webhookUrl) =>
        SignupAnnouncementService.create({
          channel: webhookUrl ? signupAnnouncementChannels.live.create({ webhookUrl }) : undefined,
          publicBaseUrl: members.publicBaseUrl,
          logger: members.logger,
        }),
    );

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
            signupAnnouncements,
            lifecycle: app.#lifecycle,
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
            signUpProofs: app.#signUp,
            prisma: members.prisma,
            encryption: members.encryption,
            redis: members.redis,
            auth: app,
            grants: dependencies.authz,
            organizations: dependencies.organizations,
            sendResetPassword: passwordResetSender({
              mail: passwordResetMailChannels.ses.create({ mailer }),
              publicBaseUrl: members.publicBaseUrl,
              processName: members.processName,
            }),
            users: dependencies.users,
            identityApi: dependencies.identity,
            signInRouting: (input) => dependencies.identity.routeSignIn(input),
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

  lifecyclePipeline({
    participation,
  }: {
    participation: EventingParticipation;
  }): AuthLifecycleDefinition {
    if (participation === "produce") return buildAuthLifecyclePipeline({});
    return buildAuthLifecyclePipeline({ nurturing: this.#dependencies.nurturing });
  }

  connectLifecycle(senders: AuthLifecycleSenders): void {
    this.#lifecycle.connect(senders);
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

  changeFederatedPassword(
    input: AuthFederatedPasswordChange,
  ): Promise<AuthFederatedPasswordOutcome> {
    const federatedPasswords = this.#federatedPasswords;
    if (!federatedPasswords) {
      throw new AuthUnavailableError({
        capability: "identity-provider password change",
        processName: this.#members.processName,
      });
    }
    return federatedPasswords.changePassword(input);
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
  async verifyBrowserSession(input: { headers: Headers }): Promise<BrowserSessionVerification> {
    if (!this.#composeBetterAuth) return { kind: "anonymous" };

    const verified = (await (
      await this.betterAuth()
    ).api.getSession({
      headers: input.headers,
    })) as VerifiedBrowserSession | null;

    return verified === null ? { kind: "anonymous" } : { kind: "verified", verified };
  }

  getSessionByCookie(input: { cookie: string | undefined }): Promise<AuthSessionPoll> {
    return this.#door.getSessionByCookie(input);
  }

  revokeSessionFromCookies(input: { cookie: string | undefined }): Promise<void> {
    return this.#door.revokeSessionFromCookies(input);
  }

  betterAuthHandshake(request: Request): Promise<Response> {
    return this.#door.betterAuthHandshake(request);
  }

  validateProjectAuthToken(input: {
    token: string | undefined;
    forwardedFor: string | undefined;
  }): Promise<{ projectSlug: string }> {
    return this.#projectTokens.validateProjectAuthToken(input);
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
          "identity birth context (@langwatch/identity-process publishes no BetterAuthIdentityBirthService), so it cannot run a born-finalized sign-up",
        processName: this.#members.processName,
      }),
    );
  }

  resolveBrowserSession(input: {
    verified: VerifiedBrowserSession;
  }): Promise<BrowserSessionResolution> {
    return this.#sessions.resolveBrowserSession(input);
  }

  async getCliAccessSession(input: {
    authorization: string;
  }): Promise<CliAccessSession & Readonly<{ tokenKey: string }>> {
    const token = CliDeviceSessionService.extractBearerCliAccessToken(input.authorization);
    const record = await this.#cliSessions
      .getAccessToken(input.authorization)
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "cli_session_record_not_found") {
          throw new OrganizationInvalidCredentialsError();
        }
        throw error;
      });
    if (token === null) throw new OrganizationInvalidCredentialsError();

    return {
      userId: record.user_id,
      organizationId: record.organization_id,
      tokenKey: cliAccessTokenKey(token),
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

  startCliDeviceCode(input: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return this.#cliDeviceFlow.startDeviceCode(input);
  }

  exchangeCliDeviceCode(input: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return this.#cliDeviceFlow.exchangeDeviceCode(input);
  }

  refreshCliDeviceSession(input: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return this.#cliDeviceFlow.refreshSession(input);
  }

  lookupCliDeviceCode(input: CliDeviceCodeLookup): Promise<CliDeviceFlowAnswer> {
    return this.#cliDeviceFlow.lookupDeviceCode(input);
  }

  approveCliDeviceCode(input: { raw: string; headers: Headers }): Promise<CliDeviceFlowAnswer> {
    return this.#cliDeviceFlow.approveDeviceCode(input);
  }

  denyCliDeviceCode(input: { raw: string; headers: Headers }): Promise<CliDeviceFlowAnswer> {
    return this.#cliDeviceFlow.denyDeviceCode(input);
  }

  endCliDeviceSession(input: { raw: string }): Promise<CliDeviceFlowAnswer> {
    return this.#cliDeviceFlow.endSession(input);
  }

  watchCliDeviceApproval(input: {
    deviceCode: string;
    signal: AbortSignal | undefined;
  }): Promise<AsyncIterable<CliDeviceApprovalFrame>> {
    return this.#cliDeviceFlow.watchDeviceApproval(input);
  }

  /** The person a browser cookie names, for the approval page's three routes. */
  async #cliBrowserSession(headers: Headers): Promise<CliBrowserSession | null> {
    const verification = await this.verifyBrowserSession({ headers });
    if (verification.kind === "anonymous") return null;
    const resolution = await this.resolveBrowserSession({ verified: verification.verified });

    return resolution.kind === "signed_in" ? resolution.session.user : null;
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

  async countUsageForMembers({
    memberUserIds,
    at,
  }: {
    memberUserIds: readonly string[];
    at: number;
  }): Promise<AuthUsageCount> {
    return {
      signedInUsers: await this.#sessions.countSignedInUsersAmong({ userIds: memberUserIds, at }),
    };
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

  endBrowserSessionsForIdentifier(input: {
    userId: string;
    identifierId: string;
  }): Promise<{ ended: number }> {
    return this.#sessions.endBrowserSessionsForIdentifier(input);
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
    return this.#dependencies.identity.routeSignIn(input);
  }

  async addressIsRegistered(input: Readonly<{ email: string }>): Promise<boolean> {
    return this.requireSignUp().addressIsRegistered(input);
  }

  async assertSignUpOrigin(
    input: Readonly<{ origin: string | null; referer: string | null }>,
  ): Promise<void> {
    this.#door.assertSignUpOrigin(input);
  }

  async requestSignUpVerification(input: Readonly<{ email: string }>): Promise<void> {
    return this.requireSignUp().requestVerification(input);
  }

  async requestNewAccountVerification(
    input: Readonly<{ email: string }>,
  ): Promise<SignUpVerificationRequest> {
    return this.requireSignUp().requestNewAccountVerification(input);
  }

  /** Metered on the caller rather than the address, like the token check's own probe. */
  async sendMyAddressConfirmation(
    input: Readonly<{ actorId: string; email: string | null; codeChallenge: string }>,
  ): Promise<EmailIdentifierAdded> {
    if (!input.email) throw new NoAddressToConfirmError();
    await this.#addressConfirmation.assertCanSend();

    const budget = await this.isWithinBudget({
      key: `auth.sendMyAddressConfirmation:${input.actorId}`,
      windowSeconds: 60 * 60,
      max: 10,
    });
    if (!budget.allowed) {
      throw new FrontDoorRateLimitedError("Too many attempts. Please try again later.", {
        retryAfterSeconds: budget.retryAfterSeconds,
      });
    }

    return this.#dependencies.identity.sendOwnAddressConfirmation({
      userId: input.actorId,
      email: input.email,
      codeChallenge: input.codeChallenge,
    });
  }

  getMyAddressConfirmation(
    input: Readonly<{ email: string | null }>,
  ): Promise<AddressConfirmation> {
    return this.#addressConfirmation.getForCaller(input);
  }

  getSignUpEnrollment(
    input: Readonly<{ email: string; addressProof: string }>,
  ): Promise<SignUpEnrollment> {
    return this.#signUpEnrollment.getEnrollment(input);
  }

  getPriorSession(input: Readonly<{ headers: Headers }>): Promise<PriorSession> {
    return this.#priorSessions.explain(input);
  }

  findSessionAmr(input: { sessionId: string }): Promise<string[]> {
    return this.#twoStep.findSessionAmr(input);
  }

  findAssertedAmrForIdentifiers(input: {
    userIds: readonly string[];
    identifierIds: readonly string[];
  }): Promise<string[]> {
    return this.#twoStep.findAssertedAmr(input);
  }

  disableTwoStepVerification(input: {
    headers: Headers;
    password?: string | undefined;
    code: string;
  }): Promise<void> {
    return this.#twoStep.disable(input);
  }

  async claimSignUpAddressProof(
    input: Readonly<{ token: string; email: string }>,
  ): Promise<boolean> {
    return this.requireSignUp().claimAddressProof(input);
  }

  async claimUnconfirmedSignUpAddressProof(
    input: Readonly<{ token: string; email: string }>,
  ): Promise<boolean> {
    return this.requireSignUp().claimUnconfirmedAddressProof(input);
  }

  linkProviderAccount(
    input: Readonly<{
      userId: string;
      connectionId: string | null;
      provider: string;
      subject: string;
      normalizedEmail: string;
    }>,
  ): Promise<void> {
    return this.#providerAccountLinks.link(input);
  }

  async #createProviderAccount(row: ProviderAccountRow): Promise<void> {
    const context = await (await this.betterAuth()).$context;
    await context.internalAdapter.createAccount(row);
  }

  async readInviteLanding(input: Readonly<{ inviteCode: string }>): Promise<InviteLanding> {
    return this.requireInvites().readLanding(input);
  }

  async requestFreshInvite(input: Readonly<{ inviteCode: string }>): Promise<void> {
    return this.requireInvites().requestFresh(input);
  }

  resolveAuthProvider(): Promise<string> {
    const authProviders = this.#authProviders;
    if (!authProviders) {
      throw new AuthUnavailableError({
        capability: "sign-in mode configuration, so it cannot name this deployment's auth provider",
        processName: this.#members.processName,
      });
    }
    return authProviders.resolve();
  }

  /** The ceremony, or the refusal that names why this process has none. */
  private requireSignUp(): SignUpVerificationService {
    if (!this.#signUp) {
      throw new AuthUnavailableError({
        capability: "public base URL, so it cannot build a sign-up confirmation link",
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

/** The ceremony this process can run, or nothing where it has no public base URL to link to. */
function buildSignUpVerification({
  members,
  mailer,
  repositories,
  now,
  users,
  route,
  isWithinBudget,
  isEmailUnconfigured,
}: {
  members: AuthInfrastructure;
  mailer: MailSender;
  repositories: AuthRepositories;
  now: () => Instant;
  users: UserApi;
  route: SignUpVerificationDeps["route"];
  isWithinBudget: SignUpVerificationDeps["isWithinBudget"];
  isEmailUnconfigured: SignUpVerificationDeps["isEmailUnconfigured"];
}): SignUpVerificationService | null {
  const baseUrl = members.publicBaseUrl;
  if (!baseUrl) return null;

  return SignUpVerificationService.create({
    tokens: repositories.signUpTokens,
    mailer: signUpVerificationMailChannels.ses.create({ mailer }),
    users,
    route,
    isWithinBudget,
    buildVerificationUrl: ({ token }) =>
      `${baseUrl}/auth/signup?verify=${encodeURIComponent(token)}`,
    isEmailUnconfigured,
    now,
  });
}

/** The two-factor plugin on the deployment's one Better Auth instance (main's protocol adapter). */
function betterAuthTwoStepProtocol(
  betterAuth: () => Promise<BetterAuthTransport>,
): TwoStepProtocol {
  return {
    verifyTotp: async ({ headers, code }) => {
      await (await betterAuth()).api.verifyTOTP({ body: { code }, headers });
    },
    disableTwoFactor: async ({ headers, password }) => {
      await (
        await betterAuth()
      ).api.disableTwoFactor({
        body: password ? { password } : {},
        headers,
      });
    },
  };
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

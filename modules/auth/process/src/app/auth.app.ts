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
  type CliSessionTokens,
  type CliTokenRecordEntry,
  type InviteLanding,
  type LegacySsoAccessQuery,
  type ReleaseHeldAccountResult,
  type SaveSignInSecurityInput,
  type SaveSignInSecurityResult,
  type SessionImpersonation,
  type SessionImpersonationState,
  type SignInSecuritySettings,
  type VerifiedBrowserSession,
  type AuthUsageCount,
  type AddressConfirmation,
  type SignUpEnrollment,
  type SignUpVerificationRequest,
  type PriorSession,
  type AuthFederatedPasswordChange,
  type AuthFederatedPasswordOutcome,
  isEmailPasswordEnabled,
} from "@langwatch/auth-contract";
import { AuthzApi, type AuthzGrantsService } from "@langwatch/authz-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { SsoApi } from "@langwatch/enterprise-sso-contract";
import {
  configuredAuthProvider,
  isNamedProviderMounted,
  resolveSignInProviders,
  type SignInProviderConfiguration,
} from "@langwatch/enterprise-sso-contract/sign-in-providers";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  type EmailIdentifierAdded,
  IdentityApi,
  organizationConnectionsOf,
  type RoutingDecision,
  type SignedInWith,
  type SignInMethod,
  SignInMethodPolicyService,
  type SignInMethodPolicy,
  type SsoArrivalAdmission,
  type SsoArrivalApi,
} from "@langwatch/identity-contract";
import type { MailSender } from "@langwatch/mail";
import { NotificationService } from "@langwatch/notification-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import {
  internalSlackSignupsWebhook,
  Secret,
  sessionSecret,
  signInProviderSecrets,
} from "@langwatch/secrets";
import { nowInstant, type Instant } from "@langwatch/time";
import {
  UserApi,
  type ChangeOwnPasswordInput,
  type SetOwnFirstPasswordInput,
  type CreatedUser,
  type RegisterCredentialAccountInput,
  type UpdateUserEmailInput,
  type UserCaller,
  type UserLifecycleChangeInput,
  type UserProfile,
} from "@langwatch/user-contract";

import type { AuthChannels } from "../channels/auth.channels.ts";
import { auth0PasswordChannels } from "../channels/auth0-password-channels.registry.ts";
import {
  BetterAuthAnnouncements,
  BetterAuthFederation,
  BetterAuthIdentityCeremonies,
  type BetterAuthAccountPin,
  type BetterAuthAccountRow,
} from "../channels/better-auth.channel.ts";
import {
  createBetterAuthTransport,
  type BetterAuthTransport,
  type SignInAttemptCounter,
} from "../channels/http/http.better-auth.channel.ts";
import { CredentialSessionGuard } from "../channels/http/http.credential-session-guard.channel.ts";
import { IdTokenIssuerRefusalChannel } from "../channels/http/http.id-token-issuer-refusal.channel.ts";
import { OAuthProfileEmailChannel } from "../channels/http/http.oauth-profile-email.channel.ts";
import {
  type PasskeySignUpEligibility,
  type SignUpVerification,
} from "../channels/http/http.passkey-sign-up.channel.ts";
import { SignInRouterShadow } from "../channels/http/http.sign-in-router-shadow.channel.ts";
import { type SignUpAddressConfirmation } from "../channels/http/http.sign-up-confirmation.channel.ts";
import { passwordResetMailChannels } from "../channels/password-reset-mail-channels.registry.ts";
import type { PasswordResetMailChannel } from "../channels/password-reset-mail.channel.ts";
import { signUpVerificationMailChannels } from "../channels/sign-up-verification-mail-channels.registry.ts";
import { signupAnnouncementChannels } from "../channels/signup-announcement-channels.registry.ts";
import {
  type AuthLifecycleDefinition,
  buildAuthLifecyclePipeline,
} from "../eventing/auth-lifecycle.pipeline.ts";
import type { AuthRateLimitRepository } from "../repositories/auth-rate-limit.repository.ts";
import type { AuthRepositories } from "../repositories/auth.repositories.ts";
import type { AuthSessionPoll } from "../rules/auth-session-poll.rules.ts";
import { mountedSocialMethodIds } from "../rules/mounted-social-methods.rules.ts";
import { queryCacheKeyDeriver } from "../rules/query-cache-key.rules.ts";
import { keyedIdentifierHasher } from "../rules/sign-in-identifier-hash.rules.ts";
import { buildSignUpVerificationUrl } from "../rules/signup-verification-link.rules.ts";
import { resolveDialableIdentityProviderOrigins } from "../rules/trusted-origins.rules.ts";
import { AccountLifecycleService } from "../services/account-lifecycle.service.ts";
import { AddressConfirmationService } from "../services/address-confirmation.service.ts";
import type { CliAccessProject } from "../services/api-rest-credentials.service.ts";
import { AuthDoorService } from "../services/auth-door.service.ts";
import {
  AuthLifecycleNoticeService,
  type AuthLifecycleSenders,
} from "../services/auth-lifecycle-notice.service.ts";
import { AuthProviderService } from "../services/auth-provider.service.ts";
import { BrowserSessionService } from "../services/browser-session.service.ts";
import type { CliDeviceApprovalFrame } from "../services/cli-device-approval.service.ts";
import { CliDeviceDirectoryService } from "../services/cli-device-directory.service.ts";
import {
  CliDeviceFlowService,
  type CliBrowserSession,
  type CliDeviceCodeLookup,
  type CliDeviceFlowAnswer,
  type CliDeviceFlowCollaborators,
} from "../services/cli-device-flow.service.ts";
import { CliDeviceSessionService } from "../services/cli-device-session.service.ts";
import { CredentialRegistrationService } from "../services/credential-registration.service.ts";
import { CredentialSignInPolicyService } from "../services/credential-sign-in-policy.service.ts";
import { FederatedAccountReadsService } from "../services/federated-account-reads.service.ts";
import { FederatedPasswordService } from "../services/federated-password.service.ts";
import {
  LegacySsoAccessService,
  type LegacySsoAccessConnections,
  type LegacySsoAccessMemberships,
} from "../services/legacy-sso-access.service.ts";
import { OwnPasswordService } from "../services/own-password.service.ts";
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
  type SignInSecurityReleaseEvidence,
} from "../services/sign-in-security-settings.service.ts";
import { SignUpEnrollmentService } from "../services/sign-up-enrollment.service.ts";
import { SignupAnnouncementService } from "../services/signup-announcement.service.ts";
import {
  SignUpVerificationService,
  type SignUpVerificationDeps,
} from "../services/signup-verification.service.ts";
import type { SsoIssuerDirectory } from "../services/sso-registered-issuers.service.ts";
import { SsoRegisteredIssuersService } from "../services/sso-registered-issuers.service.ts";
import {
  TwoStepVerificationService,
  type TwoStepProtocol,
} from "../services/two-step-verification.service.ts";
import type { AuthRestFederatedLogout } from "../transport/auth.rest.ts";

const logger = createLogger("langwatch:auth");

/** The peers the app keeps past construction; identity decides where an address signs in. */
type AuthAppPeers = Readonly<{
  apiKeys: ApiKeyApi;
  featureFlags: FeatureFlagApi;
  identity: Pick<IdentityApi, "routeSignIn" | "sendOwnAddressConfirmation">;
  /** Whether the installation's sign-up policy admits an address, before its proof is spent. */
  organizations: Pick<OrganizationApi, "checkSignUp">;
  /** The account writes auth's lifecycle doors run before ending credentials. */
  users: Pick<
    UserApi,
    | "findById"
    | "updateEmail"
    | "deactivate"
    | "recordDeactivated"
    | "isOperator"
    | "hasPassword"
    | "setFirstPassword"
    | "rotatePassword"
    | "registerCredentialAccount"
  >;
}>;

type AuthSetup = FeatureSetup<
  typeof AuthModule.dependencies,
  AuthServerConfig,
  AuthRepositories,
  AuthChannels
>;

export class AuthModule implements AuthApiContract {
  /**
   * Main's reset mail: the link lands on this deployment's own reset page. With
   * no public base URL there is no page to root it at, so it refuses by name: a
   * reset link nobody can open is worse than a refusal an operator can read.
   */
  static passwordResetSender(input: {
    mail: PasswordResetMailChannel;
    publicBaseUrl: string | undefined;
    processName: string;
  }): (reset: { email: string; token: string }) => Promise<void> {
    const { mail, publicBaseUrl, processName } = input;
    if (!publicBaseUrl) {
      const capability = "public base URL to root a password-reset link at";

      return () => Promise.reject(new AuthUnavailableError({ capability, processName }));
    }

    return ({ email, token }) =>
      mail.sendResetLink({
        email,
        resetUrl: `${publicBaseUrl}/auth/reset-password?token=${encodeURIComponent(token)}`,
      });
  }

  static readonly contract = AuthApi;
  static readonly dependencies = {
    users: UserApi,
    /** The credential ledger the legacy `X-Auth-Token` check resolves through. */
    apiKeys: ApiKeyApi,
    /** This deployment's flag store. */
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
    /** Whether a CLI person may bind a session to a project (`project:view`). */
    authz: AuthzApi,
    /** The live project a CLI device grant binds a session to. */
    projects: ProjectApi,
  };
  static readonly config = authServerConfig;
  static readonly publicConfig = authBrowserConfig.project;
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
  /** Names this process in every refusal below: its role, where the container installed it. */
  readonly #processName: string;
  /** The counters the token check and the sign-in door meter through. */
  readonly #rateLimits: AuthRateLimitRepository;
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
  /** The account writes that end credentials: deactivation and an address change. */
  readonly #accounts: AccountLifecycleService;
  readonly #ownPasswords: OwnPasswordService;
  readonly #registrations: CredentialRegistrationService;
  /** This deployment's sign-in mode, set once the provider secrets resolve. */
  #authProviders: AuthProviderService | null = null;
  /** The Auth0 tenant's password change; set once the provider secrets resolve. */
  #federatedPasswords: FederatedPasswordService | null = null;
  /**
   * Composes the deployment's ONE Better Auth instance on first use (it asks
   * the SSO peer, which construction may not), or nothing where it named no
   * browser-session identity. Every caller shares {@link AuthModule.#betterAuth}.
   */
  #composeBetterAuth: (() => Promise<BetterAuthTransport>) | null = null;
  /** Shared by the Better Auth logger and the door, per request. */
  #idTokenIssuerRefusals = IdTokenIssuerRefusalChannel.create();
  /** Shared by the providers' profile mapping and the door, per request. */
  #oauthProfileEmails = OAuthProfileEmailChannel.create();
  #betterAuth: Promise<BetterAuthTransport> | null = null;
  /** The identity {@link AuthModule.create} resolved, held for {@link baseUrl}. */
  #browserSession: BetterAuthDeploymentIdentity | undefined;
  /** Refuses until {@link AuthModule.create} resolves the session secret it is derived from. */
  #deriveQueryCacheKey = queryCacheKeyDeriver({ secret: undefined });

  /** This deployment's answer to {@link AuthModule.offersPasskeys}. */
  #offersPasskeys = false;

  offersPasskeys(): boolean {
    return this.#offersPasskeys;
  }

  /** This deployment's answer to {@link AuthModule.offersTwoStepVerification}. */
  #offersTwoStepVerification = false;

  offersTwoStepVerification(): boolean {
    return this.#offersTwoStepVerification;
  }

  getSignedInWith(input: { userId: string; sessionId: string }): Promise<SignedInWith> {
    return this.#sessions.getSignedInWith(input);
  }

  /** This deployment's answer to {@link AuthModule.issuesOwnPasswords} (D09). */
  #issuesOwnPasswords = false;

  issuesOwnPasswords(): boolean {
    return this.#issuesOwnPasswords;
  }

  /** The social providers this deployment mounted, by the id the rail dials; set at boot. */
  #mountedSocialMethodIds: readonly string[] = [];

  /** This deployment's answer to {@link AuthModule.findDialableIdentityProviderOrigins}. */
  #dialableIdentityProviderOrigins: string[] = [];

  findDialableIdentityProviderOrigins(): string[] {
    return [...this.#dialableIdentityProviderOrigins];
  }

  findMountedSocialMethodIds(): string[] {
    return [...this.#mountedSocialMethodIds];
  }

  getImpersonation(input: { sessionId: string }): Promise<SessionImpersonationState> {
    return this.#sessions.getImpersonation(input);
  }

  startImpersonation(
    input: SessionImpersonation & { sessionId: string; reason: string },
  ): Promise<void> {
    return this.#sessions.startImpersonation(input);
  }

  stopImpersonation(input: { sessionId: string }): Promise<void> {
    return this.#sessions.stopImpersonation(input);
  }

  private constructor({
    sessions,
    cliSessions,
    cliDeviceFlow,
    signUp,
    processName,
    rateLimits,
    dependencies,
    legacySsoAccess,
    federatedAccounts,
    signInSecurity,
    connectionIssuers,
    signUpEnrollment,
    resolveDefaultMethods,
    addressConfirmation,
    priorSessions,
    twoStep,
  }: {
    sessions: BrowserSessionService;
    cliSessions: CliDeviceSessionService;
    cliDeviceFlow: Omit<CliDeviceFlowCollaborators, "session">;
    signUp: SignUpVerificationService | null;
    processName: string;
    rateLimits: AuthRateLimitRepository;
    dependencies: AuthAppPeers;
    legacySsoAccess: LegacySsoAccessService;
    federatedAccounts: FederatedAccountReadsService;
    signInSecurity: SignInSecuritySettingsService;
    connectionIssuers: Pick<SsoIssuerDirectory, "findIssuersForConnection">;
    signUpEnrollment: SignUpEnrollmentService;
    resolveDefaultMethods: () => Promise<readonly SignInMethod[]>;
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
    this.#processName = processName;
    this.#rateLimits = rateLimits;
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
        logger.error({ error }, "a sign-in milestone was not recorded for nurturing"),
    });
    this.#accounts = AccountLifecycleService.create({
      users: dependencies.users,
      credentials: {
        revokeAllBrowserSessions: (input) => this.revokeAllBrowserSessions(input),
        revokeCliTokens: (input) => this.revokeCliTokens(input),
      },
    });
    this.#ownPasswords = OwnPasswordService.create({
      users: dependencies.users,
      auth: this,
      issuesOwnPasswords: () => this.#issuesOwnPasswords,
    });
    this.#registrations = CredentialRegistrationService.create({
      users: dependencies.users,
      organizations: dependencies.organizations,
      auth: this,
      issuesOwnPasswords: () => this.#issuesOwnPasswords,
      resolveDefaultMethods,
    });
    this.#providerAccountLinks = ProviderAccountLinkService.create({
      issuers: connectionIssuers,
      accounts: { createAccount: (row) => this.#createProviderAccount(row) },
    });
    this.#projectTokens = ProjectAuthTokenService.create({
      apiKeys: dependencies.apiKeys,
      rateLimiter: rateLimits,
    });
    this.#door = AuthDoorService.create({
      betterAuth: () => this.betterAuth(),
      baseUrl: () => this.baseUrl(),
      verifyBrowserSession: (input) => this.verifyBrowserSession(input),
      resolveBrowserSession: (input) => this.resolveBrowserSession(input),
      revokeBrowserSession: (input) => this.revokeBrowserSession(input),
      idTokenIssuerRefusals: this.#idTokenIssuerRefusals,
      connectionIssuers,
      oauthProfileEmails: this.#oauthProfileEmails,
      governingConnections: {
        findGoverningConnections: async ({ email }) =>
          organizationConnectionsOf(
            await dependencies.identity.routeSignIn({ identifier: email, breakGlass: false }),
          ),
      },
      deriveQueryCacheKey: (input) => this.#deriveQueryCacheKey(input),
      now: nowInstant,
    });
  }

  static async create(setup: AuthSetup): Promise<AuthModule> {
    const { repositories, channels, dependencies, config } = setup;
    const processName = setup.role ?? "this process";
    /** Every mail auth sends goes out through notification, which owns the gateway. */
    const mailer: MailSender = { send: (content) => dependencies.notifications.sendEmail(content) };
    const now = nowInstant;
    const accountRows = repositories.betterAuthHooks;

    const sessions = BrowserSessionService.create({
      sessions: repositories.sessions,
      cache: repositories.sessionCache,
      identityEmails: dependencies.identity,
      users: dependencies.users,
      sessionBound: SessionBoundService.create({
        organizations: dependencies.organizations,
        activity: repositories.sessions,
        now,
      }),
      now,
    });

    const cliSessions = CliDeviceSessionService.create({
      store: repositories.cliSessions,
      settlements: channels.cliSettlements,
    });

    const cliDeviceDirectory = CliDeviceDirectoryService.create({
      people: repositories.directory,
      organizations: dependencies.organizations,
      projects: dependencies.projects,
    });

    /** The deployment's default sign-in methods, asked by enrollment and by the register door. */
    const resolveDefaultMethods = async () => {
      const policy = await SignInMethodPolicyService.create({
        resolveAuthProvider: () => app.resolveAuthProvider(),
        federationLicensed: () => dependencies.licensing.isPlatformSsoLicensed(),
        offersPasskeys: () => config.passkeysEnabled,
        issuesOwnPasswords: () => config.localPasswords,
        selfHosted: () => !config.isSaas,
        mountedSocialMethodIds: () => app.#mountedSocialMethodIds,
      }).resolvePolicy();
      return policy.defaultMethods;
    };

    const app = new AuthModule({
      sessions,
      cliSessions,
      cliDeviceFlow: {
        sessions: () => cliSessions,
        directory: () => cliDeviceDirectory,
        apiKeys: () => dependencies.apiKeys,
        ensurePersonalWorkspace: (input) => dependencies.users.ensurePersonalWorkspace(input),
        canViewProject: ({ userId, projectId }) =>
          dependencies.authz.hasProjectPermission({
            userId,
            projectId,
            permission: "project:view",
          }),
        featureFlags: () => dependencies.featureFlags,
        publicBaseUrl: () => config.publicBaseUrl,
      },
      signUp: buildSignUpVerification({
        publicBaseUrl: config.publicBaseUrl,
        mailer,
        repositories,
        now,
        users: dependencies.users,
        route: (input) => dependencies.identity.routeSignIn(input),
        checkSignUp: (input) => dependencies.organizations.checkSignUp(input),
        isWithinBudget: (input) => app.isWithinBudget(input),
        revokeAllBrowserSessions: (input) => app.revokeAllBrowserSessions(input),
        isEmailUnconfigured: async () => {
          const view = await dependencies.notifications.getMailDelivery();
          return view.provider === undefined && !view.misconfigured;
        },
      }),
      processName,
      rateLimits: repositories.rateLimits,
      dependencies: {
        apiKeys: dependencies.apiKeys,
        featureFlags: dependencies.featureFlags,
        identity: dependencies.identity,
        organizations: dependencies.organizations,
        users: dependencies.users,
      },
      legacySsoAccess: LegacySsoAccessService.create({
        accounts: accountRows,
        memberships: legacyAccessMemberships(dependencies.organizations),
        connections: legacyAccessConnections(dependencies.identity),
      }),
      federatedAccounts: FederatedAccountReadsService.create({
        accounts: accountRows,
        organizations: dependencies.organizations,
      }),
      signInSecurity: SignInSecuritySettingsService.create({
        organizations: dependencies.organizations,
        locks: repositories.signInLocks,
        members: signInSecurityMembers(dependencies.organizations),
        entitlements: dependencies.entitlements,
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
        resolveDefaultMethods,
        passwordIsAllowed: async () =>
          (await app.resolveAuthProvider()) === "email" || config.localPasswords,
        checkSignUp: (input) => dependencies.organizations.checkSignUp(input),
      }),
      resolveDefaultMethods,
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
      isProduction: config.nodeEnvironment === "production",
    });

    const signInProviders = await resolveSignInProviders({
      config: config.signInProviders,
      into: setup.secrets.into,
      baseUrl: config.sessionUrl ?? "",
    });
    app.#mountedSocialMethodIds = mountedSocialMethodIds({ configuration: signInProviders });
    const auth0ManagementSecret = await setup.secrets.into(
      AuthModule.secrets.auth0ManagementSecret,
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
      AuthModule.secrets.internalSlackSignupsWebhook,
      (webhookUrl) =>
        SignupAnnouncementService.create({
          channel: webhookUrl ? signupAnnouncementChannels.live.create({ webhookUrl }) : undefined,
          publicBaseUrl: config.publicBaseUrl,
          logger,
        }),
    );

    return setup.secrets.into(AuthModule.secrets.session, (sessionSecret) => {
      assertAuthServerConfig(config, sessionSecret);

      const identity: BetterAuthDeploymentIdentity | undefined =
        config.sessionUrl && sessionSecret
          ? {
              secret: sessionSecret,
              baseUrl: config.sessionUrl,
              publicBaseUrl: config.publicBaseUrl,
              mfaEnrollmentOpen: config.mfaEnrollmentOpen,
              passkeysEnabled: config.passkeysEnabled,
              passkeyHandleSecret: config.passkeyHandleSecret ?? sessionSecret,
            }
          : undefined;
      app.#browserSession = identity;
      app.#deriveQueryCacheKey = queryCacheKeyDeriver({ secret: sessionSecret });

      if (identity) {
        app.#composeBetterAuth = () =>
          buildBetterAuth({
            identity,
            idTokenIssuerRefusals: app.#idTokenIssuerRefusals,
            oauthProfileEmails: app.#oauthProfileEmails,
            signupAnnouncements,
            lifecycle: app.#lifecycle,
            signInLockout: SignInLockoutService.create({
              locks: repositories.signInLocks,
              organizations: dependencies.organizations,
              directory: {
                findUserIdFor: async ({ identifier }) =>
                  (await dependencies.users.findByEmail({ email: identifier }))?.id ?? null,
              },
              evidence: auditedLockoutEvidence(dependencies.auditLog),
              hashIdentifier: keyedIdentifierHasher(sessionSecret),
              now,
            }),
            // Sign-up is the module's own availability: no public base URL refuses by name.
            signUpProofs: {
              completeVerification: async (input) =>
                app.requireSignUp().completeVerification(input),
              validateAddressProof: async (input) =>
                app.requireSignUp().validateAddressProof(input),
              claimAddressProof: async (input) => app.requireSignUp().claimAddressProof(input),
            },
            passkeySignUpEligibility: app.#signUpEnrollment,
            repositories,
            sharedStorage: repositories.sessionCache !== null,
            auth: app,
            grants: dependencies.authz,
            organizations: dependencies.organizations,
            sendResetPassword: AuthModule.passwordResetSender({
              mail: passwordResetMailChannels.ses.create({ mailer }),
              publicBaseUrl: config.publicBaseUrl,
              processName,
            }),
            users: dependencies.users,
            identityApi: dependencies.identity,
            signInRouting: (input) => dependencies.identity.routeSignIn(input),
            authProvider: configuredAuthProvider(config.signInProviders).provider,
            signInProviders,
            licensing: dependencies.licensing,
            sso: dependencies.sso,
            isSaas: config.isSaas,
            localPasswords: config.localPasswords,
            trustedIdpOrigins: config.trustedIdpOrigins,
            idpSimulatorUrl: config.idpSimulatorUrl,
            isProduction: config.nodeEnvironment === "production",
            logger,
          });
      } else {
        logger.info(
          { module: "auth" },
          "This process named no browser-session identity (NEXTAUTH_SECRET and NEXTAUTH_URL), so it composes no Better Auth instance: every browser caller reads as signed out and the sign-in door refuses",
        );
      }

      return app;
    });
  }

  lifecyclePipeline(): AuthLifecycleDefinition {
    return buildAuthLifecyclePipeline({
      sessions: { revokeAllBrowserSessions: (input) => this.revokeAllBrowserSessions(input) },
    });
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
        processName: this.#processName,
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
        processName: this.#processName,
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
      ...(record.project_id ? { projectId: record.project_id } : {}),
      ...(record.project_locked ? { projectLocked: true } : {}),
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

  /** The API door's reader for a project-bound bearer; auth's own, not an `AuthApi` operation. */
  getCliAccessProject(input: { authorization: string }): Promise<CliAccessProject> {
    return this.#cliDeviceFlow.getAccessProject(input);
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

  issueProjectCliSession(input: {
    userId: string;
    organizationId: string;
    projectId: string;
    clientLabel: string;
  }): Promise<CliSessionTokens> {
    return this.#cliDeviceFlow.issueProjectSession(input);
  }

  refreshCliSession(input: { refreshToken: string }): Promise<CliSessionTokens> {
    return this.#cliDeviceFlow.rotateSession(input);
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

  deactivateUser(input: UserLifecycleChangeInput): Promise<UserProfile> {
    return this.#accounts.deactivate(input);
  }

  deactivateAccount(input: { userId: string; caller: UserCaller }): Promise<void> {
    return this.#accounts.deactivateAsCaller(input);
  }

  changeUserEmail(input: UpdateUserEmailInput): Promise<UserProfile> {
    return this.#accounts.changeEmail(input);
  }

  setOwnFirstPassword(input: SetOwnFirstPasswordInput): Promise<void> {
    return this.#ownPasswords.setFirst(input);
  }

  changeOwnPassword(input: ChangeOwnPasswordInput): Promise<void> {
    return this.#ownPasswords.change(input);
  }

  registerCredentialAccount(input: RegisterCredentialAccountInput): Promise<CreatedUser> {
    return this.#registrations.register(input);
  }

  /** Meters through the counter every process supplies, the same one the token
   *  check counts against — a throttle refuses by its own code, never as an
   *  absent collaborator. specs/identity/signin-signup-screens.feature. */
  async isWithinBudget(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; retryAfterSeconds?: number | undefined }>> {
    const decision = await this.#rateLimits.check(input.key, {
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
    input: Readonly<{ email: string; callbackUrl?: string }>,
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

  /** No process composes the invitation reads yet; see policies-DS-2d Risks. */
  async readInviteLanding(_input: Readonly<{ inviteCode: string }>): Promise<InviteLanding> {
    throw this.#invitesUnavailable();
  }

  async requestFreshInvite(_input: Readonly<{ inviteCode: string }>): Promise<void> {
    throw this.#invitesUnavailable();
  }

  resolveAuthProvider(): Promise<string> {
    const authProviders = this.#authProviders;
    if (!authProviders) {
      throw new AuthUnavailableError({
        capability: "sign-in mode configuration, so it cannot name this deployment's auth provider",
        processName: this.#processName,
      });
    }
    return authProviders.resolve();
  }

  /** The ceremony, or the refusal that names why this process has none. */
  private requireSignUp(): SignUpVerificationService {
    if (!this.#signUp) {
      throw new AuthUnavailableError({
        capability: "public base URL, so it cannot build a sign-up confirmation link",
        processName: this.#processName,
      });
    }

    return this.#signUp;
  }

  #invitesUnavailable(): AuthUnavailableError {
    return new AuthUnavailableError({
      capability:
        "invitation service, so it cannot ask this organization's admins to reissue the invitation",
      processName: this.#processName,
    });
  }
}

/** The ceremony this process can run, or nothing where it has no public base URL to link to. */
function buildSignUpVerification({
  publicBaseUrl,
  mailer,
  repositories,
  now,
  users,
  route,
  checkSignUp,
  isWithinBudget,
  revokeAllBrowserSessions,
  isEmailUnconfigured,
}: {
  publicBaseUrl: string | undefined;
  mailer: MailSender;
  repositories: AuthRepositories;
  now: () => Instant;
  users: UserApi;
  route: SignUpVerificationDeps["route"];
  checkSignUp: SignUpVerificationDeps["checkSignUp"];
  isWithinBudget: SignUpVerificationDeps["isWithinBudget"];
  revokeAllBrowserSessions: SignUpVerificationDeps["revokeAllBrowserSessions"];
  isEmailUnconfigured: SignUpVerificationDeps["isEmailUnconfigured"];
}): SignUpVerificationService | null {
  if (!publicBaseUrl) return null;

  return SignUpVerificationService.create({
    tokens: repositories.signUpTokens,
    mailer: signUpVerificationMailChannels.ses.create({ mailer }),
    users,
    route,
    checkSignUp,
    isWithinBudget,
    revokeAllBrowserSessions,
    buildVerificationUrl: ({ token, callbackUrl }) =>
      buildSignUpVerificationUrl({ baseUrl: publicBaseUrl, token, callbackUrl }),
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

/** The deployment's browser-session identity: present whole, or not at all. */
type BetterAuthDeploymentIdentity = Readonly<{
  secret: string;
  baseUrl: string;
  publicBaseUrl?: string | undefined;
  mfaEnrollmentOpen: boolean;
  passkeysEnabled: boolean;
  passkeyHandleSecret: string;
}>;

/**
 * ADR-027's licence questions, answered by licensing as main's
 * `platformSSOAllowed` did. The configured provider applies only when licensed
 * AND mounted; otherwise the door is email mode (main's `resolveAuthProvider`).
 */
export class ModuleBetterAuthFederation extends BetterAuthFederation {
  static create(options: {
    authProvider: string | undefined;
    providerMounted: boolean;
    licensing: Pick<LicensingApi, "isPlatformSsoLicensed">;
    passkeysEnabled: boolean;
    isSaas: boolean;
    localPasswords: boolean;
    mountedSocialMethodIds: readonly string[];
  }): ModuleBetterAuthFederation {
    return new ModuleBetterAuthFederation(options);
  }

  private constructor(
    private readonly deployment: {
      authProvider: string | undefined;
      providerMounted: boolean;
      licensing: Pick<LicensingApi, "isPlatformSsoLicensed">;
      passkeysEnabled: boolean;
      isSaas: boolean;
      localPasswords: boolean;
      mountedSocialMethodIds: readonly string[];
    },
  ) {
    super();
  }

  federationCapable(): boolean {
    const provider = this.deployment.authProvider?.trim();
    return provider !== undefined && provider !== "" && provider !== "email";
  }

  resolveSignInMethodPolicy(): Promise<SignInMethodPolicy> {
    return SignInMethodPolicyService.create({
      resolveAuthProvider: () => this.resolveAuthProvider(),
      federationLicensed: () => this.platformSsoAllowed(),
      offersPasskeys: () => this.deployment.passkeysEnabled,
      issuesOwnPasswords: () => this.deployment.localPasswords,
      selfHosted: () => !this.deployment.isSaas,
      mountedSocialMethodIds: () => this.deployment.mountedSocialMethodIds,
    }).resolvePolicy();
  }

  platformSsoAllowed(): Promise<boolean> {
    return this.deployment.licensing.isPlatformSsoLicensed();
  }

  private async resolveAuthProvider(): Promise<string> {
    const provider = this.deployment.authProvider ?? "email";
    if (provider === "email") return "email";
    if (!(await this.platformSsoAllowed())) return "email";
    return this.deployment.providerMounted ? provider : "email";
  }
}

/** Identity ceremonies over identity's `*Api`: a user delete erases, an account write attaches. */
class IdentityBetterAuthCeremonies extends BetterAuthIdentityCeremonies {
  static create(identity: Pick<IdentityApi, "ceremonies">): IdentityBetterAuthCeremonies {
    return new IdentityBetterAuthCeremonies(identity);
  }

  private constructor(private readonly identity: Pick<IdentityApi, "ceremonies">) {
    super();
  }

  beforeUserDelete(user: { id: string }): Promise<void> {
    return this.identity.ceremonies().beforeUserDelete(user);
  }

  createAccountIdentifier(account: BetterAuthAccountRow): Promise<BetterAuthAccountPin> {
    return this.identity.ceremonies().createAccountIdentifier(account);
  }

  beforeAccountDelete(account: BetterAuthAccountRow): Promise<void> {
    return this.identity.ceremonies().beforeAccountDelete(account);
  }
}

/** The announcements, over what this process holds: the sign-up one reaches our own Slack. */
export class LoggedBetterAuthAnnouncements extends BetterAuthAnnouncements {
  static create({
    logger,
    signups,
    lifecycle,
  }: {
    logger: Logger;
    signups: SignupAnnouncementService;
    lifecycle: Pick<AuthLifecycleNoticeService, "signedUp" | "sessionStarted" | "ssoAutoAdded">;
  }): LoggedBetterAuthAnnouncements {
    return new LoggedBetterAuthAnnouncements(logger, signups, lifecycle);
  }

  private constructor(
    private readonly logger: Logger,
    private readonly signups: SignupAnnouncementService,
    private readonly lifecycle: Pick<
      AuthLifecycleNoticeService,
      "signedUp" | "sessionStarted" | "ssoAutoAdded"
    >,
  ) {
    super();
  }

  signUpNurturing(input: { userId: string }): void {
    this.lifecycle.signedUp(input);
  }

  reportError(error: unknown): void {
    this.logger.error({ error }, "Better Auth swallowed an error on a best-effort path");
  }

  announceSignup(input: { userName: string; userEmail: string; organizationName: string }): void {
    void this.signups.announce(input).catch((error: unknown) => this.reportError(error));
  }

  ssoAutoAddNurturing(input: {
    userId: string;
    organizationId: string;
    organizationName: string;
  }): void {
    this.lifecycle.ssoAutoAdded(input);
  }

  sessionNurturing(input: { userId: string }): void {
    this.lifecycle.sessionStarted(input);
  }
}

/**
 * The sign-in router shadow, reported off. `mode()` is the whole switch: `off`
 * returns before the comparison reads, computes or logs anything, so this
 * absence costs exactly what the flag being off costs.
 */
class OffSignInRouterShadow extends SignInRouterShadow {
  static create(): OffSignInRouterShadow {
    return new OffSignInRouterShadow();
  }

  mode(): "off" {
    return "off";
  }

  route(): Promise<RoutingDecision> {
    return Promise.reject(
      new Error("The sign-in router shadow is off in this process and routes nothing"),
    );
  }

  resolveAuthProvider(): Promise<string> {
    return Promise.reject(
      new Error("The sign-in router shadow is off in this process and resolves no provider"),
    );
  }
}

/**
 * The arrival door, asked of the identity module per sign-in rather than
 * resolved once: the service reads the connection each time it decides.
 */
class IdentitySsoArrivals implements SsoArrivalApi {
  static create(identity: IdentityApi): IdentitySsoArrivals {
    return new IdentitySsoArrivals(identity);
  }

  private constructor(private readonly identity: IdentityApi) {}

  admit(args: SsoArrivalAdmission): Promise<void> {
    return this.identity.ssoArrival().admit(args);
  }
}

type BuildBetterAuthOptions = Readonly<{
  /** The deployment's browser-session identity; without it, no instance. */
  identity: BetterAuthDeploymentIdentity;
  /** Shared with the sign-in door, which names an ID token refused for its issuer. */
  idTokenIssuerRefusals?: IdTokenIssuerRefusalChannel;
  /** Where each OAuth provider's profile mapping notes the address, for a refused link. */
  oauthProfileEmails?: OAuthProfileEmailChannel;
  /** Main's sign-up announcement, for a user who joins through their domain. */
  signupAnnouncements: SignupAnnouncementService;
  /** Where a sign-up, a session and a domain auto-join are recorded for nurturing. */
  lifecycle: Pick<AuthLifecycleNoticeService, "signedUp" | "sessionStarted" | "ssoAutoAdded">;
  /** Auth's repositories: Better Auth's storage, its session cache and the hooks' rows. */
  repositories: Pick<
    AuthRepositories,
    "betterAuthStorage" | "betterAuthSecondaryStorage" | "betterAuthHooks"
  >;
  /** Whether this tier keeps a shared store, which decides Better Auth's rate-limit storage. */
  sharedStorage: boolean;
  /** The Auth application whose sessions this instance mints and revokes. */
  auth: AuthApiContract;
  /** The grants ledger an SSO domain auto-join writes its organization binding to. */
  grants: AuthzGrantsService;
  /**
   * Where a domain auto-join applies the pending invite an address already
   * holds, and who the installation lets create an account.
   */
  organizations: Pick<
    OrganizationApi,
    | "applyPendingInvite"
    | "checkSignUp"
    | "findBySsoDomain"
    | "createSsoDomainMembership"
    | "countMembershipsForUser"
  >;
  /** Sends a requested reset link; see {@link passwordResetSender}. */
  sendResetPassword: (reset: { email: string; token: string }) => Promise<void>;
  /** The same user directory the rest of this process serves from. */
  users: UserApi;
  /** Whose connections decide what a federated sign-in arrives into. */
  identityApi: IdentityApi;
  /** The consecutive-failure counter behind account lock-out (GAC-09). */
  signInLockout: SignInAttemptCounter;
  /** The mailbox proofs passkey sign-up checks and spends; refused by name where sign-up is off. */
  signUpProofs: SignUpVerification & SignUpAddressConfirmation;
  /** Whether a proven address still enrols a passkey here; the proof is not read. */
  passkeySignUpEligibility: PasskeySignUpEligibility;
  /** Where an address signs in, or `null` where this process composed no
   *  routing directory - then no connection governs a credential sign-in. */
  signInRouting:
    | ((
        input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
      ) => Promise<RoutingDecision>)
    | null;
  /** `"email"`, or the federated provider id this deployment mounted. */
  authProvider: string | undefined;
  /** Every provider's registration, from which the ones this deployment names mount. */
  signInProviders: SignInProviderConfiguration;
  /** Enterprise SSO, which shapes those providers for Better Auth (ARCHITECTURE §3.3). */
  sso: Pick<SsoApi, "getSignInProviderMounts">;
  /** Whether a signed license permits platform single sign-on (ADR-027). */
  licensing: Pick<LicensingApi, "isPlatformSsoLicensed">;
  /** Whether this is the hosted product rather than a self-hosted install. */
  isSaas: boolean;
  /** D09: whether this deployment issues its own passwords beside its provider. */
  localPasswords: boolean;
  /** `SSO_TRUSTED_IDP_ORIGINS`, and the worktree simulator's URL: the two
   *  static ways an origin is trusted without a registered connection. */
  trustedIdpOrigins: string | undefined;
  idpSimulatorUrl: string | undefined;
  /** Whether this is a production deployment — the simulator is trusted
   *  nowhere else, because it signs whatever it is asked to sign. */
  isProduction: boolean;
  logger: Logger;
}>;

/**
 * Builds this deployment's Better Auth instance on first use, never during
 * construction, because it asks the SSO peer. Built ONCE per process: a second
 * instance over one cookie namespace would answer whoever happened to ask it.
 */
async function buildBetterAuth(options: BuildBetterAuthOptions): Promise<BetterAuthTransport> {
  const { identity, logger, signInRouting } = options;

  logger.warn(
    {
      absent: ["identity-pipeline", "sign-in-router-shadow"],
    },
    "Better Auth composed by the auth module: it runs the stock Prisma storage engine and it runs no sign-in router shadow",
  );

  const providerMounted = isNamedProviderMounted(options.signInProviders);
  if (options.signInProviders.provider !== "email" && !providerMounted) {
    logger.warn(
      { provider: options.signInProviders.provider },
      "AUTH_PROVIDER names a provider this deployment cannot mount — starting in email mode; check the provider id against the self-hosting SSO docs and that its client credentials are set",
    );
  }

  const { socialProviders, genericOAuthConfigs } = await options.sso.getSignInProviderMounts({
    baseUrl: identity.baseUrl,
    onMicrosoftProfile: (profile) => options.identityApi.moveLegacyMicrosoftAccountKey({ profile }),
  });

  return createBetterAuthTransport({
    auth: options.auth,
    idTokenIssuerRefusals: options.idTokenIssuerRefusals,
    users: options.users,
    database: options.repositories.betterAuthHooks,
    secondaryStorage: options.repositories.betterAuthSecondaryStorage,
    sharedStorage: options.sharedStorage,
    storage: options.repositories.betterAuthStorage,
    deployment: {
      baseUrl: identity.baseUrl,
      publicBaseUrl: identity.publicBaseUrl,
      secret: identity.secret,
      emailPasswordEnabled: isEmailPasswordEnabled({
        authProvider: options.authProvider,
        isSaas: options.isSaas,
        localPasswords: options.localPasswords,
      }),
      mfaEnrollmentOpen: identity.mfaEnrollmentOpen,
      passkeysEnabled: identity.passkeysEnabled,
      passkeyHandleSecret: identity.passkeyHandleSecret,
      trustedIdpOrigins: options.trustedIdpOrigins,
      idpSimulatorUrl: options.idpSimulatorUrl,
      isProduction: options.isProduction,
      socialProviders: capturingProfileEmails({
        providers: socialProviders,
        channel: options.oauthProfileEmails,
      }),
      genericOAuthConfigs: genericOAuthConfigs.map(
        (config) => options.oauthProfileEmails?.capturing(config) ?? config,
      ),
    },
    federation: ModuleBetterAuthFederation.create({
      authProvider: options.authProvider,
      providerMounted,
      licensing: options.licensing,
      passkeysEnabled: identity.passkeysEnabled,
      isSaas: options.isSaas,
      localPasswords: options.localPasswords,
      mountedSocialMethodIds: mountedSocialMethodIds({ configuration: options.signInProviders }),
    }),
    identity: IdentityBetterAuthCeremonies.create(options.identityApi),
    invites: options.organizations,
    organizations: options.organizations,
    announcements: LoggedBetterAuthAnnouncements.create({
      logger,
      signups: options.signupAnnouncements,
      lifecycle: options.lifecycle,
    }),
    shadow: OffSignInRouterShadow.create(),
    authzGrants: options.grants,
    arrivals: IdentitySsoArrivals.create(options.identityApi),
    ssoActivity: {
      record: (args) => options.identityApi.ssoActivity().record(args),
    },
    linkProposals: {
      proposeLink: (input) => options.identityApi.identity().proposeLink(input),
    },
    ssoAssertions: {
      decide: (args) => options.identityApi.ssoAssertion().decide(args),
      resolveUser: (args) => options.identityApi.ssoAssertion().resolveUser(args),
    },
    ssoIssuers: SsoRegisteredIssuersService.create({
      issuers: {
        findIssuersForConnection: (args) =>
          options.identityApi.ssoIssuers().findIssuersForConnection(args),
        findIssuersForDomain: (args) => options.identityApi.ssoIssuers().findIssuersForDomain(args),
        findEndpointOrigins: (args) => options.identityApi.ssoIssuers().findEndpointOrigins(args),
      },
      logger,
    }),
    mintClaims: { claimsForMint: (args) => options.identityApi.claimsForMint(args) },
    ssoMigration: {
      decideAccountLink: (args) =>
        options.identityApi.ssoMigrationCallbacks().decideAccountLink(args),
      authorizeAndRecordAuthentication: (args) =>
        options.identityApi.ssoMigrationCallbacks().authorizeAndRecordAuthentication(args),
    },
    signUpVerification: options.signUpProofs,
    sendResetPassword: options.sendResetPassword,
    signInLockout: options.signInLockout,
    findGoverningConnections: async ({ email }) => {
      if (signInRouting === null) return [];
      const decision = await signInRouting({ identifier: email, breakGlass: false });
      if (decision.outcome !== "redirect_to_connection") return [];
      return decision.methodSet.flatMap((method) =>
        method.connectionId === null
          ? []
          : [{ connectionId: method.connectionId, methodId: method.id }],
      );
    },
    signUpPolicy: options.organizations,
    passkeySignUpEligibility: options.passkeySignUpEligibility,
    credentialGuard: CredentialSessionGuard.create(
      CredentialSignInPolicyService.create({
        routing: signInRouting === null ? null : { route: signInRouting },
        connections: {
          getOrganization: (args) => options.identityApi.ssoConnectionReads().getOrganization(args),
        },
        recovery: {
          findGrants: (args) => options.identityApi.ssoBreakGlass().findGrants(args),
        },
      }),
    ),
  });
}

/** Each mounted social provider, its profile mapping noting the address it maps. */
function capturingProfileEmails<P extends Record<string, unknown>>({
  providers,
  channel,
}: {
  providers: P;
  channel: OAuthProfileEmailChannel | undefined;
}): P {
  if (!channel) return providers;
  const wrapped: Record<string, unknown> = {};
  for (const [id, config] of Object.entries(providers)) {
    wrapped[id] =
      typeof config === "object" && config !== null ? channel.capturing(config) : config;
  }
  return { ...providers, ...wrapped };
}

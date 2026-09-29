/**
 * Auth module's ONE Better Auth instance. Ported from deleted composition;
 * absences are deliberate—each collaborator refuses by name if absent.
 */
import { AuthUnavailableError, type AuthApi } from "@langwatch/auth-contract";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { SsoApi } from "@langwatch/enterprise-sso-contract";
import {
  isNamedProviderMounted,
  type SignInProviderConfiguration,
} from "@langwatch/enterprise-sso-contract/sign-in-providers";
import {
  SignInMethodPolicyService,
  routesToOrganizationConnection,
  sealedProviderConfigCipher,
  type IdentityApi,
  type RoutingDecision,
  type SignInMethodPolicy,
  type SsoArrivalAdmission,
  type SsoArrivalApi,
  type SsoProviderConfigCipher,
} from "@langwatch/identity-contract";
import type { Logger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { RedisConnection } from "@langwatch/redis-client";
import type { UserApi } from "@langwatch/user-contract";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { BetterAuthOptions } from "better-auth/types";

import {
  BetterAuthAnnouncements,
  BetterAuthFederation,
  BetterAuthIdentityCeremonies,
  BetterAuthStorage,
  type BetterAuthAccountPin,
  type BetterAuthAccountRow,
} from "../channels/better-auth.channel.ts";
import {
  createBetterAuthTransport,
  isEmailPasswordEnabled,
  type BetterAuthTransport,
  type SignInAttemptCounter,
} from "../channels/http/http.better-auth.channel.ts";
import { CredentialSessionGuard } from "../channels/http/http.credential-session-guard.channel.ts";
import type { SignUpVerification } from "../channels/http/http.passkey-sign-up.channel.ts";
import { SignInRouterShadow } from "../channels/http/http.sign-in-router-shadow.channel.ts";
import type { PasswordResetMailChannel } from "../channels/password-reset-mail.channel.ts";
import { MemoryBetterAuthSecondaryStorageRepository } from "../repositories/memory/memory.better-auth-secondary-storage.repository.ts";
import { PrismaBetterAuthHooksRepository } from "../repositories/prisma/prisma.better-auth-hooks.repository.ts";
import { RedisBetterAuthSecondaryStorageRepository } from "../repositories/redis/redis.better-auth-secondary-storage.repository.ts";
import { openingSsoProviderConfigs } from "../rules/sso-provider-config.rules.ts";
import { CredentialSignInPolicyService } from "../services/credential-sign-in-policy.service.ts";
import type { SignupAnnouncementService } from "../services/signup-announcement.service.ts";
import { SsoRegisteredIssuersService } from "../services/sso-registered-issuers.service.ts";

/** The deployment's browser-session identity: present whole, or not at all. */
export type BetterAuthDeploymentIdentity = Readonly<{
  secret: string;
  baseUrl: string;
  publicBaseUrl?: string | undefined;
  mfaEnrollmentOpen: boolean;
  passkeysEnabled: boolean;
  passkeyHandleSecret: string;
}>;

/** Better Auth's storage engine: the stock Prisma adapter over the module's
 *  own client, with the engine's sealed dialing documents opened on the way
 *  out — this is the one seam that dials with them (D09). */
export class PrismaBetterAuthStorage extends BetterAuthStorage {
  static create(
    database: ProcessMembers["prisma"],
    encryption: ProcessMembers["encryption"],
  ): PrismaBetterAuthStorage {
    return new PrismaBetterAuthStorage(database, sealedProviderConfigCipher(encryption));
  }

  private constructor(
    private readonly database: ProcessMembers["prisma"],
    private readonly providerConfig: SsoProviderConfigCipher,
  ) {
    super();
  }

  adapter(): unknown {
    const engine = prismaAdapter(this.database, { provider: "postgresql" });
    const cipher = this.providerConfig;
    return (options: BetterAuthOptions) =>
      openingSsoProviderConfigs({ adapter: engine(options), cipher });
  }
}

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

/**
 * The identity ceremonies, absent. Every method is the no-op the legacy branch
 * already ran: a user delete erases no identifier, an account write is not
 * restated as an attach, and its id is Better Auth's own.
 */
export class AbsentBetterAuthIdentityCeremonies extends BetterAuthIdentityCeremonies {
  static create(): AbsentBetterAuthIdentityCeremonies {
    return new AbsentBetterAuthIdentityCeremonies();
  }

  async beforeUserDelete(): Promise<void> {}

  async createAccountIdentifier(): Promise<BetterAuthAccountPin> {
    return { pinned: false };
  }

  async beforeAccountDelete(_account: BetterAuthAccountRow): Promise<void> {}
}

/** The announcements, over what this process holds: the sign-up one reaches our own Slack. */
export class LoggedBetterAuthAnnouncements extends BetterAuthAnnouncements {
  static create({
    logger,
    signups,
  }: {
    logger: Logger;
    signups: SignupAnnouncementService;
  }): LoggedBetterAuthAnnouncements {
    return new LoggedBetterAuthAnnouncements(logger, signups);
  }

  private constructor(
    private readonly logger: Logger,
    private readonly signups: SignupAnnouncementService,
  ) {
    super();
  }

  trackServerEvent(input: { userId: string; event: string }): void {
    this.logger.debug(
      { userId: input.userId, event: input.event },
      "Product analytics is not composed in this process; the event was not sent",
    );
  }

  reportError(error: unknown): void {
    this.logger.error({ error }, "Better Auth swallowed an error on a best-effort path");
  }

  announceSignup(input: { userName: string; userEmail: string; organizationName: string }): void {
    void this.signups.announce(input).catch((error: unknown) => this.reportError(error));
  }

  ssoAutoAddNurturing(): void {}

  sessionNurturing(): void {}
}

/**
 * The sign-in router shadow, reported off. `mode()` is the whole switch: `off`
 * returns before the comparison reads, computes or logs anything, so this
 * absence costs exactly what the flag being off costs.
 */
export class OffSignInRouterShadow extends SignInRouterShadow {
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
 * Sign-up's address proofs, absent: no proof is live, so passkey sign-up refuses.
 * Reached only when the passkey plugin is mounted.
 */
export class AbsentSignUpVerification implements SignUpVerification {
  static create(logger: Logger): AbsentSignUpVerification {
    return new AbsentSignUpVerification(logger);
  }

  private constructor(private readonly logger: Logger) {}

  async validateAddressProof(): Promise<boolean> {
    return this.refuse();
  }

  async claimAddressProof(): Promise<boolean> {
    return this.refuse();
  }

  private refuse(): boolean {
    this.logger.warn(
      "Passkey sign-up refused: this process composes no sign-up verification service, so no address proof can be checked",
    );
    return false;
  }
}

/**
 * Main's reset mail: the link lands on this deployment's own reset page. With
 * no public base URL there is no page to root it at, so it refuses by name: a
 * reset link nobody can open is worse than a refusal an operator can read.
 */
export function passwordResetSender(input: {
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

/**
 * The arrival door, asked of the identity module per sign-in rather than
 * resolved once: the service reads the connection each time it decides.
 */
export class IdentitySsoArrivals implements SsoArrivalApi {
  static create(identity: IdentityApi): IdentitySsoArrivals {
    return new IdentitySsoArrivals(identity);
  }

  private constructor(private readonly identity: IdentityApi) {}

  admit(args: SsoArrivalAdmission): Promise<void> {
    return this.identity.ssoArrival().admit(args);
  }
}

export type BuildBetterAuthOptions = Readonly<{
  /** The deployment's browser-session identity; without it, no instance. */
  identity: BetterAuthDeploymentIdentity;
  /** Main's sign-up announcement, for a user who joins through their domain. */
  signupAnnouncements: SignupAnnouncementService;
  /** The typed client every database hook reads and writes through. */
  prisma: ProcessMembers["prisma"];
  /** The deployment's cipher, which the engine's dialing documents are kept
   *  under at rest. */
  encryption: ProcessMembers["encryption"];
  /** Better Auth's session cache lives here when this process has a Redis. */
  redis: RedisConnection | null;
  /** The Auth application whose sessions this instance mints and revokes. */
  auth: AuthApi;
  /** The grants ledger an SSO domain auto-join writes its organization binding to. */
  grants: AuthzGrantsService;
  /** Where a domain auto-join applies the pending invite an address already holds. */
  organizations: Pick<OrganizationApi, "applyPendingInvite">;
  /** Sends a requested reset link; see {@link passwordResetSender}. */
  sendResetPassword: (reset: { email: string; token: string }) => Promise<void>;
  /** The same user directory the rest of this process serves from. */
  users: UserApi;
  /** Whose connections decide what a federated sign-in arrives into. */
  identityApi: IdentityApi;
  /** The consecutive-failure counter behind account lock-out (GAC-09). */
  signInLockout: SignInAttemptCounter;
  /** The mailbox proofs passkey sign-up checks and spends, or `null` where this
   *  process composed no sign-up ceremony — then passkey sign-up refuses. */
  signUpProofs: SignUpVerification | null;
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

export function createSecondaryStorage(
  redis: RedisConnection | null,
): NonNullable<BetterAuthOptions["secondaryStorage"]> {
  return redis
    ? RedisBetterAuthSecondaryStorageRepository.create(redis)
    : MemoryBetterAuthSecondaryStorageRepository.create();
}

/**
 * Builds this deployment's Better Auth instance on first use, never during
 * construction, because it asks the SSO peer. Built ONCE per process: a second
 * instance over one cookie namespace would answer whoever happened to ask it.
 */
export async function buildBetterAuth(
  options: BuildBetterAuthOptions,
): Promise<BetterAuthTransport> {
  const { identity, logger, signInRouting } = options;
  const secondaryStorage = createSecondaryStorage(options.redis);

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
    users: options.users,
    database: PrismaBetterAuthHooksRepository.create(options.prisma),
    secondaryStorage,
    redis: options.redis,
    storage: PrismaBetterAuthStorage.create(options.prisma, options.encryption),
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
      socialProviders,
      genericOAuthConfigs,
    },
    federation: ModuleBetterAuthFederation.create({
      authProvider: options.authProvider,
      providerMounted,
      licensing: options.licensing,
      passkeysEnabled: identity.passkeysEnabled,
      isSaas: options.isSaas,
      localPasswords: options.localPasswords,
    }),
    identity: AbsentBetterAuthIdentityCeremonies.create(),
    invites: options.organizations,
    announcements: LoggedBetterAuthAnnouncements.create({
      logger,
      signups: options.signupAnnouncements,
    }),
    shadow: OffSignInRouterShadow.create(),
    authzGrants: options.grants,
    arrivals: IdentitySsoArrivals.create(options.identityApi),
    ssoActivity: {
      record: (args) => options.identityApi.ssoActivity().record(args),
    },
    ssoAssertions: {
      decide: (args) => options.identityApi.ssoAssertion().decide(args),
    },
    ssoIssuers: SsoRegisteredIssuersService.create({
      issuers: {
        findIssuersForConnection: (args) =>
          options.identityApi.ssoIssuers().findIssuersForConnection(args),
        findIssuersForDomain: (args) => options.identityApi.ssoIssuers().findIssuersForDomain(args),
      },
      logger,
    }),
    ssoMigration: {
      decideAccountLink: (args) =>
        options.identityApi.ssoMigrationCallbacks().decideAccountLink(args),
      authorizeAndRecordAuthentication: (args) =>
        options.identityApi.ssoMigrationCallbacks().authorizeAndRecordAuthentication(args),
    },
    signUpVerification: options.signUpProofs ?? AbsentSignUpVerification.create(logger),
    sendResetPassword: options.sendResetPassword,
    signInLockout: options.signInLockout,
    addressRoutesToConnection: async ({ email }) =>
      signInRouting !== null &&
      routesToOrganizationConnection(await signInRouting({ identifier: email, breakGlass: false })),
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

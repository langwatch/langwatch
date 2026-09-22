/**
 * Auth module's ONE Better Auth instance. Ported from deleted composition;
 * absences are deliberate—each collaborator refuses by name if absent.
 */
import type { AuthApi } from "@langwatch/auth-contract";
import { AuthzGrantsService } from "@langwatch/authz-contract";
import {
  SignInMethodPolicyService,
  type IdentityApi,
  type RoutingDecision,
  type SignInMethodPolicy,
  type SsoArrivalApi,
} from "@langwatch/identity-contract";
import type { Logger } from "@langwatch/observability";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { RedisConnection } from "@langwatch/redis-client";
import type { UserApi } from "@langwatch/user-contract";
import { prismaAdapter } from "better-auth/adapters/prisma";

import {
  BetterAuthAnnouncements,
  BetterAuthFederation,
  BetterAuthIdentityCeremonies,
  BetterAuthPendingInvite,
  BetterAuthStorage,
  type BetterAuthAccountRow,
  type PendingOrganizationInvite,
} from "../channels/better-auth.channel.ts";
import {
  createBetterAuthTransport,
  isEmailPasswordEnabled,
  type BetterAuthTransport,
} from "../channels/http/http.better-auth.channel.ts";
import type { SignUpVerification } from "../channels/http/http.passkey-sign-up.channel.ts";
import { SignInRouterShadow } from "../channels/http/http.sign-in-router-shadow.channel.ts";
import { MemoryBetterAuthSecondaryStorageRepository } from "../repositories/memory/memory.better-auth-secondary-storage.repository.ts";
import { PrismaBetterAuthHooksRepository } from "../repositories/prisma/prisma.better-auth-hooks.repository.ts";
import { RedisBetterAuthSecondaryStorageRepository } from "../repositories/redis/redis.better-auth-secondary-storage.repository.ts";

/** The deployment's browser-session identity: present whole, or not at all. */
export type BetterAuthDeploymentIdentity = Readonly<{
  secret: string;
  baseUrl: string;
  publicBaseUrl?: string | undefined;
  mfaEnrollmentOpen: boolean;
  passkeysEnabled: boolean;
  passkeyHandleSecret: string;
}>;

/** Better Auth's storage engine: the stock Prisma adapter over the module's own client. */
export class PrismaBetterAuthStorage extends BetterAuthStorage {
  static create(database: ProcessMembers["prisma"]): PrismaBetterAuthStorage {
    return new PrismaBetterAuthStorage(database);
  }

  private constructor(private readonly database: ProcessMembers["prisma"]) {
    super();
  }

  adapter(): unknown {
    return prismaAdapter(this.database, { provider: "postgresql" });
  }
}

/**
 * ADR-027's licence questions. The hosted product is licensed by definition;
 * a self-hosted install reports unlicensed here, since this module reads no
 * licence — matching what the deleted composition answered.
 */
export class ModuleBetterAuthFederation extends BetterAuthFederation {
  static create(options: {
    authProvider: string | undefined;
    passkeysEnabled: boolean;
    isSaas: boolean;
  }): ModuleBetterAuthFederation {
    return new ModuleBetterAuthFederation(options);
  }

  private constructor(
    private readonly deployment: {
      authProvider: string | undefined;
      passkeysEnabled: boolean;
      isSaas: boolean;
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
      resolveAuthProvider: () => Promise.resolve(this.deployment.authProvider ?? "email"),
      federationLicensed: () => Promise.resolve(this.deployment.isSaas),
      offersPasskeys: () => this.deployment.passkeysEnabled,
      selfHosted: () => !this.deployment.isSaas,
    }).resolvePolicy();
  }

  platformSsoAllowed(): Promise<boolean> {
    return Promise.resolve(false);
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

  async tryBeforeAccountCreate(): Promise<{ data: { id: string } } | undefined> {
    return undefined;
  }

  async beforeAccountDelete(_account: BetterAuthAccountRow): Promise<void> {}
}

/**
 * The pending-invitation lookup, absent. Answers "no pending invite", which
 * sends an SSO auto-join down its default membership path.
 */
export class AbsentBetterAuthPendingInvites extends BetterAuthPendingInvite {
  static create(logger: Logger): AbsentBetterAuthPendingInvites {
    return new AbsentBetterAuthPendingInvites(logger);
  }

  private constructor(private readonly logger: Logger) {
    super();
  }

  async tryFindPendingByOrganizationAndEmail(input: {
    organizationId: string;
    email: string;
  }): Promise<PendingOrganizationInvite | null> {
    this.logger.warn(
      { organizationId: input.organizationId },
      "No invitation service in this process: a domain auto-join applies the default membership rather than a pending invite",
    );
    return null;
  }

  async applyInvite(): Promise<void> {
    throw new Error("This process composes no invitation service");
  }
}

/** The announcements, over what this process actually holds. */
export class LoggedBetterAuthAnnouncements extends BetterAuthAnnouncements {
  static create(logger: Logger): LoggedBetterAuthAnnouncements {
    return new LoggedBetterAuthAnnouncements(logger);
  }

  private constructor(private readonly logger: Logger) {
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

  announceSignup(input: { userEmail: string; organizationName: string }): void {
    this.logger.info(
      { organizationName: input.organizationName },
      "New user joined an organization through its domain; no signup notification transport is composed in this process",
    );
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
 * Sign-up's address confirmation, absent. Reached only from the passkey sign-up
 * ceremony, and only when the passkey plugin is mounted.
 */
export class AbsentSignUpVerification implements SignUpVerification {
  static create(logger: Logger): AbsentSignUpVerification {
    return new AbsentSignUpVerification(logger);
  }

  private constructor(private readonly logger: Logger) {}

  async requestVerification(): Promise<void> {
    this.logger.warn(
      "Passkey sign-up could not send an address confirmation: this process composes no sign-up verification service",
    );
  }
}

/**
 * Nothing to write a grant with. Reached only from the SSO domain auto-join,
 * which runs only when {@link ModuleBetterAuthFederation} allows platform SSO —
 * and it answers that it does not.
 */
export class UnavailableBetterAuthGrants extends AuthzGrantsService {
  static create(): UnavailableBetterAuthGrants {
    return new UnavailableBetterAuthGrants();
  }

  private unavailable(): Promise<never> {
    return Promise.reject(
      new Error("This process composes no grant writer for the Better Auth transport"),
    );
  }

  attach(): Promise<never> {
    return this.unavailable();
  }
  update(): Promise<never> {
    return this.unavailable();
  }
  revoke(): Promise<never> {
    return this.unavailable();
  }
  replace(): Promise<never> {
    return this.unavailable();
  }
  offboard(): Promise<never> {
    return this.unavailable();
  }
  invalidateOrganization(): Promise<never> {
    return this.unavailable();
  }
  attachBindings(): Promise<never> {
    return this.unavailable();
  }
  attachResourceGrant(): Promise<never> {
    return this.unavailable();
  }
  revokeResourceGrants(): Promise<never> {
    return this.unavailable();
  }
  changeBindingRole(): Promise<never> {
    return this.unavailable();
  }
  revokeBindings(): Promise<never> {
    return this.unavailable();
  }
  revokeBindingsWhere(): Promise<never> {
    return this.unavailable();
  }
  retireDirectoryGrants(): Promise<never> {
    return this.unavailable();
  }
  offboardMember(): Promise<never> {
    return this.unavailable();
  }
  defineRole(): Promise<never> {
    return this.unavailable();
  }
  deleteRole(): Promise<never> {
    return this.unavailable();
  }
  createBinding(): Promise<never> {
    return this.unavailable();
  }
  updateBinding(): Promise<never> {
    return this.unavailable();
  }
  deleteBinding(): Promise<never> {
    return this.unavailable();
  }
  applyMemberBindings(): Promise<never> {
    return this.unavailable();
  }
}

/**
 * Password-reset mail, on a module that composes no gateway. Refuses by name
 * rather than resolving: a reset link nobody sends is worse than a refusal an
 * operator can read.
 */
export function unconfiguredPasswordResetMail(): Promise<never> {
  return Promise.reject(
    new Error(
      "This deployment composes no mail gateway behind sign-in, so it cannot send a password-reset link",
    ),
  );
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

  admit(args: Parameters<SsoArrivalApi["admit"]>[0]): Promise<void> {
    return this.identity.ssoArrival().admit(args);
  }
}

export type BuildBetterAuthOptions = Readonly<{
  /** The deployment's browser-session identity; without it, no instance. */
  identity: BetterAuthDeploymentIdentity;
  /** The typed client every database hook reads and writes through. */
  prisma: ProcessMembers["prisma"];
  /** Better Auth's session cache lives here when this process has a Redis. */
  redis: RedisConnection | null;
  /** The Auth application whose sessions this instance mints and revokes. */
  auth: AuthApi;
  /** The same user directory the rest of this process serves from. */
  users: UserApi;
  /** Whose connections decide what a federated sign-in arrives into. */
  identityApi: IdentityApi;
  /** `"email"`, or the federated provider id this deployment mounted. */
  authProvider: string | undefined;
  /** Whether this is the hosted product rather than a self-hosted install. */
  isSaas: boolean;
  logger: Logger;
}>;

export function createSecondaryStorage(
  redis: RedisConnection | null,
): ReturnType<typeof RedisBetterAuthSecondaryStorageRepository.create> {
  return redis
    ? RedisBetterAuthSecondaryStorageRepository.create(redis)
    : MemoryBetterAuthSecondaryStorageRepository.create();
}

/**
 * Builds this deployment's Better Auth instance. Built ONCE per process and
 * shared. Calling this twice would produce two instances over one cookie
 * namespace, and the second would be the one that happened to be asked.
 */
export function buildBetterAuth(options: BuildBetterAuthOptions): BetterAuthTransport {
  const { identity, logger } = options;
  const secondaryStorage = createSecondaryStorage(options.redis);

  logger.warn(
    {
      absent: [
        "enterprise-licensing",
        "identity-pipeline",
        "password-reset-mail",
        "pending-invitations",
        "sign-in-router-shadow",
        "sso-providers",
      ],
    },
    "Better Auth composed by the auth module: federation reports unlicensed, it runs the stock Prisma storage engine, it cannot send a password-reset link, it applies no pending invitation on a domain auto-join, it runs no sign-in router shadow and it mounts no SSO provider",
  );

  return createBetterAuthTransport({
    auth: options.auth,
    users: options.users,
    database: PrismaBetterAuthHooksRepository.create(options.prisma),
    secondaryStorage,
    redis: options.redis,
    storage: PrismaBetterAuthStorage.create(options.prisma),
    deployment: {
      baseUrl: identity.baseUrl,
      publicBaseUrl: identity.publicBaseUrl,
      secret: identity.secret,
      emailPasswordEnabled: isEmailPasswordEnabled({
        authProvider: options.authProvider,
        isSaas: options.isSaas,
      }),
      mfaEnrollmentOpen: identity.mfaEnrollmentOpen,
      passkeysEnabled: identity.passkeysEnabled,
      passkeyHandleSecret: identity.passkeyHandleSecret,
      // No SSO provider is mounted here: building one needs the client
      // credentials and issuer of an identity provider, and this module reads
      // none. An empty pair is the honest answer, and it is the same one the
      // licence gate above already gives.
      socialProviders: {},
      genericOAuthConfigs: [],
    },
    federation: ModuleBetterAuthFederation.create({
      authProvider: options.authProvider,
      passkeysEnabled: identity.passkeysEnabled,
      isSaas: options.isSaas,
    }),
    identity: AbsentBetterAuthIdentityCeremonies.create(),
    invites: AbsentBetterAuthPendingInvites.create(logger),
    announcements: LoggedBetterAuthAnnouncements.create(logger),
    shadow: OffSignInRouterShadow.create(),
    authzGrants: UnavailableBetterAuthGrants.create(),
    arrivals: IdentitySsoArrivals.create(options.identityApi),
    ssoActivity: {
      record: (args) => options.identityApi.ssoActivity().record(args),
    },
    ssoAssertions: {
      decide: (args) => options.identityApi.ssoAssertion().decide(args),
    },
    ssoMigration: {
      decideAccountLink: (args) =>
        options.identityApi.ssoMigrationCallbacks().decideAccountLink(args),
      authorizeAndRecordAuthentication: (args) =>
        options.identityApi.ssoMigrationCallbacks().authorizeAndRecordAuthentication(args),
    },
    signUpVerification: AbsentSignUpVerification.create(logger),
    sendResetPassword: () => unconfiguredPasswordResetMail(),
  });
}

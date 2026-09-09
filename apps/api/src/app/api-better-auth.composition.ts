import type { BrowserSessionApi } from "@langwatch/auth-contract";
import {
  BetterAuthAnnouncementsPort,
  BetterAuthFederationPort,
  BetterAuthIdentityCeremoniesPort,
  BetterAuthPendingInvitePort,
  BetterAuthStoragePort,
  createBetterAuthTransport,
  isEmailPasswordEnabled,
  PrismaBetterAuthHooksRepository,
  SignInRouterShadowPort,
  type BetterAuthAccountRow,
  type PendingOrganizationInvite,
  type SignUpVerificationPort,
} from "@langwatch/auth-server";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { LicensingService } from "@langwatch/enterprise-licensing-contract";
import type { RoutingDecision, SignInMethodPolicy } from "@langwatch/identity-contract";
import { sendResetPasswordEmail } from "@langwatch/mail";
import {
  BetterAuthCeremonyBridgeAdapter,
  BetterAuthIdentityStorageAdapter,
  IdentityBirthService,
  IdentityCeremoniesAdapter,
  IdentityLedgerWriterAdapter,
  IdentityService,
  IdentityWriteGateService,
  newIdentityCommandId,
  PostgresIdentityGuardsAdapter,
  PrismaIdentityAccountsRepository,
  PrismaIdentityHeadsRepository,
  PrismaIdentityNewbornRepository,
  PrismaIdentityProjectionRepository,
  PrismaIdentityResolutionRepository,
  PrismaIdentityUsersRepository,
  SignInMethodPolicyService,
} from "@langwatch/identity-server";
import { BetterAuthIdentityBirthAdapter } from "@langwatch/identity-server/adapters/better-auth-identity-birth";
import type { IdentityEventingPort } from "@langwatch/identity-server";
import { PrismaSystemMigrationStateRepository } from "@langwatch/ops-server";
import type { Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";
import type { UserApi } from "@langwatch/user-contract";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { ApiBrowserSessionConfig } from "../platform/config/api.config.ts";
import type { ApiMailComposition } from "./api-mail.composition.ts";

/**
 * This process's own Better Auth instance — the deployment's ONE identity seam, composed
 * here rather than received.
 */

/**
 * Better Auth's storage engine: the stock Prisma adapter over this process's own guarded
 * client.
 */
export class ApiPrismaBetterAuthStorage extends BetterAuthStoragePort {
  static create(database: PrismaClient): ApiPrismaBetterAuthStorage {
    return new ApiPrismaBetterAuthStorage(database);
  }

  private constructor(private readonly database: PrismaClient) {
    super();
  }

  adapter(): unknown {
    return prismaAdapter(this.database, { provider: "postgresql" });
  }
}

/**
 * ADR-027's licence questions, answered from the licence this deployment holds.
 */
export class ApiBetterAuthFederation extends BetterAuthFederationPort {
  private licensed: Promise<boolean> | null = null;

  static create(options: {
    authProvider: string | undefined;
    passkeysEnabled: boolean;
    isSaas: boolean;
    licensing: LicensingService | undefined;
    logger: Logger;
  }): ApiBetterAuthFederation {
    return new ApiBetterAuthFederation(options);
  }

  private constructor(
    private readonly deployment: {
      authProvider: string | undefined;
      passkeysEnabled: boolean;
      isSaas: boolean;
      licensing: LicensingService | undefined;
      logger: Logger;
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
      federationLicensed: () => this.federationLicensed(),
      offersPasskeys: () => this.deployment.passkeysEnabled,
      selfHosted: () => !this.deployment.isSaas,
    }).resolvePolicy();
  }

  platformSsoAllowed(): Promise<boolean> {
    return Promise.resolve(false);
  }

  /**
   * The hosted product is licensed by definition; a self-hosted install is licensed when
   * a signed licence inspects valid.
   */
  private federationLicensed(): Promise<boolean> {
    if (this.deployment.isSaas) return Promise.resolve(true);

    const licensing = this.deployment.licensing;
    if (!licensing) return Promise.resolve(false);

    this.licensed ??= licensing
      .inspectPlatformAccess({})
      .then((access) => access.allowed)
      .catch((error: unknown) => {
        this.licensed = null;
        this.deployment.logger.warn(
          { error },
          "Enterprise licence inspection failed: federation reports unlicensed for this request and retries on the next",
        );
        return false;
      });
    return this.licensed;
  }
}

/**
 * The identity ceremonies, absent. Every method is the no-op the legacy branch already
 * ran: a user delete erases no identifier, an account write is not restated as an attach,
 * and its id is Better Auth's own.
 */
export class AbsentApiBetterAuthIdentityCeremonies extends BetterAuthIdentityCeremoniesPort {
  static create(): AbsentApiBetterAuthIdentityCeremonies {
    return new AbsentApiBetterAuthIdentityCeremonies();
  }

  async beforeUserDelete(): Promise<void> {}

  async tryBeforeAccountCreate(): Promise<{ data: { id: string } } | undefined> {
    return undefined;
  }

  async beforeAccountDelete(_account: BetterAuthAccountRow): Promise<void> {}
}

/**
 * The pending-invitation lookup, absent. Answers "no pending invite", which sends an SSO
 * auto-join down its default membership path.
 */
export class AbsentApiBetterAuthPendingInvites extends BetterAuthPendingInvitePort {
  static create(logger: Logger): AbsentApiBetterAuthPendingInvites {
    return new AbsentApiBetterAuthPendingInvites(logger);
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

/**
 * The announcements, over what this process actually holds.
 */
export class LoggedApiBetterAuthAnnouncements extends BetterAuthAnnouncementsPort {
  static create(logger: Logger): LoggedApiBetterAuthAnnouncements {
    return new LoggedApiBetterAuthAnnouncements(logger);
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
 * The sign-in router shadow, reported off. `mode()` is the whole switch: `off` returns
 * before the comparison reads, computes or logs anything, so this absence costs exactly
 * what the flag being off costs.
 */
export class OffApiSignInRouterShadow extends SignInRouterShadowPort {
  static create(): OffApiSignInRouterShadow {
    return new OffApiSignInRouterShadow();
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
 * Sends the password-reset link.
 */
export abstract class ApiPasswordResetMailPort {
  abstract sendResetPassword(input: { email: string; token: string }): Promise<void>;
}

/**
 * Password-reset mail, over this process's own gateway.
 */
export class ApiComposedPasswordResetMail extends ApiPasswordResetMailPort {
  static create(mail: ApiMailComposition): ApiComposedPasswordResetMail {
    return new ApiComposedPasswordResetMail(mail);
  }

  private constructor(private readonly mail: ApiMailComposition) {
    super();
  }

  async sendResetPassword(input: { email: string; token: string }): Promise<void> {
    await sendResetPasswordEmail({
      mailer: this.mail.delivery,
      email: input.email,
      resetUrl: `${this.mail.baseHost}/auth/reset-password?token=${encodeURIComponent(input.token)}`,
    });
  }
}

/**
 * Password-reset mail on a deployment that configured none. No longer a gap in this
 * process — {@link ApiComposedPasswordResetMail} is what a configured deployment gets.
 */
export class UnconfiguredApiPasswordResetMail extends ApiPasswordResetMailPort {
  static create(): UnconfiguredApiPasswordResetMail {
    return new UnconfiguredApiPasswordResetMail();
  }

  sendResetPassword(): Promise<void> {
    return Promise.reject(
      new Error(
        "This deployment named no BASE_HOST, so it composes no mail gateway and cannot send a password-reset link",
      ),
    );
  }
}

/**
 * Sign-up's address confirmation, absent. Reached only from the passkey sign-up ceremony,
 * and only when the passkey plugin is mounted.
 */
export class AbsentApiSignUpVerification implements SignUpVerificationPort {
  static create(logger: Logger): AbsentApiSignUpVerification {
    return new AbsentApiSignUpVerification(logger);
  }

  private constructor(private readonly logger: Logger) {}

  async requestVerification(): Promise<void> {
    this.logger.warn(
      "Passkey sign-up could not send an address confirmation: this process composes no sign-up verification service",
    );
  }
}

/**
 * Nothing to write a grant with. Reached only from the SSO domain auto-join, which runs
 * only when {@link ApiBetterAuthFederation} allows platform SSO — and it answers that it
 * does not.
 */
export class UnavailableApiBetterAuthGrants {
  static create(): AuthzGrantsService {
    return new Proxy({} as AuthzGrantsService, {
      get() {
        return () => {
          throw new Error("This process composes no grant writer for the Better Auth transport");
        };
      },
    });
  }
}

/**
 * The identity branch of Better Auth's storage, and the two account ceremonies bound
 * beside it (ADR-116 §1 and §5).
 *
 * Composed as a pair because they fork on the SAME question: the write gate's per-user
 * answer, birth-aware. The adapter states an attach itself for a user it routes to the
 * identity branch, so the hooks are handed the BRIDGE, which defers for exactly those
 * users — a second statement in one request appends the event twice.
 *
 * The gate ships closed: `isUserOnIdentityWrites` is `finalized` and nothing else, so a
 * deployment whose identifier backfill has enrolled nobody runs Better Auth's own Prisma
 * engine, byte for byte, and every ceremony returns having done nothing.
 */
export class ApiBetterAuthIdentityBranch {
  static compose(options: {
    database: PrismaClient;
    eventing: IdentityEventingPort;
  }): ApiBetterAuthIdentityBranch {
    const { database, eventing } = options;
    const guards = PostgresIdentityGuardsAdapter.create({ database }).build();
    // The SAME address lock the guards claim through (ADR-116 §6): the fold releases it
    // once no live identifier of that user carries the value, so a second instance here
    // would release something this process never claimed.
    const projectionStore = PrismaIdentityProjectionRepository.create({
      prisma: database,
      reservations: guards.reservations,
    });
    const ledger = IdentityLedgerWriterAdapter.create({ projectionStore, eventing });
    const writeGate = IdentityWriteGateService.create({
      state: PrismaSystemMigrationStateRepository.create({ prisma: database }),
    });
    const isLatched = (input: { userId: string }) => writeGate.isUserOnIdentityWrites(input);

    const ceremonies = IdentityCeremoniesAdapter.create(
      PrismaIdentityHeadsRepository.create(database),
      PrismaIdentityUsersRepository.create(database),
      IdentityService.create(guards.identityGuards, ledger),
      isLatched,
      { now: Date.now, newCommandId: newIdentityCommandId },
    );

    const storage = BetterAuthIdentityStorageAdapter.create({
      // better-auth's own published engine, unbound: the legacy branch delegates to it
      // verbatim, which is what makes an unlatched user's traffic unchanged.
      legacyEngine: (betterAuthOptions) =>
        prismaAdapter(database, { provider: "postgresql" })(betterAuthOptions),
      accounts: PrismaIdentityAccountsRepository.create(database),
      resolution: PrismaIdentityResolutionRepository.create(database),
      ceremonies,
      isUserOnIdentityWrites: isLatched,
      isAnyoneOnIdentityWrites: () => writeGate.isAnyoneOnIdentityWrites(),
      birth: IdentityBirthService.create({
        guards: guards.identityGuards,
        ledger,
        rows: PrismaIdentityNewbornRepository.create(database),
        reservations: guards.reservations,
        // The gate's cached answers for this user, dropped once their rows commit
        // (ADR-116 §3) — otherwise the newborn reads as unlatched for the cache TTL and
        // their first ceremony states nothing.
        forgetGate: ({ userId }) => {
          IdentityWriteGateService.forget({ userId });
        },
      }),
    });

    return new ApiBetterAuthIdentityBranch(
      storage,
      BetterAuthCeremonyBridgeAdapter.create({
        ceremonies,
        routesToIdentity: BetterAuthIdentityBirthAdapter.birthAwareGate(isLatched),
      }),
      ceremonies,
    );
  }

  private constructor(
    private readonly storageAdapter: BetterAuthIdentityStorageAdapter,
    private readonly bridge: BetterAuthCeremonyBridgeAdapter,
    private readonly ceremonies: IdentityCeremoniesAdapter,
  ) {}

  storage(): BetterAuthStoragePort {
    return ApiIdentityBetterAuthStorage.create(this.storageAdapter);
  }

  identity(): BetterAuthIdentityCeremoniesPort {
    return ApiIdentityBetterAuthCeremonies.create({
      bridge: this.bridge,
      ceremonies: this.ceremonies,
    });
  }
}

/** Better Auth's `database:` entry, as the identity storage adapter answers it. */
export class ApiIdentityBetterAuthStorage extends BetterAuthStoragePort {
  static create(adapter: BetterAuthIdentityStorageAdapter): ApiIdentityBetterAuthStorage {
    return new ApiIdentityBetterAuthStorage(adapter);
  }

  private constructor(private readonly adapterFactory: BetterAuthIdentityStorageAdapter) {
    super();
  }

  adapter(): unknown {
    return this.adapterFactory.factory();
  }
}

/**
 * The three `databaseHooks` ceremonies. The account pair goes through the bridge and the
 * user erasure does not: nothing else states an erasure, so there is nothing to defer to.
 */
export class ApiIdentityBetterAuthCeremonies extends BetterAuthIdentityCeremoniesPort {
  static create(deps: {
    bridge: BetterAuthCeremonyBridgeAdapter;
    ceremonies: IdentityCeremoniesAdapter;
  }): ApiIdentityBetterAuthCeremonies {
    return new ApiIdentityBetterAuthCeremonies(deps);
  }

  private constructor(
    private readonly deps: {
      bridge: BetterAuthCeremonyBridgeAdapter;
      ceremonies: IdentityCeremoniesAdapter;
    },
  ) {
    super();
  }

  beforeUserDelete(user: { id: string }): Promise<void> {
    return this.deps.ceremonies.beforeUserDelete(user);
  }

  tryBeforeAccountCreate(
    account: BetterAuthAccountRow,
  ): Promise<{ data: { id: string } } | undefined> {
    return this.deps.bridge.tryBeforeAccountCreate(account);
  }

  beforeAccountDelete(account: BetterAuthAccountRow): Promise<void> {
    return this.deps.bridge.beforeAccountDelete(account);
  }
}

export type ApiBetterAuthCompositionOptions = Readonly<{
  /** The deployment's browser-session identity; without it, no transport. */
  configuration: ApiBrowserSessionConfig;
  /** The typed client every database hook reads and writes through. */
  database: PrismaClient;
  /** The Auth service whose sessions this instance mints and revokes. */
  auth: BrowserSessionApi;
  /** The same user directory the rest of this process serves from. */
  users: UserApi;
  /** Better Auth's session cache lives here when this process has a Redis. */
  redis: RedisConnection | null;
  /** `"email"`, or the federated provider id this deployment mounted. */
  authProvider: string | undefined;
  /** Whether this is the hosted product rather than a self-hosted install. */
  isSaas: boolean;
  /**
   * The licence federation is gated on. Absent, this process answers that
   * federation is not licensed and says so once at boot.
   */
  licensing?: LicensingService | undefined;
  /** The grant ledger an SSO domain auto-join writes its membership through. */
  authzGrants?: AuthzGrantsService | undefined;
  /** The gateway a password-reset link leaves through. */
  mail?: ApiPasswordResetMailPort | undefined;
  /** Sign-up's address confirmation, for the passkey ceremony. */
  signUpVerification?: SignUpVerificationPort | undefined;
  /**
   * The identity pipeline this process produces commands on. With it, Better Auth's
   * storage and its three account ceremonies are the identity branch (ADR-116); without
   * it there is nothing to append to, so the stock Prisma engine and the no-op ceremonies
   * stand in and this composition says so once at boot.
   */
  identityEventing?: IdentityEventingPort | undefined;
  logger: Logger;
}>;

/**
 * Builds this deployment's Better Auth instance. Composed ONCE per process and shared.
 * Calling this twice would produce two instances over one cookie namespace, and the
 * second would be the one that happened to be asked.
 */
export function composeApiBetterAuth(options: ApiBetterAuthCompositionOptions) {
  const { configuration, logger } = options;

  if (!options.licensing) {
    logger.warn(
      "Better Auth composed no licensing store: federation reports unlicensed on this process, so single sign-on stays refused whatever licence this deployment holds",
    );
  }

  const identityBranch = options.identityEventing
    ? ApiBetterAuthIdentityBranch.compose({
        database: options.database,
        eventing: options.identityEventing,
      })
    : undefined;

  if (!identityBranch) {
    logger.warn(
      "Better Auth composed no identity pipeline: it runs the stock Prisma storage engine, and a user delete erases no identifier, an account write is not restated as an attach and an account delete detaches nothing",
    );
  }

  return createBetterAuthTransport({
    auth: options.auth,
    users: options.users,
    database: PrismaBetterAuthHooksRepository.create(options.database),
    redis: options.redis,
    storage: identityBranch?.storage() ?? ApiPrismaBetterAuthStorage.create(options.database),
    deployment: {
      baseUrl: configuration.baseUrl,
      publicBaseUrl: configuration.publicBaseUrl,
      secret: configuration.secret,
      emailPasswordEnabled: isEmailPasswordEnabled({
        authProvider: options.authProvider,
        isSaas: options.isSaas,
      }),
      mfaEnrollmentOpen: configuration.mfaEnrollmentOpen,
      passkeysEnabled: configuration.passkeysEnabled,
      passkeyHandleSecret: configuration.passkeyHandleSecret,
      // No SSO provider is mounted here: building one needs the client
      // credentials and issuer of an identity provider, and this process reads
      // none. An empty pair is the honest answer, and it is the same one the
      // licence gate above already gives.
      socialProviders: {},
      genericOAuthConfigs: [],
    },
    federation: ApiBetterAuthFederation.create({
      authProvider: options.authProvider,
      passkeysEnabled: configuration.passkeysEnabled,
      isSaas: options.isSaas,
      licensing: options.licensing,
      logger,
    }),
    identity: identityBranch?.identity() ?? AbsentApiBetterAuthIdentityCeremonies.create(),
    invites: AbsentApiBetterAuthPendingInvites.create(logger),
    announcements: LoggedApiBetterAuthAnnouncements.create(logger),
    shadow: OffApiSignInRouterShadow.create(),
    authzGrants: options.authzGrants ?? UnavailableApiBetterAuthGrants.create(),
    signUpVerification: options.signUpVerification ?? AbsentApiSignUpVerification.create(logger),
    sendResetPassword: (input) =>
      (options.mail ?? UnconfiguredApiPasswordResetMail.create()).sendResetPassword(input),
  });
}

/**
 * Names this composition's absences once, at boot, where an operator reads them.
 *
 * The storage routing and the identifier ceremonies left this list when they were
 * composed: they are the identity branch now, and a line saying otherwise told an
 * operator their enrolled users were on the legacy path when they were not.
 */
export function announceApiBetterAuthAbsences(logger: Logger): void {
  logger.warn(
    {
      absent: ["pending-invitations", "sign-in-router-shadow.api", "sso-providers"],
    },
    "Better Auth composed: this process applies no pending invitation on a domain auto-join, runs no sign-in router shadow and mounts no SSO provider",
  );
}

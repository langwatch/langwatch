import type { AuthService } from "@langwatch/auth-contract";
import {
  BetterAuthAnnouncementsPort,
  BetterAuthFederationPort,
  BetterAuthIdentityCeremoniesPort,
  BetterAuthPendingInvitePort,
  BetterAuthStoragePort,
  createBetterAuthTransport,
  isEmailPasswordEnabled,
  SignInRouterShadowPort,
  type BetterAuthAccountRow,
  type PendingOrganizationInvite,
  type SignUpVerificationPort,
} from "@langwatch/auth-server";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { RoutingDecision, SignInMethodPolicy } from "@langwatch/identity-contract";
import { resolveSignInMethodPolicy } from "@langwatch/identity-server";
import type { Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";
import type { UserService } from "@langwatch/user-contract";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { ApiBrowserSessionConfig } from "../platform/config/api.config";

/**
 * This process's own Better Auth instance — the deployment's ONE identity
 * seam, composed here rather than received.
 *
 * It used to be received, and the reason it could not be built was real: the
 * instance's option set decides whether a cookie verifies at all, so a second
 * one built from a different set verifies nothing and answers `null`, which
 * every caller reads as "signed out" rather than as a fault. What changed is
 * where the option set lives. `@langwatch/auth-server` now holds the whole
 * thing — the model mapping, the session TTL and dual-write, the credentials
 * gate, the rate-limit rules, the account-linking policy and every database
 * hook — and takes its collaborators as parameters. So there is one
 * description of the instance, and this root supplies the deployment's half of
 * it: the signing secret, the base URL, the storage engine and the plugins.
 *
 * ## What this process does not hold, said by name
 *
 * Four collaborators are absences here, and each one is a stated behaviour
 * rather than a silent default:
 *
 *  - **the event-sourced identity storage branch.** Better Auth's `database:`
 *    entry is the stock Prisma adapter. The identity branch's per-user gate
 *    ships CLOSED, so every user takes the legacy branch — the stock engine,
 *    byte for byte — which means the stock adapter IS the current production
 *    behaviour. What is absent is the ROUTING, and with it the ability to
 *    enrol a user onto event-sourced storage from this process.
 *  - **the identity ceremonies.** No attach, detach or erasure event is
 *    appended when Better Auth writes an account or deletes a user here. The
 *    account id is Better Auth's own rather than one pinned by a ceremony,
 *    which is exactly what it was before ADR-101 and is consistent with the
 *    storage absence above: nothing on the identity branch to pin it for.
 *  - **the pending-invitation lookup.** An SSO auto-join cannot apply a
 *    pending invite. Unreachable while the licence gate below denies, and
 *    named anyway so it is not discovered later as a behaviour change.
 *  - **the sign-in router shadow.** Reported `off`, which is the mode's own
 *    zero-footprint path: it returns having read nothing, computed nothing and
 *    logged nothing.
 *
 * And one refusal that is a decision rather than a gap: this process composes
 * no licensing store, so {@link ApiBetterAuthFederation} answers that
 * federation is not licensed — the same answer the identity half of the tRPC
 * record already gives, from the same reasoning. Reporting a federated mode a
 * process cannot serve would send a person to a door that does not open.
 */

/**
 * Better Auth's storage engine: the stock Prisma adapter over this process's
 * own guarded client.
 *
 * `provider` is stated rather than sniffed because the adapter uses it to
 * decide how to spell a query, and a wrong answer surfaces as a malformed
 * statement at the first sign-in rather than at boot.
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
 * ADR-027 on a process that composes no licensing store.
 *
 * `federationCapable` follows the deployment's named provider, so an
 * email-mode install leaves every route untouched exactly as it always did.
 * The licence questions both answer "not licensed", which is not a degraded
 * guess: a licence is what unlocks a federated door, and this process has
 * nowhere to read one from. The consequence is stated so it is not mistaken
 * for a bug — `ssoDomain` auto-join and every `ssoDomain` enforcement are off
 * here, which is the same posture the tRPC identity half already takes.
 */
export class ApiBetterAuthFederation extends BetterAuthFederationPort {
  static create(options: {
    authProvider: string | undefined;
    passkeysEnabled: boolean;
    isSaas: boolean;
  }): ApiBetterAuthFederation {
    return new ApiBetterAuthFederation(options);
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
    return resolveSignInMethodPolicy({
      resolveAuthProvider: () => Promise.resolve(this.deployment.authProvider ?? "email"),
      federationLicensed: () => Promise.resolve(false),
      offersPasskeys: () => this.deployment.passkeysEnabled,
      selfHosted: () => !this.deployment.isSaas,
    });
  }

  platformSsoAllowed(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/**
 * The identity ceremonies, absent.
 *
 * Every method is the no-op the legacy branch already ran: a user delete
 * erases no identifier, an account write is not restated as an attach, and its
 * id is Better Auth's own. Returning `undefined` from the account hook is what
 * leaves the row exactly as the stock adapter writes it.
 */
export class AbsentApiBetterAuthIdentityCeremonies extends BetterAuthIdentityCeremoniesPort {
  static create(): AbsentApiBetterAuthIdentityCeremonies {
    return new AbsentApiBetterAuthIdentityCeremonies();
  }

  async beforeUserDelete(): Promise<void> {}

  async beforeAccountCreate(): Promise<{ data: { id: string } } | undefined> {
    return undefined;
  }

  async beforeAccountDelete(_account: BetterAuthAccountRow): Promise<void> {}
}

/**
 * The pending-invitation lookup, absent.
 *
 * Answers "no pending invite", which sends an SSO auto-join down its default
 * membership path. Reached only when the licence gate allows federation, which
 * it does not here — so this is a name for a gap rather than a live one.
 */
export class AbsentApiBetterAuthPendingInvites extends BetterAuthPendingInvitePort {
  static create(logger: Logger): AbsentApiBetterAuthPendingInvites {
    return new AbsentApiBetterAuthPendingInvites(logger);
  }

  private constructor(private readonly logger: Logger) {
    super();
  }

  async findPendingByOrganizationAndEmail(input: {
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
 *
 * The product-analytics trail and the marketing nurturing calls are the
 * platform application's and are not composed here, so they are recorded in
 * the log rather than dropped: an operator asking why a signup produced no
 * event finds the answer instead of silence. `reportError` is a real
 * implementation — the errors it carries were caught and swallowed on purpose,
 * and a log line is where they were always meant to end up.
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
 * The sign-in router shadow, reported off.
 *
 * `mode()` is the whole switch: `off` returns before the comparison reads,
 * computes or logs anything, so this absence costs exactly what the flag
 * being off costs. `route` and `resolveAuthProvider` are never reached, and
 * refuse rather than answer, so a future mode change fails loudly here instead
 * of comparing the router against a fabricated legacy answer.
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
 *
 * A PORT rather than a call into `@langwatch/mail`, for the reason
 * {@link ApiIdentityMailPort} gives: rendering a LangWatch message is
 * react-email, and a value-import chain from a backend process to React is
 * what `frontend-boundary.unit.test.ts` exists to stop. The process states
 * what it wants said and to whom; the tier that owns the gateway renders it.
 */
export abstract class ApiPasswordResetMailPort {
  abstract sendResetPassword(input: { email: string; token: string }): Promise<void>;
}

/**
 * Password-reset mail, absent.
 *
 * REFUSES rather than resolving quietly. A reset request that reports success
 * and sends nothing leaves the person waiting on an inbox for a link that was
 * never minted, which is worse than being told the door is shut.
 */
export class UnavailableApiPasswordResetMail extends ApiPasswordResetMailPort {
  static create(): UnavailableApiPasswordResetMail {
    return new UnavailableApiPasswordResetMail();
  }

  sendResetPassword(): Promise<void> {
    return Promise.reject(
      new Error("This process composes no mail gateway, so it cannot send a password-reset link"),
    );
  }
}

/**
 * Sign-up's address confirmation, absent.
 *
 * Reached only from the passkey sign-up ceremony, and only when the passkey
 * plugin is mounted. The ceremony never awaits it and never fails over it, so
 * an absence costs the confirmation mail and nothing else — which is why it
 * logs rather than throws.
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
 * Nothing to write a grant with.
 *
 * Reached only from the SSO domain auto-join, which runs only when the licence
 * gate allows federation — and {@link ApiBetterAuthFederation} answers that it
 * does not. Refuses rather than silently skipping, because a membership
 * written with no grant beside it is a person who is "in the organization" to
 * legacy code and has zero access under authorization.
 */
export class UnavailableApiBetterAuthGrants {
  static create(): AuthzGrantsService {
    return new Proxy({} as AuthzGrantsService, {
      get() {
        return () => {
          throw new Error(
            "This process composes no grant writer for the Better Auth transport",
          );
        };
      },
    });
  }
}

export type ApiBetterAuthCompositionOptions = Readonly<{
  /** The deployment's browser-session identity; without it, no transport. */
  configuration: ApiBrowserSessionConfig;
  /** The typed client every database hook reads and writes through. */
  database: PrismaClient;
  /** The Auth service whose sessions this instance mints and revokes. */
  auth: AuthService;
  /** The same user directory the rest of this process serves from. */
  users: UserService;
  /** Better Auth's session cache lives here when this process has a Redis. */
  redis: RedisConnection | null;
  /** `"email"`, or the federated provider id this deployment mounted. */
  authProvider: string | undefined;
  /** Whether this is the hosted product rather than a self-hosted install. */
  isSaas: boolean;
  /** The grant ledger an SSO domain auto-join writes its membership through. */
  authzGrants?: AuthzGrantsService | undefined;
  /** The gateway a password-reset link leaves through. */
  mail?: ApiPasswordResetMailPort | undefined;
  /** Sign-up's address confirmation, for the passkey ceremony. */
  signUpVerification?: SignUpVerificationPort | undefined;
  logger: Logger;
}>;

/**
 * Builds this deployment's Better Auth instance.
 *
 * Composed ONCE per process and shared. Calling this twice would produce two
 * instances over one cookie namespace, and the second would be the one that
 * happened to be asked.
 */
export function composeApiBetterAuth(options: ApiBetterAuthCompositionOptions) {
  const { configuration, logger } = options;

  return createBetterAuthTransport({
    auth: options.auth,
    users: options.users,
    database: options.database,
    redis: options.redis,
    storage: ApiPrismaBetterAuthStorage.create(options.database),
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
    }),
    identity: AbsentApiBetterAuthIdentityCeremonies.create(),
    invites: AbsentApiBetterAuthPendingInvites.create(logger),
    announcements: LoggedApiBetterAuthAnnouncements.create(logger),
    shadow: OffApiSignInRouterShadow.create(),
    authzGrants: options.authzGrants ?? UnavailableApiBetterAuthGrants.create(),
    signUpVerification:
      options.signUpVerification ?? AbsentApiSignUpVerification.create(logger),
    sendResetPassword: (input) =>
      (options.mail ?? UnavailableApiPasswordResetMail.create()).sendResetPassword(input),
  });
}

/** Names this composition's absences once, at boot, where an operator reads them. */
export function announceApiBetterAuthAbsences(logger: Logger): void {
  logger.warn(
    {
      absent: [
        "identity-storage-routing",
        "identity-ceremonies",
        "pending-invitations",
        "sign-in-router-shadow",
        "sso-providers",
      ],
    },
    "Better Auth composed over the stock Prisma storage engine: this process enrols nobody onto event-sourced identity storage, appends no identifier ceremonies, applies no pending invitation on a domain auto-join, runs no sign-in router shadow and mounts no SSO provider",
  );
}

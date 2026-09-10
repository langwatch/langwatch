/**
 * The auth module's application: browser sessions, and the signed-out door
 * that stands before anybody holds one.
 *
 * One application because it is one module and one person. The door decides
 * where an address signs in, confirms it and mints the account; the session
 * half is what the browser holds afterwards, and revoking it is how every
 * other feature ends somebody's access. Splitting them left two objects
 * describing the same person's access, agreeing by attention rather than by
 * construction.
 *
 * Nothing here reads ambient state. The process supplies the counter, the
 * sign-in router, the mail gateway, the account writes and the invitation
 * reads as members, because none of them is auth's to own: the `User`,
 * `Organization` and `OrganizationInvite` tables belong to other modules, and
 * the module reaches them through their owner rather than around it.
 */
import {
  AuthApi,
  type AuthApi as AuthApiContract,
  type BrowserSession,
  type InviteLanding,
  type SignUpVerificationResult,
  type VerifiedBrowserSession,
} from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";
import type { IdentityEmailService, RoutingDecision } from "@langwatch/identity-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { nowInstant, type Instant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";
import { RedisAuthSessionCacheRepository } from "../repositories/redis/redis.auth-session-cache.repository.ts";
import type { AuthRepositories } from "../repositories/auth.repositories.ts";
import { BrowserSessionService } from "../services/browser-session.service.ts";
import {
  SignUpVerificationService,
  type SignUpAccountDirectory,
  type SignUpAccountFactory,
  type SignUpVerificationMailer,
} from "../services/signup-verification.service.ts";

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

/** What the process holds behind this module. None of it is auth's own. */
export type AuthInfrastructure = Readonly<{
  /** Better Auth caches live sessions here, so a revocation clears them too. */
  redis: RedisConnection | null;
  /** The address the identifier ledger holds for a person, where it holds one. */
  identityEmails: IdentityEmailService;
  /** The shared counter every front-door throttle meters through. */
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean }>>;
  /** Where an address signs in. The decision object IS the contract. */
  route(
    input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
  ): Promise<RoutingDecision>;
  /**
   * The sign-up ceremony, or nothing. Absent together and that is not an
   * accident: without a base URL a confirmation link points at nowhere, and
   * without a mail gateway it is never sent.
   */
  signUp: AuthSignUpCollaborators | null;
  /** The invitation reads, or nothing where this process composed none. */
  invites: AuthInviteDirectory | null;
  /** This deployment's sign-in mode, ADR-027's single source of truth. */
  authProvider(): Promise<string>;
  /** Names this process in every refusal below. */
  processName: string;
  /** Process time, injected so session expiry has deterministic tests. */
  now?: (() => Instant) | undefined;
}>;

type AuthSetup = FeatureSetup<
  typeof AuthApp.dependencies,
  AuthInfrastructure,
  undefined,
  AuthRepositories
>;

export class AuthApp implements AuthApiContract {
  static readonly contract = AuthApi;
  static readonly dependencies = { users: UserApi };

  readonly #sessions: BrowserSessionService;
  readonly #signUp: SignUpVerificationService | null;
  readonly #members: AuthInfrastructure;

  private constructor(
    sessions: BrowserSessionService,
    signUp: SignUpVerificationService | null,
    members: AuthInfrastructure,
  ) {
    this.#sessions = sessions;
    this.#signUp = signUp;
    this.#members = members;
  }

  static create(setup: AuthSetup): AuthApp {
    const { members, repositories, dependencies } = setup;
    const now = members.now ?? nowInstant;

    return new AuthApp(
      BrowserSessionService.create({
        sessions: repositories.sessions,
        cache: RedisAuthSessionCacheRepository.create({ redis: members.redis }),
        identityEmails: members.identityEmails,
        users: dependencies.users,
        now,
      }),
      signUpVerification({ members, repositories, now, users: dependencies.users }),
      members,
    );
  }

  tryResolveBrowserSession(input: {
    verified: VerifiedBrowserSession | null;
  }): Promise<BrowserSession | null> {
    return this.#sessions.tryResolveBrowserSession(input);
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

  async isWithinBudget(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<boolean> {
    return (await this.#members.rateLimit(input)).allowed;
  }

  route(
    input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
  ): Promise<RoutingDecision> {
    return this.#members.route(input);
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
    return this.#members.authProvider();
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

/**
 * A capability this deployment does not hold. `fault: "platform"` because nothing the
 * customer sent caused it, and the message names which capability and which process, so a
 * support conversation starts from the deployment shape rather than from a stack trace.
 */
export class AuthUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(input: { capability: string; processName: string }) {
    super("service_unavailable", `${input.processName} composes no ${input.capability}.`, {
      httpStatus: 503,
      fault: "platform",
      meta: { capability: input.capability },
    });
    this.name = "AuthUnavailableError";
  }
}

/** The User application: one object behind every user door this product opens. */
import { AuthApi, type AuthApi as AuthApiContract } from "@langwatch/auth-contract";
import { OpsApi, type AdminIdentity } from "@langwatch/ops-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import type {
  EnsuredPersonalWorkspace,
  FindPersonalWorkspaceInput,
  PersonalWorkspace,
  PersonalWorkspaceInput,
} from "@langwatch/organization-contract";
import type { ProjectIdentity } from "@langwatch/project-contract";
import { passwordProblem } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { ValidationError } from "@langwatch/handled-error";
import type {
  ChangeOwnPasswordInput,
  CompleteUserVerificationInput,
  CreateCredentialUserInput,
  CreatePasskeyUserInput,
  CreateUserInput,
  CreatedUser,
  UserEmailInput,
  MeProject,
  MePersonalCredential,
  MeUsage,
  RegisterCredentialAccountInput,
  RemoveUserAvatarInput,
  RotateUserPasswordInput,
  SetFirstUserPasswordInput,
  SetFirstUserPasswordResult,
  SetOwnAvatarInput,
  SetOwnFirstPasswordInput,
  SetUserAvatarInput,
  SetUserHomePathInput,
  UnlinkUserAccountInput,
  UnlinkUserAccountOutcome,
  UserAccountInfo,
  UserApiRequestBudgetIncreaseInput,
  UserAvatarCaller,
  UserAvatarMediaType,
  UserAvatarObjectRead,
  UserAvatarReadAllowance,
  UserAvatarResult,
  UserBudgetIncreaseRequested,
  UserCaller,
  UserFullProfile,
  UserHomePagePickerState,
  UserIdInput,
  UserLinkedAccount,
  UserPasskeyNudgeStatus,
  UserPasskeyOffer,
  UserPasswordRotationOutcome,
  UserPersonalBudget,
  UserPersonalContext,
  UserProfile,
  UserProfilesInput,
  UserSsoStatus,
  UserTourPreference,
  UserVerificationCompleted,
  UpdateUserProfileInput,
} from "@langwatch/user-contract";
import {
  EmailAlreadyRegisteredError,
  UserAccountAccessDeniedError,
  UserAvatarRateLimitedError,
  UserBudgetRequestNotDeliveredError,
  UserFederatedPasswordAccountMissingError,
  UserFederatedPasswordChangeUnavailableError,
  UserLastAuthenticationMethodError,
  UserLinkedAccountNotFoundError,
  UserNotOrganizationMemberError,
  UserPasswordAlreadySetError,
  UserPasswordAttemptsThrottledError,
  UserPasswordAuthUnavailableError,
  UserPasswordIncorrectError,
  UserPasswordNotSetError,
  UserRegistrationNotAvailableError,
  UserSignupThrottledError,
  UserApi,
} from "@langwatch/user-contract";
import { toDate, nowInstant, type Instant } from "@langwatch/time";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { UserRepositories } from "../repositories/user.repositories.ts";
import { UserAccountService } from "../services/user-account.service.ts";
import { UserCredentialService } from "../services/user-signin-credential.service.ts";
import { UserService } from "../services/user.service.ts";

const logger = createLogger("langwatch:user-app");

/**
 * How long "not now" lasts on the passkey offer (ADR-120). Long enough that it
 * reads as an offer rather than a nag, short enough that somebody who declined
 * on signup day is asked again once they have something worth protecting.
 */
const PASSKEY_NUDGE_INTERVAL_DAYS = 30;

/** Mirrors the hosted sign-up budget so this path is no spam side-channel. */
const SIGNUP_BUDGET = { windowSeconds: 60 * 60, max: 20 } as const;

/** A credential outlives the session that set it, so every attempt is metered. */
const PASSWORD_BUDGET = { windowSeconds: 60 * 15, max: 5 } as const;

/** Each upload writes bytes to object storage and updates the row. */
const AVATAR_UPLOAD_BUDGET = { windowSeconds: 60, max: 10 } as const;

// ─────────────────────────────────────────────────────────────────────────────
// Infrastructure: what the process holds and this module only names.
// ─────────────────────────────────────────────────────────────────────────────

/** Where an uploaded avatar's bytes go. */
export interface UserAvatarStorage {
  store(input: {
    projectId: string;
    userId: string;
    mediaType: UserAvatarMediaType;
    bytes: Uint8Array;
  }): Promise<{ id: string }>;
}

/**
 * The deployment's stored-password format, as the one operation that compares
 * a hash and the one that writes a new one. The cost factor is part of the
 * STORED format, so the process states it once and both halves run through it.
 */
export interface UserPasswordHasher {
  hash(input: { password: string }): Promise<string>;
  matches(input: { password: string; hash: string }): Promise<boolean>;
}

/** What the deployment answers about itself. */
export interface UserDeployment {
  /** `"email"`, `"auth0"`, or a federated provider name (ADR-027). */
  authProvider(): Promise<string>;
  /** Whether this deployment offers passkeys at all (ADR-120). */
  offersPasskeys(): boolean;
  /** The instance's public base URL, for the budget-increase deep link. */
  findBaseUrl(): string | null;
}

/** The shared fixed-window counter every account throttle meters through. */
export type UserRateLimiter = (
  input: Readonly<{ key: string; windowSeconds: number; max: number }>,
) => Promise<Readonly<{ allowed: boolean; resetAt: number }>>;

/** The product-analytics trail; never fatal to the request. */
export interface UserAnalytics {
  trackServerEvent(
    input: Readonly<{
      userId: string;
      event: string;
      properties?: Readonly<Record<string, unknown>>;
    }>,
  ): void;
}

/** What the identity provider can answer to a password change. */
export type UserFederatedPasswordOutcome =
  | { outcome: "changed" }
  | { outcome: "wrong_password" }
  /** The provider's own policy refused the new password; its wording. */
  | { outcome: "weak_password"; message: string }
  | { outcome: "insufficient_scope" }
  | { outcome: "password_grant_not_enabled" }
  | { outcome: "not_configured" }
  | { outcome: "failed" };

/** The identity provider this deployment federates through. */
export interface UserFederatedPasswords {
  /**
   * The provider's DATABASE identity, the only linked identity whose password
   * this deployment can change. Social identities are their upstream IdP's.
   */
  findDatabaseAccount(input: {
    userId: string;
  }): Promise<Readonly<{ providerAccountId: string }> | null>;
  changePassword(
    input: Readonly<{
      email: string;
      providerUserId: string;
      currentPassword: string;
      newPassword: string;
    }>,
  ): Promise<UserFederatedPasswordOutcome>;
}

/** The credentials a deactivation must end beside the browser sessions. */
export interface UserCliCredentials {
  revokeForUser(input: { userId: string }): Promise<void>;
}

/** The organization rows the /me dashboard reads that this module does not own. */
export interface UserOrganizationDirectory {
  isMember(input: { userId: string; organizationId: string }): Promise<boolean>;
  /** Admin-configured support contact, else the first admin's address. */
  findSupportContact(input: { organizationId: string }): Promise<string | null>;
  /** Who a budget-increase request goes to. Refuses when nobody administers. */
  getBudgetIncreaseRecipient(input: { organizationId: string }): Promise<string>;
  findName(input: { organizationId: string }): Promise<string | null>;
  /** The caller's first non-archived project in the organization, by age. */
  findFirstProjectSlug(input: { organizationId: string; userId: string }): Promise<string | null>;
}

/** The gateway budget check, at the caller's own personal workspace. */
export type UserBudgetCheckInput = Readonly<{
  organizationId: string;
  teamId: string;
  projectId: string;
  virtualKeyId: string;
  principalUserId: string;
  projectedCostUsd: number;
}>;

/** One budget the gateway weighed, as the banner and the chip read it. */
export type UserBudgetScopeDecision = Readonly<{
  scope: string;
  scopeId: string;
  spentUsd: string;
  limitUsd: string;
  window: string;
}>;

/** The gateway's own pre-check answer, at `projectedCostUsd: 0`. */
export type UserBudgetDecision = Readonly<{
  decision: string;
  scopes: readonly UserBudgetScopeDecision[];
  blockedBy: readonly UserBudgetScopeDecision[];
}>;

/** The gateway governance stores behind the /me dashboard. */
export interface UserGatewayGovernance {
  /** The routing policy a personal workspace inherits by default, if any. */
  findDefaultRoutingPolicy(input: {
    organizationId: string;
    personalTeamId: string;
  }): Promise<Readonly<{ id: string; name: string }> | null>;
  /** The caller's own gateway keys in this organization; only the id is read. */
  listPersonalVirtualKeys(input: {
    userId: string;
    organizationId: string;
  }): Promise<readonly Readonly<{ id: string }>[]>;
  checkBudget(input: UserBudgetCheckInput): Promise<UserBudgetDecision>;
}

/** The mail a budget-increase request goes out on. */
export interface UserBudgetRequestMailer {
  sendBudgetIncreaseRequest(
    input: Readonly<{
      to: string;
      requesterEmail: string;
      requesterName?: string;
      organizationName: string;
      scope: string;
      scopeId: string;
      limitUsd: string;
      spentUsd: string;
      period?: string;
      message?: string;
    }>,
  ): Promise<void>;
}

/**
 * The deployment's email-verification ceremony. It refuses a record that is not
 * pinned to `userId`, which is what makes the ids in the input safe to accept.
 */
export interface UserVerificationCeremony {
  completeEmailVerification(
    input: Readonly<{
      userId: string;
      identifierId: string;
      verificationId: string;
      token: string;
      codeVerifier: string;
    }>,
  ): Promise<unknown>;
}

/** The project a calling API key belongs to, as the process resolves one. */
export type UserKeyProject = Readonly<{
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  ownerUserId: string | null;
  teamId: string;
}>;

/** The projects `/api/me` reads: the key's own, and the org's ledger tenant. */
export interface UserProjectDirectory {
  findById(input: { projectId: string }): Promise<UserKeyProject | null>;
  /**
   * The organization's hidden governance project, where ingestion-source ledger
   * rows land. Absent where the organization never minted an ingestion source.
   */
  findGovernanceProject(input: {
    organizationId: string;
  }): Promise<Readonly<{ id: string }> | null>;
}

/**
 * One person's own AI usage, rolled up over a window. The rollup reads a spend
 * ledger this module does not own, so it crosses as a capability.
 */
export interface UserPersonalUsageReader {
  personalUsage(input: {
    personalProjectId: string;
    userId?: string;
    ingestionTenantId?: string;
    window?: { startMs: number; endMs: number };
  }): Promise<MeUsage>;
}

/** The avatar bytes, by project and content-addressed id. */
export interface UserAvatarObjects {
  findById(input: { projectId: string; id: string }): Promise<UserAvatarObjectRead>;
}

/** What the process supplies this module, once, at boot. */
export interface UserInfrastructure {
  /** The issuer every credential account row this deployment mints is stored under. */
  credentialIssuer: string;
  avatarStorage: UserAvatarStorage;
  passwords: UserPasswordHasher;
  deployment: UserDeployment;
  rateLimit: UserRateLimiter;
  analytics: UserAnalytics;
  federatedPasswords: UserFederatedPasswords;
  cliCredentials: UserCliCredentials;
  organizations: UserOrganizationDirectory;
  projects: UserProjectDirectory;
  gateway: UserGatewayGovernance;
  budgetRequests: UserBudgetRequestMailer;
  verification: UserVerificationCeremony;
  personalUsage: UserPersonalUsageReader;
  avatarObjects: UserAvatarObjects;
  now?: () => Instant;
}

/** What the process composes this module's application from. */
interface UserAppDependencies {
  auth: AuthApiContract;
  ops: OpsApi;
  organizations: OrganizationApi;
}

type UserSetup = FeatureSetup<
  {
    auth: typeof AuthApi;
    organizations: typeof OrganizationApi;
    ops: typeof OpsApi;
  },
  UserInfrastructure,
  undefined,
  UserRepositories
>;

export class UserApp implements UserApi {
  static readonly contract = UserApi;
  static readonly configSchema = undefined;
  static readonly dependencies: {
    auth: typeof AuthApi;
    organizations: typeof OrganizationApi;
    ops: typeof OpsApi;
  } = { auth: AuthApi, organizations: OrganizationApi, ops: OpsApi };

  static create({ members, dependencies, repositories }: UserSetup): UserApp {
    const now = members.now;

    return new UserApp(
      UserService.create({
        repository: repositories.users,
        organizations: dependencies.organizations,
        avatarStorage: members.avatarStorage,
        credentialIssuer: members.credentialIssuer,
        ...(now ? { now: () => toDate(now()) } : {}),
      }),
      UserCredentialService.create({
        repository: repositories.credentials,
        passwords: members.passwords,
      }),
      {
        auth: dependencies.auth,
        ops: dependencies.ops,
        organizations: dependencies.organizations,
      },
      members,
    );
  }

  readonly #users: UserService;
  readonly #credentials: UserCredentialService;
  readonly #account: UserAccountService;
  readonly #members: UserInfrastructure;

  private constructor(
    users: UserService,
    credentials: UserCredentialService,
    dependencies: UserAppDependencies,
    members: UserInfrastructure,
  ) {
    this.#users = users;
    this.#credentials = credentials;
    this.#account = UserAccountService.create(dependencies);
    this.#members = members;
  }

  /** Resolves the caller allowed to read a personal workspace. */
  personalCallerFor(input: {
    project: Pick<ProjectIdentity, "isPersonal" | "ownerUserId">;
    callerUserId: string | undefined;
  }): string {
    return this.#account.personalCallerFor(input);
  }

  // -- the account itself ----------------------------------------------------

  tryFindById(input: { id: string }): Promise<UserProfile | null> {
    return this.#users.tryFindById(input);
  }

  updateProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
    return this.#users.updateProfile(input);
  }

  getProfiles(input: UserProfilesInput): Promise<UserFullProfile[]> {
    return this.#users.getProfiles(input);
  }

  findByEmail(input: UserEmailInput): Promise<UserProfile | null> {
    return this.#users.findByEmail(input);
  }

  /** The directory mint: an account row with no sign-in method attached yet. */
  create(input: CreateUserInput): Promise<UserProfile> {
    return this.#users.create(input);
  }

  /** Everything the account screen reads about one user. */
  getAccountInfo(input: UserIdInput): Promise<UserAccountInfo> {
    return this.#users.getAccountInfo(input);
  }

  /** Whether this account signs in through an identity provider, and which. */
  getSsoStatus(input: UserIdInput): Promise<UserSsoStatus> {
    return this.#users.getSsoStatus(input);
  }

  /** Stamps the moment this user last signed in. */
  updateLastLogin(input: UserIdInput): Promise<void> {
    return this.#users.updateLastLogin(input);
  }

  /**
   * The same stamp, skipped while an operator browses as somebody: their
   * activity must not overwrite that person's own last-login time.
   */
  async recordSignIn({ caller }: { caller: UserCaller }): Promise<void> {
    if (caller.impersonated) return;

    await this.#users.updateLastLogin({ id: caller.id });
  }

  /** Whether the trace explorer's introduction is still owed to this user. */
  getTraceExplorerTourPreference(input: UserIdInput): Promise<UserTourPreference> {
    return this.#users.getTraceExplorerTourPreference(input);
  }

  /** Records that this user has seen the trace explorer's introduction. */
  dismissTraceExplorerTour(input: UserIdInput): Promise<UserTourPreference> {
    return this.#users.dismissTraceExplorerTour(input);
  }

  /**
   * Whether an identity is a platform operator. Synchronous, and it takes the
   * identity rather than an id, because that is what the operator list is.
   */
  isAdmin(identity: AdminIdentity): boolean {
    return this.#account.isAdmin(identity);
  }

  /** The same lookup from an id, resolving the address through this directory. */
  async isOperator({ userId }: { userId: string }): Promise<boolean> {
    const profile = await this.#users.tryFindById({ id: userId });

    return this.#account.isAdmin({ email: profile?.email ?? null });
  }

  // -- credentials -----------------------------------------------------------

  /** Mints an account that signs in with a password. */
  createCredentialUser(input: CreateCredentialUserInput): Promise<CreatedUser> {
    return this.#users.createCredentialUser(input);
  }

  /** Mints the account a passkey ceremony is about to register its key against. */
  createPasskeyUser(input: CreatePasskeyUserInput): Promise<CreatedUser> {
    return this.#users.createPasskeyUser(input);
  }

  /**
   * The signup form's whole path.
   *
   * Keyed off the RESOLVED provider, not the raw environment: on an SSO-capable
   * deployment with no genuine license the platform gate coerces to email mode
   * (ADR-027 Decision 4), and blocking this path would kill the fresh-signup
   * recovery route (Decision 5c).
   */
  async registerCredentialAccount(input: RegisterCredentialAccountInput): Promise<CreatedUser> {
    // The same rules the form ran, from the same module, so the two cannot
    // drift into accepting different passwords. Carried as `fieldErrors` so the
    // refusal lands on the password box rather than in a banner over it.
    const problem = passwordProblem(input.password);

    if (problem) {
      throw new ValidationError(problem, { meta: { fieldErrors: { password: [problem] } } });
    }

    // Sign-in lowercases the address on every lookup, so an account stored as
    // typed is one sign-in can never find, no matter the password.
    const email = input.email.toLowerCase();

    const emailMode = (await this.#members.deployment.authProvider()) === "email";

    if (!emailMode) throw new UserRegistrationNotAvailableError();

    await this.#meter({
      key: `user.register:${input.callerAddress}`,
      budget: SIGNUP_BUDGET,
      refuse: () => new UserSignupThrottledError(),
    });

    // Case-insensitive on purpose: rows written before the lowercasing above
    // may carry capitals, and minting a case-twin beside one would leave two
    // accounts answering for one person.
    if (await this.#users.emailIsTaken({ email })) throw new EmailAlreadyRegisteredError();

    const created = await this.#users.createCredentialUser({
      name: input.name,
      email,
      passwordHash: await this.#members.passwords.hash({ password: input.password }),
    });

    this.#members.analytics.trackServerEvent({ userId: created.id, event: "signed_up" });

    return created;
  }

  /** Whether this account can sign in with a password at all. */
  hasPassword(input: UserIdInput): Promise<boolean> {
    return this.#users.hasPassword(input);
  }

  /** Sets a first password on an account that has none. */
  setFirstPassword(input: SetFirstUserPasswordInput): Promise<SetFirstUserPasswordResult> {
    return this.#users.setFirstPassword(input);
  }

  /**
   * Fills an EMPTY credential slot and never replaces a full one.
   *
   * A stolen session can already read everything; what is worth denying it is a
   * credential that outlives the session being revoked. So the refusal below is
   * the whole endpoint's safety argument, the attempt is throttled, and every
   * other session ends the moment a password lands.
   */
  async setOwnFirstPassword(input: SetOwnFirstPasswordInput): Promise<void> {
    const problem = passwordProblem(input.password);

    if (problem) {
      throw new ValidationError(problem, { meta: { fieldErrors: { password: [problem] } } });
    }

    // Email mode only. Under a federated provider the password lives in that
    // tenant and this row is not where it would go.
    const emailMode = (await this.#members.deployment.authProvider()) === "email";

    if (!emailMode) throw new UserPasswordAuthUnavailableError();

    await this.#meter({
      key: `user.setPassword:${input.userId}`,
      budget: PASSWORD_BUDGET,
      refuse: () => new UserPasswordAttemptsThrottledError(),
    });

    const result = await this.#users.setFirstPassword({
      id: input.userId,
      passwordHash: await this.#members.passwords.hash({ password: input.password }),
    });

    if (result === "already_set") throw new UserPasswordAlreadySetError();

    await this.#endOtherSessions(input);
  }

  /**
   * Verifies the current password and replaces it.
   *
   * Throttled for both modes: this path is not behind the recent-reauthentication
   * gate the hosted change-password endpoint has, so without a budget a stolen
   * session could brute-force `currentPassword`.
   */
  async changeOwnPassword(input: ChangeOwnPasswordInput): Promise<void> {
    const provider = await this.#members.deployment.authProvider();

    // A denied SSO deployment is coerced to email mode (ADR-027), and a person
    // who recovered through the password-reset path owns a credential account
    // they must be able to change. `changeOwnPassword` demands the current
    // password, so this is no takeover vector.
    if (provider !== "email" && provider !== "auth0") throw new UserPasswordAuthUnavailableError();

    await this.#meter({
      key: `user.changePassword:${input.userId}`,
      budget: PASSWORD_BUDGET,
      refuse: () => new UserPasswordAttemptsThrottledError(),
    });

    if (provider === "auth0") {
      await this.#changeFederatedPassword(input);
      await this.#endOtherSessions(input);

      return;
    }

    // Verify-and-replace as ONE call: split into a read of the stored hash and
    // a write of its replacement, this method would be holding the hash.
    const rotation = await this.#credentials.rotatePassword({
      userId: input.userId,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });

    if (rotation === "no_password") throw new UserPasswordNotSetError();
    if (rotation === "wrong_password") throw new UserPasswordIncorrectError();

    await this.#endOtherSessions(input);
  }

  /** Whether this deployment still owes the user a passkey offer, and when. */
  getPasskeyNudgeStatus(input: UserIdInput): Promise<UserPasskeyNudgeStatus> {
    return this.#users.getPasskeyNudgeStatus(input);
  }

  /**
   * Whether to offer this person a passkey right now (ADR-120).
   *
   * Somebody who already HOLDS one is never asked, whatever they signed in with
   * today: a member on a machine that does not hold theirs has a good reason,
   * and asking them to make another is a nag with no upside.
   */
  async getPasskeyOffer(input: UserIdInput): Promise<UserPasskeyOffer> {
    const offersPasskeys = this.#members.deployment.offersPasskeys();

    if (!offersPasskeys) return { offer: false };

    const nudge = await this.#users.getPasskeyNudgeStatus(input);

    if (nudge.hasPasskey) return { offer: false };
    if (!nudge.dismissedAt) return { offer: true };

    const askAgainAfter =
      nudge.dismissedAt.getTime() + PASSKEY_NUDGE_INTERVAL_DAYS * 24 * 60 * 60_000;

    return { offer: this.#nowMs() >= askAgainAfter };
  }

  /** "Not now" on the passkey offer, dated rather than flagged. */
  dismissPasskeyNudge(input: UserIdInput): Promise<void> {
    return this.#users.dismissPasskeyNudge(input);
  }

  /**
   * Ends every browser session of one user except the one named. A password
   * outlives session revocation, so the sessions a credential write must end
   * are a property of the write rather than of the door it arrived over.
   */
  revokeOtherBrowserSessions(input: { userId: string; keepSessionId: string }): Promise<void> {
    return this.#account.revokeOtherBrowserSessions(input);
  }

  /** Ends every browser session of one user, keeping none. */
  revokeAllBrowserSessions(input: { userId: string }): Promise<void> {
    return this.#account.revokeAllBrowserSessions(input);
  }

  /** Verifies the current password and replaces it, as ONE operation. */
  rotatePassword(input: RotateUserPasswordInput): Promise<UserPasswordRotationOutcome> {
    return this.#credentials.rotatePassword(input);
  }

  /** The Auth0 database identity whose password the deployment's tenant can change. */
  findAuth0DatabaseAccount(input: {
    userId: string;
  }): Promise<{ providerAccountId: string } | null> {
    return this.#credentials.findAuth0DatabaseAccount(input);
  }

  /** Every sign-in method this person holds. */
  listLinkedAccounts(input: { userId: string }): Promise<UserLinkedAccount[]> {
    return this.#credentials.listLinkedAccounts(input);
  }

  /** Removes one sign-in method, refusing to remove the last one. */
  unlinkAccount(input: UnlinkUserAccountInput): Promise<UnlinkUserAccountOutcome> {
    return this.#credentials.unlinkAccount(input);
  }

  /**
   * The same removal, worded for the person doing it. The count and the delete
   * run in ONE serializable transaction underneath, so two concurrent unlinks
   * cannot both observe two methods and both delete.
   */
  async unlinkOwnAccount(input: UnlinkUserAccountInput): Promise<void> {
    const outcome = await this.#credentials.unlinkAccount(input);

    if (outcome === "last_account") throw new UserLastAuthenticationMethodError();
    if (outcome === "not_found") throw new UserLinkedAccountNotFoundError(input.accountId);
  }

  // -- the account's lifecycle -----------------------------------------------

  /** Retires an account. The effects that follow it are the process's. */
  deactivate(input: UserIdInput): Promise<UserProfile> {
    return this.#users.deactivate(input);
  }

  /** Restores a retired account. */
  reactivate(input: UserIdInput): Promise<UserProfile> {
    return this.#users.reactivate(input);
  }

  /**
   * Retirement is three writes, not one: the durable flag, then the two
   * credential families that would otherwise outlive it. A deactivation that
   * stopped at the flag would leave a live session and a live CLI token
   * belonging to somebody the product says is gone.
   */
  async deactivateAccount({
    userId,
    caller,
  }: {
    userId: string;
    caller: UserCaller;
  }): Promise<void> {
    if (userId !== caller.id && !(await this.isOperator({ userId: caller.operatorId }))) {
      throw new UserAccountAccessDeniedError();
    }

    await this.#users.deactivate({ id: userId });
    await this.#account.revokeAllBrowserSessions({ userId });
    await this.#members.cliCredentials.revokeForUser({ userId });
  }

  /** Restoring is an operator's call alone. */
  async reactivateAccount({
    userId,
    caller,
  }: {
    userId: string;
    caller: UserCaller;
  }): Promise<void> {
    if (!(await this.isOperator({ userId: caller.operatorId }))) {
      throw new UserAccountAccessDeniedError();
    }

    await this.#users.reactivate({ id: userId });
  }

  // -- the avatar ------------------------------------------------------------

  /** Stores an uploaded avatar under the user's personal workspace. */
  setAvatar(input: SetUserAvatarInput): Promise<UserAvatarResult> {
    return this.#users.setAvatar(input);
  }

  /**
   * The caller's own photo. The display name and address come from this
   * directory's own row rather than from the door, so both avatar entrypoints
   * name the personal workspace the same way.
   */
  async setOwnAvatar(input: SetOwnAvatarInput): Promise<UserAvatarResult> {
    const allowance = await this.#members.rateLimit({
      key: `user.setAvatar:${input.userId}`,
      ...AVATAR_UPLOAD_BUDGET,
    });

    if (!allowance.allowed) throw new UserAvatarRateLimitedError();

    const profile = await this.#users.tryFindById({ id: input.userId });

    return this.#users.setAvatar({
      userId: input.userId,
      organizationId: input.organizationId,
      imageDataUrl: input.imageDataUrl,
      displayName: profile?.name ?? null,
      displayEmail: profile?.email ?? null,
    });
  }

  /** Clears the uploaded avatar so the fallbacks apply again. */
  removeAvatar(input: RemoveUserAvatarInput): Promise<void> {
    return this.#users.removeAvatar(input);
  }

  // -- the /me dashboard -----------------------------------------------------

  /** The user's personal workspace in one organization, creating it if absent. */
  ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace> {
    return this.#account.ensurePersonalWorkspace(input);
  }

  /** The user's personal workspace in one organization, or null if none yet. */
  tryFindPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null> {
    return this.#account.tryFindPersonalWorkspace(input);
  }

  /** The path this user pinned as their home, or null if they pinned none. */
  tryGetLastHomePath(input: UserIdInput): Promise<string | null> {
    return this.#users.tryGetLastHomePath(input);
  }

  /** Pins one path as this user's home. */
  setLastHomePath(input: SetUserHomePathInput): Promise<void> {
    return this.#users.setLastHomePath(input);
  }

  /**
   * Personal context inside one organization. The workspace is provisioned
   * lazily on first read, so somebody who joined before the feature shipped
   * gets one without re-accepting an invite.
   */
  async getPersonalContext({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<UserPersonalContext> {
    await this.#assertMember({ userId, organizationId });

    const profile = await this.#users.tryFindById({ id: userId });
    const workspace = await this.#account.ensurePersonalWorkspace({
      userId,
      organizationId,
      displayName: profile?.name ?? null,
      displayEmail: profile?.email ?? null,
    });
    const policy = await this.#members.gateway.findDefaultRoutingPolicy({
      organizationId,
      personalTeamId: workspace.team.id,
    });

    return {
      workspace,
      routingPolicy: policy ? { id: policy.id, name: policy.name } : null,
    };
  }

  /**
   * The /me budget banner, delegated to the gateway's own check at a projected
   * cost of zero — the same code path a request runs — so the banner and the
   * command line's pre-check can never disagree.
   */
  async getPersonalBudget({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<UserPersonalBudget> {
    const workspace = await this.#account.tryFindPersonalWorkspace({ userId, organizationId });

    if (!workspace) return { status: "ok" };

    const keys = await this.#members.gateway.listPersonalVirtualKeys({
      userId,
      organizationId,
    });
    // OTLP-only people intentionally hold no personal gateway key. A sentinel
    // that matches no key-scoped budget keeps them on the principal scope,
    // which is what `principalUserId` resolves regardless.
    const virtualKeyId = keys[0]?.id ?? `_ingestion_:user:${userId}`;
    const decision = await this.#members.gateway.checkBudget({
      organizationId,
      teamId: workspace.team.id,
      projectId: workspace.project.id,
      virtualKeyId,
      principalUserId: userId,
      projectedCostUsd: 0,
    });
    const topScope = findTopBudgetScope(decision);

    if (!topScope) return { status: "ok" };

    return {
      status: budgetStatusOf({ decision: decision.decision, pctUsed: topScope.pctUsed }),
      scope: normalizeScope(topScope.scope),
      spentUsd: topScope.spentUsd,
      limitUsd: topScope.limitUsd,
      period: topScope.window.toLowerCase(),
      ...this.#requestIncreaseUrl(topScope),
      adminEmail: await this.#members.organizations.findSupportContact({ organizationId }),
    };
  }

  /**
   * Mails the organization's administrator the scope, the limit, the spend and
   * an optional message. Triggered from the budget-request page the gateway's
   * 402 and the command line both link to.
   */
  async requestBudgetIncrease(
    input: UserApiRequestBudgetIncreaseInput & { userId: string },
  ): Promise<UserBudgetIncreaseRequested> {
    const to = await this.#members.organizations.getBudgetIncreaseRecipient({
      organizationId: input.organizationId,
    });
    const [organizationName, requester] = await Promise.all([
      this.#members.organizations.findName({ organizationId: input.organizationId }),
      this.#users.tryFindById({ id: input.userId }),
    ]);

    try {
      await this.#members.budgetRequests.sendBudgetIncreaseRequest({
        to,
        requesterEmail: requester?.email ?? "",
        ...(requester?.name ? { requesterName: requester.name } : {}),
        organizationName: organizationName ?? "",
        scope: input.scope,
        scopeId: input.scopeId,
        limitUsd: input.limitUsd,
        spentUsd: input.spentUsd,
        ...(input.period === undefined ? {} : { period: input.period }),
        ...(input.message === undefined ? {} : { message: input.message }),
      });
    } catch (err) {
      logger.error(
        { err, organizationId: input.organizationId },
        "failed to send budget increase request email",
      );

      throw new UserBudgetRequestNotDeliveredError({
        reasons: err instanceof Error ? [err] : [],
      });
    }

    return { ok: true, sentTo: to };
  }

  /**
   * The picker's one round trip: the pinned path, and the first project the
   * auto-detected default would land on.
   */
  async getHomePagePickerState({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<UserHomePagePickerState> {
    const [lastHomePath, firstProjectSlug] = await Promise.all([
      this.#users.tryGetLastHomePath({ id: userId }),
      this.#members.organizations.findFirstProjectSlug({ organizationId, userId }),
    ]);

    return { lastHomePath, firstProjectSlug };
  }

  // -- the identity ceremony -------------------------------------------------

  /**
   * Spends an email-verification ceremony. Both proofs travel together, so a
   * link opened on its own — forwarded, or followed by a mail scanner — can
   * never verify anything.
   */
  async completeEmailVerification(
    input: CompleteUserVerificationInput,
  ): Promise<UserVerificationCompleted> {
    await this.#members.verification.completeEmailVerification(input);

    return { verified: true };
  }

  // -- the two REST doors ----------------------------------------------------

  /**
   * The personal rollup one API key may read.
   *
   * Ingestion-source ledger rows land under the organization's hidden
   * governance tenant rather than the personal project, so the union is scoped
   * to THIS organization's tenant — both to prune partitions and to keep a
   * person who belongs to several organizations from summing across them.
   */
  async getPersonalUsage({
    projectId,
    credential,
    window,
  }: {
    projectId: string;
    credential: MePersonalCredential;
    window?: { startMs: number; endMs: number };
  }): Promise<MeUsage> {
    const project = await this.#requireProject({ projectId });
    const ownerUserId = this.#account.personalUsageCallerFor({ project, credential });
    const organizationId =
      (credential.kind === "apiKey" ? credential.organizationId : null) ??
      (await this.#account.findOrganizationIdByTeamId({ teamId: project.teamId }));
    const tenant = organizationId
      ? await this.#members.projects.findGovernanceProject({ organizationId })
      : null;

    return this.#members.personalUsage.personalUsage({
      personalProjectId: project.id,
      userId: ownerUserId,
      ...(tenant ? { ingestionTenantId: tenant.id } : {}),
      ...(window ? { window } : {}),
    });
  }

  /** The identity of the project the calling API key belongs to. */
  async getKeyProject({ projectId }: { projectId: string }): Promise<MeProject> {
    const project = await this.#requireProject({ projectId });

    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      isPersonal: project.isPersonal,
    };
  }

  /**
   * Counts a caller's avatar reads, keyed on their own identity, so id probes
   * are throttled BEFORE any object is looked up.
   */
  countAvatarRead({
    caller,
    windowSeconds,
    max,
  }: {
    caller: UserAvatarCaller;
    windowSeconds: number;
    max: number;
  }): Promise<UserAvatarReadAllowance> {
    const key = caller.apiKeyProjectId ?? caller.userId;

    // The verifier sets one of the two on every request it admits; reaching
    // here with neither means that contract broke. Refuse rather than fall back
    // to a bucket every caller would share.
    if (!key) throw new Error("the avatar door resolved neither an API key nor a person");

    return this.#members.rateLimit({
      key: `user-avatar:caller:${key}`,
      windowSeconds,
      max,
    });
  }

  /** One avatar's row and, when the bytes are there, a stream of them. */
  readAvatarObject(input: { projectId: string; id: string }): Promise<UserAvatarObjectRead> {
    return this.#members.avatarObjects.findById(input);
  }

  // -- private -------------------------------------------------------------

  #nowMs(): number {
    const now = this.#members.now;

    return (now ? now() : nowInstant()).epochMilliseconds;
  }

  async #meter({
    key,
    budget,
    refuse,
  }: {
    key: string;
    budget: { windowSeconds: number; max: number };
    refuse: () => Error;
  }): Promise<void> {
    const allowance = await this.#members.rateLimit({ key, ...budget });

    if (!allowance.allowed) throw refuse();
  }

  /** A credential write ends every session but the one that made it. */
  async #endOtherSessions(input: { userId: string; keepSessionId: string | null }): Promise<void> {
    if (!input.keepSessionId) return;

    await this.#account.revokeOtherBrowserSessions({
      userId: input.userId,
      keepSessionId: input.keepSessionId,
    });
  }

  async #changeFederatedPassword(input: ChangeOwnPasswordInput): Promise<void> {
    const account = await this.#members.federatedPasswords.findDatabaseAccount({
      userId: input.userId,
    });

    if (!account) throw new UserFederatedPasswordAccountMissingError(input.userId);

    const profile = await this.#users.tryFindById({ id: input.userId });

    // Nothing the caller sent causes an account with no address, and nothing
    // they can send avoids it, so it degrades to the generic failure.
    if (!profile?.email) throw new Error("the authenticated account carries no email address");

    const result = await this.#members.federatedPasswords.changePassword({
      email: profile.email,
      providerUserId: account.providerAccountId,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });

    if (result.outcome === "changed") return;
    if (result.outcome === "wrong_password") throw new UserPasswordIncorrectError();
    // The provider's policy rejected the NEW password, and its wording is the
    // only thing that says what to fix.
    if (result.outcome === "weak_password") throw new ValidationError(result.message);

    throw new UserFederatedPasswordChangeUnavailableError(result.outcome);
  }

  /**
   * Membership, checked again after `organization:view`. The permission answers
   * "may this caller act on an organization at all"; this answers "is this one
   * theirs", which is what keeps a personal rollup inside their own tenant.
   */
  async #assertMember(input: { userId: string; organizationId: string }): Promise<void> {
    const member = await this.#members.organizations.isMember(input);

    if (member) return;

    throw new UserNotOrganizationMemberError(input.organizationId);
  }

  async #requireProject({ projectId }: { projectId: string }): Promise<UserKeyProject> {
    const project = await this.#members.projects.findById({ projectId });

    if (!project) throw new Error(`no project row for the credential's project "${projectId}"`);

    return project;
  }

  #requestIncreaseUrl(scope: {
    scope: string;
    scopeId: string;
    limitUsd: string;
    spentUsd: string;
  }): { requestIncreaseUrl?: string } {
    const baseUrl = this.#members.deployment.findBaseUrl();

    if (!baseUrl) return {};

    const params = new URLSearchParams({
      scope: normalizeScope(scope.scope),
      scope_id: scope.scopeId,
      limit_usd: scope.limitUsd,
      spent_usd: scope.spentUsd,
    });

    return { requestIncreaseUrl: `${baseUrl.replace(/\/$/, "")}/me/budget/request?${params}` };
  }
}

/** One weighed budget, with the percentage the chip renders. */
type WeighedBudgetScope = UserBudgetScopeDecision & { pctUsed: number };

/**
 * The budget the banner and the chip speak about: the blocking one where the
 * gateway named one, else the fullest. `blockedBy` carries the same scopes
 * without the derived percentage, so it is weighed the same way rather than
 * tested for the field.
 */
function findTopBudgetScope(decision: UserBudgetDecision): WeighedBudgetScope | undefined {
  const blocking = decision.blockedBy[0];

  if (blocking) return weigh(blocking);

  return decision.scopes.map(weigh).sort((a, b) => b.pctUsed - a.pctUsed)[0];
}

function weigh(scope: UserBudgetScopeDecision): WeighedBudgetScope {
  return { ...scope, pctUsed: percentUsed(scope.spentUsd, scope.limitUsd) };
}

/**
 * `hard_block` reddens the banner and `soft_warn` yellows it; `allow` still
 * carries the snapshot the chip renders, which is why "ok" is an answer with
 * numbers rather than an early return without them.
 */
function budgetStatusOf({
  decision,
  pctUsed,
}: {
  decision: string;
  pctUsed: number;
}): "ok" | "warning" | "exceeded" {
  if (decision === "hard_block") return "exceeded";
  if (decision === "soft_warn" || pctUsed >= 80) return "warning";

  return "ok";
}

function percentUsed(spentUsd: string, limitUsd: string): number {
  const limit = Number.parseFloat(limitUsd);

  if (!Number.isFinite(limit) || limit <= 0) return 0;

  return (Number.parseFloat(spentUsd) / limit) * 100;
}

/**
 * The scope codes the banner and the command line's budget box accept.
 * Virtual-key blocks read as "personal" in both.
 */
function normalizeScope(scope: string): string {
  const normalized = scope.toLowerCase();

  return normalized === "virtual_key" ? "personal" : normalized;
}

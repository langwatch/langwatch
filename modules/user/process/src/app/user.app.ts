/** The User application: one object behind every user door this product opens. */
import { AuthApi, type AuthApi as AuthApiContract } from "@langwatch/auth-contract";
import { ValidationError } from "@langwatch/handled-error";
import {
  IdentityApi,
  passwordProblem,
  type IdentityApi as IdentityApiContract,
  routesToOrganizationConnection,
} from "@langwatch/identity-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { createLogger } from "@langwatch/observability";
import { OpsApi, type AdminIdentity } from "@langwatch/ops-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import type {
  EnsuredPersonalWorkspace,
  FindPersonalWorkspaceInput,
  PersonalWorkspace,
  PersonalWorkspaceInput,
} from "@langwatch/organization-contract";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { ProjectApi, type ProjectIdentity } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";
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
  UserAvatarObjectRead,
  UserAvatarReadAllowance,
  UserAvatarResult,
  UserBrowserSession,
  UserBrowserSessionEnded,
  UserBudgetIncreaseRequested,
  UserCaller,
  UserFullProfile,
  UserHomePagePickerState,
  UserIdInput,
  UserLinkedAccount,
  UserPasskeyNudgeStatus,
  UserSecureAccountOffer,
  UserPasswordRotationOutcome,
  UserPersonalBudget,
  UserPersonalContext,
  UserProfile,
  UserProfilesInput,
  UserSsoStatus,
  UserTestArrival,
  UserTourPreference,
  UserVerificationCompleted,
  UpdateUserProfileInput,
  UserUsageCount,
} from "@langwatch/user-contract";
import {
  EmailAlreadyRegisteredError,
  ImpersonationCannotChangeCredentialsError,
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

import type { UserRepositories } from "../repositories/user.repositories.ts";
import { changeTargetsBrokeredPassword } from "../rules/password-change-target.rules.ts";
import { UserAccountService } from "../services/user-account.service.ts";
import { UserCredentialService } from "../services/user-signin-credential.service.ts";
import { UserService } from "../services/user.service.ts";
import { buildUserInfrastructure } from "./user-composition.build.ts";
import type {
  UserBudgetDecision,
  UserBudgetScopeDecision,
  UserInfrastructure,
} from "./user.members.ts";

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

/**
 * The persisted issuer of a credential account row, restated as a literal
 * because a module may not value-import another's server package (ADR-134).
 */
const CREDENTIAL_ISSUER = "local:credential";

/** The peer capabilities this module calls, resolved by the kernel at boot. */
interface UserAppDependencies {
  auth: AuthApiContract;
  identity: IdentityApiContract;
  ops: OpsApi;
  organizations: OrganizationApi;
  projects: ProjectApi;
}

/** `PASSKEYS_ENABLED` has one owner, `auth`, so this module asks that peer
 * rather than redeclaring it; `publicBaseUrl` is the process's own fact. */
type UserMembers = MembersRead<readonly ["prisma", "redis"]> &
  Readonly<{ publicBaseUrl: string | undefined }>;

/** The two flagged facts above, resolved once and threaded where `config` used to travel. */
export type UserFacts = Readonly<{ passkeysEnabled: boolean; baseUrl: string | null }>;

type UserSetup = FeatureSetup<
  typeof UserApp.dependencies,
  UserMembers,
  undefined,
  UserRepositories
>;

export class UserApp implements UserApi {
  static readonly contract = UserApi;
  /** `publicBaseUrl` is named raw: the process answers it, no store does. */
  static readonly reads = [...reads("prisma", "redis"), "publicBaseUrl"] as const;
  static readonly dependencies: {
    auth: typeof AuthApi;
    identity: typeof IdentityApi;
    organizations: typeof OrganizationApi;
    ops: typeof OpsApi;
    projects: typeof ProjectApi;
  } = {
    auth: AuthApi,
    identity: IdentityApi,
    organizations: OrganizationApi,
    ops: OpsApi,
    projects: ProjectApi,
  };

  static create(setup: UserSetup): UserApp {
    const members = buildUserInfrastructure({
      prisma: setup.members.prisma,
      redis: setup.members.redis,
      organizations: setup.dependencies.organizations,
    });

    return UserApp.#build({
      members,
      dependencies: setup.dependencies,
      repositories: setup.repositories,
      facts: {
        // Stored now, asked on first read: a peer API refuses during construction.
        get passkeysEnabled() {
          return setup.dependencies.auth.offersPasskeys();
        },
        baseUrl: setup.members.publicBaseUrl ?? null,
      },
    });
  }

  /**
   * The application over hand-supplied members, for a suite exercising the App
   * directly rather than through a booted process. Nothing here builds them —
   * the caller supplies the whole record, unlike `create`.
   */
  static createForTesting(setup: {
    repositories: UserRepositories;
    dependencies: UserAppDependencies;
    members: UserInfrastructure;
    facts: UserFacts;
  }): UserApp {
    return UserApp.#build(setup);
  }

  static #build({
    members,
    dependencies,
    repositories,
    facts,
  }: {
    members: UserInfrastructure;
    dependencies: UserAppDependencies;
    repositories: UserRepositories;
    facts: UserFacts;
  }): UserApp {
    const now = members.now;

    return new UserApp({
      users: UserService.create({
        repository: repositories.users,
        organizations: dependencies.organizations,
        avatarStorage: members.avatarStorage,
        credentialIssuer: CREDENTIAL_ISSUER,
        ...(now ? { now } : {}),
      }),
      credentials: UserCredentialService.create({
        repository: repositories.credentials,
        passwords: members.passwords,
      }),
      dependencies,
      members,
      facts,
    });
  }

  readonly #users: UserService;
  readonly #credentials: UserCredentialService;
  readonly #account: UserAccountService;
  readonly #peers: UserAppDependencies;
  readonly #members: UserInfrastructure;
  readonly #facts: UserFacts;

  private constructor({
    users,
    credentials,
    dependencies,
    members,
    facts,
  }: {
    users: UserService;
    credentials: UserCredentialService;
    dependencies: UserAppDependencies;
    members: UserInfrastructure;
    facts: UserFacts;
  }) {
    this.#users = users;
    this.#credentials = credentials;
    this.#account = UserAccountService.create(dependencies);
    this.#peers = dependencies;
    this.#members = members;
    this.#facts = facts;
  }

  /** Resolves the caller allowed to read a personal workspace. */
  personalCallerFor(input: {
    project: Pick<ProjectIdentity, "isPersonal" | "ownerUserId">;
    callerUserId: string | undefined;
  }): string {
    return this.#account.personalCallerFor(input);
  }

  // -- the account itself ----------------------------------------------------

  findById(input: { id: string }): Promise<UserProfile | null> {
    return this.#users.findById(input);
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
    const profile = await this.#users.findById({ id: userId });

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
   * The signup form's whole path. Keyed off the RESOLVED provider, not the raw
   * environment: the platform gate coerces to email mode with no license (ADR-027
   * Decision 4), and blocking this path would kill fresh-signup recovery (5c).
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

    // D09: a deployment issuing its own passwords beside its provider passes
    // too, except for an address an organization routes to its own connection.
    const emailMode = (await this.#peers.auth.resolveAuthProvider()) === "email";

    if (!emailMode && !this.#peers.auth.issuesOwnPasswords()) {
      throw new UserRegistrationNotAvailableError();
    }
    if (!emailMode && (await this.#addressRoutesToConnection(email))) {
      throw new UserRegistrationNotAvailableError();
    }

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
   * Fills an EMPTY credential slot and never replaces a full one. A stolen session can
   * already read everything; what's worth denying it is a credential that outlives the
   * session being revoked — the refusal below is the whole endpoint's safety argument.
   */
  async setOwnFirstPassword(input: SetOwnFirstPasswordInput): Promise<void> {
    // Refused before anything else: while impersonating, the account written is the
    // subject's with no proof of the current password, so without this an operator
    // could mint a durable credential on exactly the SSO-only/passkey-only accounts
    // this method exists for. `keepSessionId` being null is the defensive half of
    // the same rule.
    if (input.caller.impersonated) throw new ImpersonationCannotChangeCredentialsError();

    const problem = passwordProblem(input.password);

    if (problem) {
      throw new ValidationError(problem, { meta: { fieldErrors: { password: [problem] } } });
    }

    // Under a broker the password lives in the broker's tenant - unless the
    // deployment issues its own (D09). Either way an address an organization
    // routes through its own provider may not take a local password.
    const emailMode = (await this.#peers.auth.resolveAuthProvider()) === "email";

    if (!emailMode && !this.#peers.auth.issuesOwnPasswords()) {
      throw new UserPasswordAuthUnavailableError();
    }
    const address = (await this.#users.findById({ id: input.userId }))?.email;
    if (address && (await this.#addressRoutesToConnection(address))) {
      throw new UserPasswordAuthUnavailableError();
    }

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
   * Verifies the current password and replaces it. Throttled for both modes: this path
   * has no recent-reauthentication gate like the hosted change-password endpoint, so
   * without a budget a stolen session could brute-force `currentPassword`.
   */
  async changeOwnPassword(input: ChangeOwnPasswordInput): Promise<void> {
    // Same rule as `setOwnFirstPassword`: how an account signs in belongs to
    // its owner. Knowing the current password does not make it the operator's
    // to replace, and a replacement outlives the impersonation session.
    if (input.caller.impersonated) throw new ImpersonationCannotChangeCredentialsError();

    const provider = await this.#peers.auth.resolveAuthProvider();

    // A denied SSO deployment is coerced to email mode (ADR-027), and a person
    // who recovered through the password-reset path owns a credential account
    // they must be able to change. `changeOwnPassword` demands the current
    // password, so this is no takeover vector.
    if (provider !== "email" && provider !== "auth0" && !this.#peers.auth.issuesOwnPasswords()) {
      throw new UserPasswordAuthUnavailableError();
    }

    await this.#meter({
      key: `user.changePassword:${input.userId}`,
      budget: PASSWORD_BUDGET,
      refuse: () => new UserPasswordAttemptsThrottledError(),
    });

    const holdsOwnPassword = await this.#users.hasPassword({ id: input.userId });

    if (changeTargetsBrokeredPassword({ provider, holdsOwnPassword })) {
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

  /**
   * Whether an organization's own connection governs this address (D04). Left
   * to throw: for an address a company signs in, "could not tell" must not
   * become "here is a password".
   */
  async #addressRoutesToConnection(email: string): Promise<boolean> {
    return routesToOrganizationConnection(
      await this.#peers.auth.route({ identifier: email, breakGlass: false }),
    );
  }

  /** Whether this deployment still owes the user a passkey offer, and when. */
  getPasskeyNudgeStatus(input: UserIdInput): Promise<UserPasskeyNudgeStatus> {
    return this.#users.getPasskeyNudgeStatus(input);
  }

  /**
   * The account-security offer (ADR-120, D06): one question covering a passkey and
   * two-step verification, each gated on its own deployment switch and never for a
   * person who holds it. One dismissal covers both. specs/identity/passkeys.feature
   */
  async getPasskeyOffer(
    input: UserIdInput & { sessionId: string | null },
  ): Promise<UserSecureAccountOffer> {
    const auth = this.#peers.auth;
    const signedInWith = input.sessionId
      ? await auth.getSignedInWith({ userId: input.id, sessionId: input.sessionId })
      : "unknown";
    const nudge = await this.#users.getPasskeyNudgeStatus({ id: input.id });
    const passkey = this.#facts.passkeysEnabled && !nudge.hasPasskey;
    const twoStep = auth.offersTwoStepVerification() && !nudge.twoStepEnabled;
    if (!passkey && !twoStep) return { offer: false, passkey, twoStep, signedInWith };

    const askAgainAfter = nudge.dismissedAt
      ? nudge.dismissedAt.getTime() + PASSKEY_NUDGE_INTERVAL_DAYS * 24 * 60 * 60_000
      : 0;

    return { offer: this.#nowMs() >= askAgainAfter, passkey, twoStep, signedInWith };
  }

  /** "Not now" to the whole offer, dated rather than flagged: it comes back. */
  dismissPasskeyNudge(input: UserIdInput): Promise<void> {
    return this.#users.dismissPasskeyNudge(input);
  }

  findJoinOfferDismissedDomains(input: UserIdInput): Promise<string[]> {
    return this.#users.findJoinOfferDismissedDomains(input);
  }

  dismissJoinOffer(input: UserIdInput & { domain: string }): Promise<void> {
    return this.#users.dismissJoinOffer(input);
  }

  /**
   * What this person is signed in on. The reading half of ending a session:
   * a person who lost a laptop needs the list before the action.
   */
  listBrowserSessions(input: {
    userId: string;
    currentSessionId?: string | undefined;
  }): Promise<UserBrowserSession[]> {
    return this.#account.listBrowserSessions(input);
  }

  /** Ends ONE of this person's own browser sessions, never the current one. */
  endBrowserSession(input: {
    userId: string;
    sessionId: string;
    currentSessionId?: string | undefined;
  }): Promise<UserBrowserSessionEnded> {
    return this.#account.endBrowserSession(input);
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
   * Retirement is three writes, not one: the durable flag, then the two credential
   * families that would otherwise outlive it. Stopping at the flag would leave a live
   * session and a live CLI token belonging to somebody the product says is gone.
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

    const profile = await this.#users.findById({ id: input.userId });

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
  findPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null> {
    return this.#account.findPersonalWorkspace(input);
  }

  /** The path this user pinned as their home, or null if they pinned none. */
  findLastHomePath(input: UserIdInput): Promise<string | null> {
    return this.#users.findLastHomePath(input);
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

    const profile = await this.#users.findById({ id: userId });
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
    const workspace = await this.#account.findPersonalWorkspace({ userId, organizationId });

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
      this.#users.findById({ id: input.userId }),
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
      this.#users.findLastHomePath({ id: userId }),
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
    await this.#peers.identity.completeEmailVerification(input);

    return { verified: true };
  }

  /** Where the caller's own sign-in leaves them: identity answers from the
   *  account it left behind and the connection's own state, never the browser. */
  testArrivalStanding(input: { userId: string }): Promise<UserTestArrival> {
    return this.#peers.identity.ssoTestArrival().standingFor(input);
  }

  // -- the two REST doors ----------------------------------------------------

  /**
   * The personal rollup one API key may read, scoped to THIS organization's hidden
   * governance tenant — not the personal project — both to prune partitions and to
   * stop a person in several organizations from summing usage across them.
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
      ? await this.#members.governanceProjects.findGovernanceProject({ organizationId })
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

  countUsage(): Promise<UserUsageCount> {
    return this.#users.countUsage();
  }

  hasAccountOnDomain(input: { domain: string }): Promise<boolean> {
    return this.#users.hasAccountOnDomain(input);
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

    const profile = await this.#users.findById({ id: input.userId });

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
    const member = await this.#peers.organizations.isMember(input);

    if (member) return;

    throw new UserNotOrganizationMemberError(input.organizationId);
  }

  async #requireProject({ projectId }: { projectId: string }): Promise<ProjectIdentity> {
    const project = await this.#peers.projects.findIdentity(projectId);

    if (!project) throw new Error(`no project row for the credential's project "${projectId}"`);

    return project;
  }

  #requestIncreaseUrl(scope: {
    scope: string;
    scopeId: string;
    limitUsd: string;
    spentUsd: string;
  }): { requestIncreaseUrl?: string } {
    const baseUrl = this.#facts.baseUrl;

    if (!baseUrl) return {};

    const params = new URLSearchParams({
      scope: normalizeScope(scope.scope),
      scope_id: scope.scopeId,
      limit_usd: scope.limitUsd,
      spent_usd: scope.spentUsd,
    });

    return {
      requestIncreaseUrl: `${baseUrl.replace(/\/$/, "")}/me/budget/request?${params.toString()}`,
    };
  }
}

/** One weighed budget, with the percentage the chip renders. */
type WeighedBudgetScope = UserBudgetScopeDecision & { pctUsed: number };

/**
 * The budget the banner and the chip speak about: the blocking one where the gateway
 * named one, else the fullest. `blockedBy` carries the same scopes without the derived
 * percentage, so it's weighed the same way rather than tested for the field.
 */
function findTopBudgetScope(decision: UserBudgetDecision): WeighedBudgetScope | undefined {
  const blocking = decision.blockedBy[0];

  if (blocking) return weigh(blocking);

  return decision.scopes.map(weigh).toSorted((a, b) => b.pctUsed - a.pctUsed)[0];
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

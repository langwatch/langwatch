/** The User application: one object behind every user door this product opens. */
import { AuthApi, type AuthApi as AuthApiContract } from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { ValidationError } from "@langwatch/handled-error";
import {
  IdentityVerificationExpiredError,
  describePasswordProblem,
  routesToOrganizationConnection,
} from "@langwatch/identity-contract";
import type { MailSender } from "@langwatch/mail";
import { NotificationService } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import { OrganizationApi, SignUpRestrictedError } from "@langwatch/organization-contract";
import type {
  EnsuredPersonalWorkspace,
  FindPersonalWorkspaceInput,
  PersonalWorkspace,
  PersonalWorkspaceInput,
} from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi, type ProjectIdentity } from "@langwatch/project-contract";
import { StoredObjectApi } from "@langwatch/stored-object-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import type {
  AdoptUnconfirmedAccountOutcome,
  ChangeOwnPasswordInput,
  CreateCredentialUserInput,
  CreatePasskeyUserInput,
  CreateUserInput,
  CreatedUser,
  UserEmailInput,
  MeProject,
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
  UserAvatarResult,
  UserBrowserSession,
  UserBrowserSessionEnded,
  UserBudgetIncreaseRequested,
  UserCaller,
  UserFullProfile,
  UserHomePagePickerState,
  UserIdInput,
  UserLifecycleChangeInput,
  UserLinkedAccount,
  UserPasskeyNudgeStatus,
  UserSecureAccountOffer,
  UserPasswordRotationOutcome,
  UserProfile,
  UserProfilesInput,
  UserSsoStatus,
  UserTourPreference,
  UserCodeAccessPreference,
  UserNotificationPreference,
  UserNotificationTopicInput,
  SetUserNotificationPreferenceInput,
  UpdateUserEmailInput,
  UpdateUserProfileInput,
  UserUsageCount,
  UserAvatarRestParams,
  UserAvatarUrl,
  UserServerConfig,
} from "@langwatch/user-contract";
import {
  EmailAlreadyRegisteredError,
  ImpersonationCannotChangeCredentialsError,
  UserAccountAccessDeniedError,
  UserAvatarNotFoundError,
  UserAvatarRateLimitedError,
  UserBudgetRequestNotDeliveredError,
  UserFederatedPasswordAccountMissingError,
  UserFederatedPasswordChangeUnavailableError,
  UserLastAuthenticationMethodError,
  UserLinkedAccountNotFoundError,
  UserPasswordAlreadySetError,
  UserPasswordAttemptsThrottledError,
  UserPasswordAuthUnavailableError,
  UserPasswordIncorrectError,
  UserPasswordNotSetError,
  UserRegistrationNotAvailableError,
  UserSignupThrottledError,
  UserApi,
  userConfig,
} from "@langwatch/user-contract";

import { userBudgetRequestMailChannels } from "../channels/user-budget-request-mail-channels.registry.ts";
import type { UserBudgetRequestMailChannel } from "../channels/user-budget-request-mail.channel.ts";
import type { UserChannels } from "../channels/user.channels.ts";
import type { UserRateLimitRepository } from "../repositories/user-rate-limit.repository.ts";
import type { UserRepositories } from "../repositories/user.repositories.ts";
import { changeTargetsBrokeredPassword } from "../rules/password-change-target.rules.ts";
import { isServableUserAvatar, type ServableUserAvatar } from "../rules/user-avatar-read.rules.ts";
import type { UserFactIntent } from "../rules/user-lifecycle-outbox.rules.ts";
import { UserAccountService } from "../services/user-account.service.ts";
import { UserAvatarObjectService } from "../services/user-avatar-object.service.ts";
import {
  UserCreatedFactBackfillService,
  type UserCreatedFactBackfillReport,
  type UserCreatedFactBackfillRun,
} from "../services/user-created-fact-backfill.service.ts";
import {
  UserLifecycleNoticeService,
  type UserLifecycleSenders,
} from "../services/user-lifecycle-notice.service.ts";
import { UserOrganizationDirectoryService } from "../services/user-organization-directory.service.ts";
import { type UserPasswordHasher, UserPasswordService } from "../services/user-password.service.ts";
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

/**
 * The persisted issuer of a credential account row, restated as a literal
 * because a module may not value-import another's server package (ADR-134).
 */
const CREDENTIAL_ISSUER = "local:credential";

/** The peer capabilities this module calls, resolved by the kernel at boot. */
interface UserAppDependencies {
  auth: AuthApiContract;
  authz: AuthzApi;
  organizations: OrganizationApi;
  projects: ProjectApi;
  /** Where avatar bytes are kept, as user-owned objects in a personal project. */
  storedObjects: Pick<StoredObjectApi, "storeFromBytes" | "readById" | "getReadUrlForPurpose">;
}

/** The sign-in capability switches, read from the deployment facts auth reads (round 48, A1-a). */
export type UserFacts = Pick<
  UserServerConfig,
  "passkeysEnabled" | "mfaEnrollmentOpen" | "localPasswords"
>;

type UserSetup = FeatureSetup<
  typeof UserModule.dependencies,
  UserServerConfig,
  UserRepositories,
  UserChannels
>;

/** What `createForTesting` builds the module from; clock and hasher default to the real ones. */
type UserTestSetup = Readonly<{
  repositories: UserRepositories;
  dependencies: UserAppDependencies;
  channels: UserChannels;
  facts: UserFacts;
  budgetRequests: UserBudgetRequestMailChannel;
  passwords?: UserPasswordHasher;
  now?: () => Instant;
}>;

export class UserModule implements UserApi {
  static readonly contract = UserApi;
  static readonly config = userConfig;
  static readonly dependencies: {
    auth: typeof AuthApi;
    authz: typeof AuthzApi;
    notifications: typeof NotificationService;
    organizations: typeof OrganizationApi;
    projects: typeof ProjectApi;
    storedObjects: typeof StoredObjectApi;
  } = {
    auth: AuthApi,
    authz: AuthzApi,
    notifications: NotificationService,
    organizations: OrganizationApi,
    projects: ProjectApi,
    storedObjects: StoredObjectApi,
  };

  static create(setup: UserSetup): UserModule {
    const mailer: MailSender = {
      send: (content) => setup.dependencies.notifications.sendEmail(content),
    };

    return UserModule.#build({
      dependencies: setup.dependencies,
      channels: setup.channels,
      repositories: setup.repositories,
      budgetRequests: userBudgetRequestMailChannels.ses.create({
        mailer,
        baseUrl: setup.config.publicBaseUrl,
      }),
      facts: {
        passkeysEnabled: setup.config.passkeysEnabled,
        mfaEnrollmentOpen: setup.config.mfaEnrollmentOpen,
        localPasswords: setup.config.localPasswords,
      },
    });
  }

  /**
   * The application over a test's own repositories, peers and mail channel, for a suite
   * exercising it directly rather than through a booted process.
   */
  static createForTesting(setup: UserTestSetup): UserModule {
    return UserModule.#build(setup);
  }

  static #build({
    dependencies,
    channels,
    repositories,
    facts,
    budgetRequests,
    passwords = UserPasswordService.create(),
    now = nowInstant,
  }: UserTestSetup): UserModule {
    const lifecycle = UserLifecycleNoticeService.create();
    const avatarObjects = UserAvatarObjectService.create({
      storedObjects: dependencies.storedObjects,
    });

    return new UserModule({
      users: UserService.create({
        repository: repositories.users,
        organizations: dependencies.organizations,
        auth: { getSsoSetupStatus: (input) => channels.authReads.getSsoSetupStatus(input) },
        avatarStorage: avatarObjects,
        credentialIssuer: CREDENTIAL_ISSUER,
        now,
        platformOperators: dependencies.authz,
        lifecycle,
      }),
      lifecycle,
      createdFactBackfill: UserCreatedFactBackfillService.create({
        users: repositories.users,
        lifecycle,
      }),
      credentials: UserCredentialService.create({
        repository: repositories.credentials,
        passwords,
      }),
      directory: UserOrganizationDirectoryService.create({
        directory: repositories.organizationDirectory,
      }),
      avatarObjects,
      rateLimits: repositories.rateLimits,
      budgetRequests,
      passwords,
      now,
      dependencies,
      channels,
      facts,
    });
  }

  readonly #users: UserService;
  readonly #lifecycle: UserLifecycleNoticeService;
  readonly #createdFactBackfill: UserCreatedFactBackfillService;
  readonly #credentials: UserCredentialService;
  readonly #account: UserAccountService;
  readonly #peers: UserAppDependencies;
  readonly #authReads: UserChannels["authReads"];
  readonly #directory: UserOrganizationDirectoryService;
  readonly #avatarObjects: UserAvatarObjectService;
  readonly #rateLimits: UserRateLimitRepository;
  readonly #budgetRequests: UserBudgetRequestMailChannel;
  readonly #passwords: UserPasswordHasher;
  readonly #now: () => Instant;
  readonly #facts: UserFacts;

  private constructor(input: {
    users: UserService;
    lifecycle: UserLifecycleNoticeService;
    createdFactBackfill: UserCreatedFactBackfillService;
    credentials: UserCredentialService;
    directory: UserOrganizationDirectoryService;
    avatarObjects: UserAvatarObjectService;
    rateLimits: UserRateLimitRepository;
    budgetRequests: UserBudgetRequestMailChannel;
    passwords: UserPasswordHasher;
    now: () => Instant;
    dependencies: UserAppDependencies;
    channels: UserChannels;
    facts: UserFacts;
  }) {
    this.#users = input.users;
    this.#lifecycle = input.lifecycle;
    this.#createdFactBackfill = input.createdFactBackfill;
    this.#credentials = input.credentials;
    this.#account = UserAccountService.create(input.dependencies);
    this.#peers = input.dependencies;
    this.#authReads = input.channels.authReads;
    this.#directory = input.directory;
    this.#avatarObjects = input.avatarObjects;
    this.#rateLimits = input.rateLimits;
    this.#budgetRequests = input.budgetRequests;
    this.#passwords = input.passwords;
    this.#now = input.now;
    this.#facts = input.facts;
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

  updateEmail(input: UpdateUserEmailInput): Promise<UserProfile> {
    return this.#users.updateEmail(input);
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

  getLangyCodeAccessPreference(input: UserIdInput): Promise<UserCodeAccessPreference> {
    return this.#users.getLangyCodeAccessPreference(input);
  }

  setLangyCodeAccessPreference(input: UserIdInput & UserCodeAccessPreference): Promise<void> {
    return this.#users.setLangyCodeAccessPreference(input);
  }

  /** The person's own answer about one topic's browser notifications. */
  getNotificationPreference(
    input: UserNotificationTopicInput,
  ): Promise<UserNotificationPreference> {
    return this.#users.getNotificationPreference(input);
  }

  /** Records the person's answer about one topic's browser notifications. */
  setNotificationPreference(
    input: SetUserNotificationPreferenceInput,
  ): Promise<UserNotificationPreference> {
    return this.#users.setNotificationPreference(input);
  }

  /** Whether the account behind an id holds the platform-operator grant. */
  isOperator({ userId }: { userId: string }): Promise<boolean> {
    return this.#peers.authz.can({
      principal: { type: "user", id: userId },
      permission: "ops:manage",
      scope: { type: "platform" },
    });
  }

  // -- credentials -----------------------------------------------------------

  /** Mints an account that signs in with a password. */
  async createCredentialUser(input: CreateCredentialUserInput): Promise<CreatedUser> {
    const { id } = await this.#users.createCredentialUser(input);
    return { id };
  }

  /** Confirms an unfinished account and drops its pre-proof sign-in methods, as one step. */
  adoptUnconfirmedAccount(input: UserEmailInput): Promise<AdoptUnconfirmedAccountOutcome> {
    return this.#users.adoptUnconfirmedAccount(input);
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
    // Before anything is claimed or written: the sign-in that follows is refused on a foreign
    // origin, and an account created first would be left with nobody signed in to it.
    await this.#peers.auth.assertSignUpOrigin({ origin: input.origin, referer: input.referer });

    // The same rules the form ran, from the same module, so the two cannot
    // drift into accepting different passwords. Carried as `fieldErrors` so the
    // refusal lands on the password box rather than in a banner over it.
    const problem = describePasswordProblem(input.password);

    if (problem) {
      throw new ValidationError(problem, { meta: { fieldErrors: { password: [problem] } } });
    }

    // Sign-in lowercases the address on every lookup, so an account stored as
    // typed is one sign-in can never find, no matter the password.
    const email = input.email.toLowerCase();

    // D09: a deployment issuing its own passwords beside its provider passes
    // too, except for an address an organization routes to its own connection.
    const emailMode = (await this.#authReads.resolveAuthProvider()) === "email";

    if (!emailMode && !this.#facts.localPasswords) {
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

    // Before the proof is spent: a refused address keeps its link for the day
    // an administrator invites it.
    const verdict = await this.#peers.organizations.checkSignUp({ email });
    if (!verdict.allowed) throw new SignUpRestrictedError(verdict.reason);

    // The mailbox proof is the authority to enrol a credential, spent before
    // anything is hashed or written and bound to this exact address.
    const addressConfirmed = await this.#claimSignUpProof({ token: input.addressProof, email });

    // Case-insensitive on purpose: rows written before the lowercasing above
    // may carry capitals, and minting a case-twin beside one would leave two
    // accounts answering for one person.
    if (await this.#users.emailIsTaken({ email })) throw new EmailAlreadyRegisteredError();

    const account = {
      name: input.name,
      email,
      passwordHash: await this.#passwords.hash({ password: input.password }),
    };
    // The created and registered facts commit with the account, so a down bus never fails it.
    const created = await this.#users.registerCredentialUser({ account, addressConfirmed });

    return { id: created.id };
  }

  /**
   * Spends the sign-up proof and answers whether it confirmed the address. An unconfirmed
   * proof counts only while the installation cannot send email (ADR-117, revision 2026-09-25).
   */
  async #claimSignUpProof(proof: { token: string; email: string }): Promise<boolean> {
    if (await this.#peers.auth.claimSignUpAddressProof(proof)) return true;
    if (await this.#peers.auth.claimUnconfirmedSignUpAddressProof(proof)) return false;
    throw new IdentityVerificationExpiredError();
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

    const problem = describePasswordProblem(input.password);

    if (problem) {
      throw new ValidationError(problem, { meta: { fieldErrors: { password: [problem] } } });
    }

    // Under a broker the password lives in the broker's tenant - unless the
    // deployment issues its own (D09). Either way an address an organization
    // routes through its own provider may not take a local password.
    const emailMode = (await this.#authReads.resolveAuthProvider()) === "email";

    if (!emailMode && !this.#facts.localPasswords) {
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
      passwordHash: await this.#passwords.hash({ password: input.password }),
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

    const provider = await this.#authReads.resolveAuthProvider();

    // A denied SSO deployment is coerced to email mode (ADR-027), and a person
    // who recovered through the password-reset path owns a credential account
    // they must be able to change. `changeOwnPassword` demands the current
    // password, so this is no takeover vector.
    if (provider !== "email" && provider !== "auth0" && !this.#facts.localPasswords) {
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
      await this.#authReads.route({ identifier: email, breakGlass: false }),
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
    const signedInWith = input.sessionId
      ? await this.#authReads.getSignedInWith({ userId: input.id, sessionId: input.sessionId })
      : "unknown";
    const nudge = await this.#users.getPasskeyNudgeStatus({ id: input.id });
    const passkey = this.#facts.passkeysEnabled && !nudge.hasPasskey;
    const twoStep = this.#facts.mfaEnrollmentOpen && !nudge.twoStepEnabled;
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

  /** user_lifecycle's senders, once the pipeline registers in this process. */
  connectLifecycle(senders: UserLifecycleSenders): void {
    this.#lifecycle.connect(senders);
  }

  /** The `user:record-created-facts` step's body: every stored account recorded as created. */
  recordExistingCreatedFacts(
    input: UserCreatedFactBackfillRun,
  ): Promise<UserCreatedFactBackfillReport> {
    return this.#createdFactBackfill.recordExisting(input);
  }

  /** The fact outbox's delivery, on the worker: one committed fact recorded on user_lifecycle. */
  recordLifecycleFact(intent: UserFactIntent): Promise<void> {
    return this.#lifecycle.record(intent);
  }

  /** Retires an account in one write that refuses the last active operator; records no fact. */
  deactivate(input: UserLifecycleChangeInput): Promise<UserProfile> {
    return this.#users.deactivate(input);
  }

  recordDeactivated(input: UserLifecycleChangeInput): Promise<void> {
    return this.#users.recordDeactivated(input);
  }

  /** Restores a retired account. */
  reactivate(input: UserLifecycleChangeInput): Promise<UserProfile> {
    return this.#users.reactivate(input);
  }

  /** An operator's call alone, never while impersonating: it can restore an operator's grant. */
  async reactivateAccount({
    userId,
    caller,
  }: {
    userId: string;
    caller: UserCaller;
  }): Promise<void> {
    if (caller.impersonated || !(await this.isOperator({ userId: caller.operatorId }))) {
      throw new UserAccountAccessDeniedError();
    }

    await this.#users.reactivate({ id: userId, actor: { type: "user", id: caller.operatorId } });
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
    const allowance = await this.#rateLimits.check({
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
   * Mails the organization's administrator the scope, the limit, the spend and
   * an optional message. Triggered from the budget-request page the gateway's
   * 402 and the command line both link to.
   */
  async requestBudgetIncrease(
    input: UserApiRequestBudgetIncreaseInput & { userId: string },
  ): Promise<UserBudgetIncreaseRequested> {
    const to = await this.#directory.getBudgetIncreaseRecipient({
      organizationId: input.organizationId,
    });
    const [organizationName, requester] = await Promise.all([
      this.#directory.findName({ organizationId: input.organizationId }),
      this.#users.findById({ id: input.userId }),
    ]);

    try {
      await this.#budgetRequests.sendBudgetIncreaseRequest({
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
      this.#directory.findFirstProjectSlug({ organizationId, userId }),
    ]);

    return { lastHomePath, firstProjectSlug };
  }

  // -- the /api/me/project door ---------------------------------------------

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

  countUsageForMembers(input: { memberUserIds: readonly string[] }): Promise<UserUsageCount> {
    return this.#users.countUsageForMembers(input);
  }

  hasAccountOnDomain(input: { domain: string }): Promise<boolean> {
    return this.#users.hasAccountOnDomain(input);
  }

  hasAnyAccount(): Promise<boolean> {
    return this.#users.hasAnyAccount();
  }

  /**
   * `GET /api/user-avatar/...`: a missing row, a foreign object and lost bytes
   * earn one refusal, so the route never confirms an id exists.
   */
  async getAvatarBytes(input: { projectId: string; id: string }): Promise<ServableUserAvatar> {
    const read = await this.#avatarObjects.findById(input);
    if (!isServableUserAvatar(read)) throw new UserAvatarNotFoundError(input.id);

    return read;
  }

  /** The signed URL any signed-in person renders an uploaded avatar from. */
  getAvatarUrl(input: UserAvatarRestParams): Promise<UserAvatarUrl> {
    return this.#avatarObjects.getReadUrl({
      projectId: input.projectId,
      id: input.userAvatarId,
    });
  }

  // -- private -------------------------------------------------------------

  #nowMs(): number {
    return this.#now().epochMilliseconds;
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
    const allowance = await this.#rateLimits.check({ key, ...budget });

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
    const profile = await this.#users.findById({ id: input.userId });
    const result = await this.#peers.auth.changeFederatedPassword({
      userId: input.userId,
      email: profile?.email ?? null,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });

    if (result.outcome === "changed") return;
    if (result.outcome === "no_federated_account") {
      throw new UserFederatedPasswordAccountMissingError(input.userId);
    }
    // Nothing the caller sent causes an account with no address, and nothing
    // they can send avoids it, so it degrades to the generic failure.
    if (result.outcome === "no_address_on_record") {
      throw new Error("the authenticated account carries no email address");
    }
    if (result.outcome === "wrong_password") throw new UserPasswordIncorrectError();
    // The provider's policy rejected the NEW password, and its wording is the
    // only thing that says what to fix.
    if (result.outcome === "weak_password") throw new ValidationError(result.message);

    throw new UserFederatedPasswordChangeUnavailableError(result.outcome);
  }

  async #requireProject({ projectId }: { projectId: string }): Promise<ProjectIdentity> {
    const project = await this.#peers.projects.findIdentity(projectId);

    if (!project) throw new Error(`no project row for the credential's project "${projectId}"`);

    return project;
  }
}

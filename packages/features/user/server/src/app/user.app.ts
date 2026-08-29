/**
 * The user feature's application: what both of its doors call.
 *
 * A REST handler and a tRPC procedure are different usages — different
 * endpoints, different wire shapes, different reasons to exist — but they are
 * the same mechanism. Each declares its input, declares its access policy, and
 * then calls an operation here. Neither branches on domain state, because the
 * branch would exist twice and the two copies would answer differently the
 * first time one of them changed.
 *
 * The app is constructed once per process with the services and ports it
 * needs, and reaches a handler as `c.app`. Who is calling reaches it as
 * `c.auth`, separately: an operation takes the caller it acts for as an
 * argument rather than reading a session, so the same operation serves a
 * browser session, an API key and a background job without knowing which.
 */
import type { AuthService } from "@langwatch/auth-contract";
import { HandledError, remediation } from "@langwatch/handled-error";
import type { AdminIdentity, OpsService } from "@langwatch/ops-contract";
import type {
  EnsuredPersonalWorkspace,
  FindPersonalWorkspaceInput,
  OrganizationService,
  PersonalWorkspace,
  PersonalWorkspaceInput,
} from "@langwatch/organization-contract";
import type { ProjectIdentity } from "@langwatch/project-contract";
import type {
  CreateCredentialUserInput,
  CreatedUser,
  RemoveUserAvatarInput,
  SetFirstUserPasswordInput,
  SetFirstUserPasswordResult,
  SetUserAvatarInput,
  SetUserHomePathInput,
  UserAccountInfo,
  UserAvatarResult,
  UserIdInput,
  UserPasskeyNudgeStatus,
  UserProfile,
  UserService,
  UserSsoStatus,
  UserTourPreference,
} from "@langwatch/user-contract";

/**
 * The calling key belongs to a workspace that is not one person's.
 *
 * Handled rather than a plain `Error`: we know exactly what is wrong and the
 * caller has one step to take, which is to use the key from their own personal
 * workspace.
 */
export class PersonalProjectKeyRequiredError extends HandledError {
  declare readonly code: "personal_project_key_required";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "personal_project_key_required",
      "This endpoint requires a personal-workspace API key. Use the API key from your own personal workspace.",
      {
        httpStatus: 400,
        fault: "customer",
        ...remediation("personal_project_key_required"),
        ...options,
      },
    );
    this.name = "PersonalProjectKeyRequiredError";
  }
}

/**
 * The calling key belongs to a user who does not own the personal workspace it
 * is pointed at.
 *
 * Nothing identifies the owner, on the error or in `meta`: whose workspace this
 * is answers the very question the refusal exists to withhold.
 */
export class PersonalUsageKeyMismatchError extends HandledError {
  declare readonly code: "personal_usage_key_mismatch";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "personal_usage_key_mismatch",
      "This API key cannot read another user's personal workspace. Use a key scoped to your own personal workspace.",
      {
        httpStatus: 403,
        fault: "customer",
        ...remediation("personal_usage_key_mismatch"),
        ...options,
      },
    );
    this.name = "PersonalUsageKeyMismatchError";
  }
}

/** What the process composes this feature's application from. */
export interface UserAppDependencies {
  users: UserService;
  auth: Pick<AuthService, "revokeOtherBrowserSessions" | "revokeAllBrowserSessions">;
  ops: Pick<OpsService, "isAdmin">;
  organizations: Pick<
    OrganizationService,
    "ensurePersonalWorkspace" | "tryFindPersonalWorkspace"
  >;
}

export class UserApp {
  static create(dependencies: UserAppDependencies): UserApp {
    return new UserApp(dependencies);
  }

  private constructor(private readonly dependencies: UserAppDependencies) {}

  /**
   * The user whose data a personal-workspace read answers for.
   *
   * Both doors ask this and neither may decide it. It lived in the REST
   * framework package, which made it reachable only from REST and put a domain
   * rule in a transport; the tRPC side had no way to call it and would have
   * grown a second copy.
   *
   * The guards, and why each is a refusal rather than a guess:
   *   - A shared or team workspace names no single person, so there is nobody
   *     to roll the answer up for.
   *   - A user-bound key pointed at somebody else's personal workspace would
   *     otherwise borrow their identity. `project:view` is not enough here:
   *     the question is whose data this is, not who may look at the project.
   *
   * A legacy project key carries no user of its own. It IS that workspace's
   * key, so its holder is the owner by construction and the ownership guard
   * has nothing to compare.
   *
   * @throws {PersonalProjectKeyRequiredError} when the workspace is not personal.
   * @throws {PersonalUsageKeyMismatchError} when a user-bound key does not own it.
   */
  personalCallerFor(input: {
    project: Pick<ProjectIdentity, "isPersonal" | "ownerUserId">;
    callerUserId: string | undefined;
  }): string {
    const { isPersonal, ownerUserId } = input.project;
    if (!isPersonal || !ownerUserId) {
      throw new PersonalProjectKeyRequiredError();
    }
    if (input.callerUserId && input.callerUserId !== ownerUserId) {
      throw new PersonalUsageKeyMismatchError();
    }

    return ownerUserId;
  }

  // -- the account itself ----------------------------------------------------

  /** Everything the account screen reads about one user. */
  getAccountInfo(input: UserIdInput): Promise<UserAccountInfo> {
    return this.dependencies.users.getAccountInfo(input);
  }

  /** Whether this account signs in through an identity provider, and which. */
  getSsoStatus(input: UserIdInput): Promise<UserSsoStatus> {
    return this.dependencies.users.getSsoStatus(input);
  }

  /** Stamps the moment this user last signed in. */
  updateLastLogin(input: UserIdInput): Promise<void> {
    return this.dependencies.users.updateLastLogin(input);
  }

  /** Whether the trace explorer's introduction is still owed to this user. */
  getTraceExplorerTourPreference(input: UserIdInput): Promise<UserTourPreference> {
    return this.dependencies.users.getTraceExplorerTourPreference(input);
  }

  /** Records that this user has seen the trace explorer's introduction. */
  dismissTraceExplorerTour(input: UserIdInput): Promise<UserTourPreference> {
    return this.dependencies.users.dismissTraceExplorerTour(input);
  }

  /**
   * Whether an identity is a platform operator.
   *
   * Synchronous, and it takes the identity rather than a user id, because that
   * is what `OpsService.isAdmin` is: a lookup of an email against the
   * deployment's operator list, with no record of its own to read.
   */
  isAdmin(identity: AdminIdentity): boolean {
    return this.dependencies.ops.isAdmin(identity);
  }

  // -- credentials -----------------------------------------------------------

  /** Mints an account that signs in with a password. */
  createCredentialUser(input: CreateCredentialUserInput): Promise<CreatedUser> {
    return this.dependencies.users.createCredentialUser(input);
  }

  /** Whether this account can sign in with a password at all. */
  hasPassword(input: UserIdInput): Promise<boolean> {
    return this.dependencies.users.hasPassword(input);
  }

  /** Sets a first password on an account that has none. */
  setFirstPassword(input: SetFirstUserPasswordInput): Promise<SetFirstUserPasswordResult> {
    return this.dependencies.users.setFirstPassword(input);
  }

  /** Whether this deployment still owes the user a passkey offer, and when. */
  getPasskeyNudgeStatus(input: UserIdInput): Promise<UserPasskeyNudgeStatus> {
    return this.dependencies.users.getPasskeyNudgeStatus(input);
  }

  /** "Not now" on the passkey offer, dated rather than flagged. */
  dismissPasskeyNudge(input: UserIdInput): Promise<void> {
    return this.dependencies.users.dismissPasskeyNudge(input);
  }

  /**
   * Ends every browser session of one user except the one named.
   *
   * A password outlives the session that set it, so the sessions a credential
   * write must end are a property of the write, not of the transport it
   * arrived over.
   */
  revokeOtherBrowserSessions(input: {
    userId: string;
    keepSessionId: string;
  }): Promise<void> {
    return this.dependencies.auth.revokeOtherBrowserSessions(input);
  }

  /** Ends every browser session of one user, keeping none. */
  revokeAllBrowserSessions(input: { userId: string }): Promise<void> {
    return this.dependencies.auth.revokeAllBrowserSessions(input);
  }

  // -- the account's lifecycle -----------------------------------------------

  /** Retires an account. The effects that follow it are the process's. */
  deactivate(input: UserIdInput): Promise<UserProfile> {
    return this.dependencies.users.deactivate(input);
  }

  /** Restores a retired account. */
  reactivate(input: UserIdInput): Promise<UserProfile> {
    return this.dependencies.users.reactivate(input);
  }

  // -- the avatar ------------------------------------------------------------

  /** Stores an uploaded avatar under the user's personal workspace. */
  setAvatar(input: SetUserAvatarInput): Promise<UserAvatarResult> {
    return this.dependencies.users.setAvatar(input);
  }

  /** Clears the uploaded avatar so the fallbacks apply again. */
  removeAvatar(input: RemoveUserAvatarInput): Promise<void> {
    return this.dependencies.users.removeAvatar(input);
  }

  // -- the /me dashboard -----------------------------------------------------

  /** The user's personal workspace in one organization, creating it if absent. */
  ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace> {
    return this.dependencies.organizations.ensurePersonalWorkspace(input);
  }

  /** The user's personal workspace in one organization, or null if none yet. */
  tryFindPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null> {
    return this.dependencies.organizations.tryFindPersonalWorkspace(input);
  }

  /** The path this user pinned as their home, or null if they pinned none. */
  tryGetLastHomePath(input: UserIdInput): Promise<string | null> {
    return this.dependencies.users.tryGetLastHomePath(input);
  }

  /** Pins one path as this user's home. */
  setLastHomePath(input: SetUserHomePathInput): Promise<void> {
    return this.dependencies.users.setLastHomePath(input);
  }
}

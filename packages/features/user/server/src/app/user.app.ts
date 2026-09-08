/** The User application shared by REST and tRPC transports. */
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
import type {
  CreateCredentialUserInput,
  CreatedUser,
  RemoveUserAvatarInput,
  RotateUserPasswordInput,
  SetFirstUserPasswordInput,
  SetFirstUserPasswordResult,
  SetUserAvatarInput,
  SetUserHomePathInput,
  UnlinkUserAccountInput,
  UnlinkUserAccountOutcome,
  UserAccountInfo,
  UserAvatarResult,
  UserIdInput,
  UserFullProfile,
  UserLinkedAccount,
  UserPasswordRotationOutcome,
  UserProfilesInput,
  UserPasskeyNudgeStatus,
  UserProfile,
  UserSsoStatus,
  UserTourPreference,
  UpdateUserProfileInput,
} from "@langwatch/user-contract";
import { UserApi } from "@langwatch/user-contract";
import { toDate, type Instant } from "@langwatch/time";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { UserAvatarStoragePort, UserPasswordHasherPort } from "../ports/user.port.ts";
import type { UserRepositories } from "../repositories/user.repositories.ts";
import { UserAccountService } from "../services/user-account.service.ts";
import { UserCredentialService } from "../services/user-signin-credential.service.ts";
import { UserService } from "../services/user.service.ts";
export {
  PersonalProjectKeyRequiredError,
  PersonalUsageKeyMismatchError,
} from "../services/user-account.service.ts";

/** What the process composes this feature's application from. */
interface UserAppDependencies {
  auth: AuthApiContract;
  ops: OpsApi;
  organizations: OrganizationApi;
}

export interface UserInfrastructure {
  /** The issuer every credential account row this deployment mints is stored under. */
  credentialIssuer: string;
  avatarStorage: UserAvatarStoragePort;
  /** The deployment's stored-password format, stated once by the process. */
  passwords: UserPasswordHasherPort;
  now?: () => Instant;
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

  static create({ infrastructure, dependencies, repositories }: UserSetup): UserApp {
    const now = infrastructure.now;

    return new UserApp(
      UserService.create({
        repository: repositories.users,
        organizations: dependencies.organizations,
        avatarStorage: infrastructure.avatarStorage,
        credentialIssuer: infrastructure.credentialIssuer,
        ...(now ? { now: () => toDate(now()) } : {}),
      }),
      UserCredentialService.create({
        repository: repositories.credentials,
        passwords: infrastructure.passwords,
      }),
      {
        auth: dependencies.auth,
        ops: dependencies.ops,
        organizations: dependencies.organizations,
      },
    );
  }

  readonly #users: UserService;
  readonly #credentials: UserCredentialService;
  readonly #account: UserAccountService;

  private constructor(
    users: UserService,
    credentials: UserCredentialService,
    dependencies: UserAppDependencies,
  ) {
    this.#users = users;
    this.#credentials = credentials;
    this.#account = UserAccountService.create(dependencies);
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

  /** Whether the trace explorer's introduction is still owed to this user. */
  getTraceExplorerTourPreference(input: UserIdInput): Promise<UserTourPreference> {
    return this.#users.getTraceExplorerTourPreference(input);
  }

  /** Records that this user has seen the trace explorer's introduction. */
  dismissTraceExplorerTour(input: UserIdInput): Promise<UserTourPreference> {
    return this.#users.dismissTraceExplorerTour(input);
  }

  /**
   * Whether an identity is a platform operator.
   *
   * Synchronous, and it takes the identity rather than a user id, because that
   * is what `OpsService.isAdmin` is: a lookup of an email against the
   * deployment's operator list, with no record of its own to read.
   */
  isAdmin(identity: AdminIdentity): boolean {
    return this.#account.isAdmin(identity);
  }

  // -- credentials -----------------------------------------------------------

  /** Mints an account that signs in with a password. */
  createCredentialUser(input: CreateCredentialUserInput): Promise<CreatedUser> {
    return this.#users.createCredentialUser(input);
  }

  /** Whether this account can sign in with a password at all. */
  hasPassword(input: UserIdInput): Promise<boolean> {
    return this.#users.hasPassword(input);
  }

  /** Sets a first password on an account that has none. */
  setFirstPassword(input: SetFirstUserPasswordInput): Promise<SetFirstUserPasswordResult> {
    return this.#users.setFirstPassword(input);
  }

  /** Whether this deployment still owes the user a passkey offer, and when. */
  getPasskeyNudgeStatus(input: UserIdInput): Promise<UserPasskeyNudgeStatus> {
    return this.#users.getPasskeyNudgeStatus(input);
  }

  /** "Not now" on the passkey offer, dated rather than flagged. */
  dismissPasskeyNudge(input: UserIdInput): Promise<void> {
    return this.#users.dismissPasskeyNudge(input);
  }

  /**
   * Ends every browser session of one user except the one named.
   *
   * A password outlives the session that set it, so the sessions a credential
   * write must end are a property of the write, not of the transport it
   * arrived over.
   */
  revokeOtherBrowserSessions(input: { userId: string; keepSessionId: string }): Promise<void> {
    return this.#account.revokeOtherBrowserSessions(input);
  }

  /** Ends every browser session of one user, keeping none. */
  revokeAllBrowserSessions(input: { userId: string }): Promise<void> {
    return this.#account.revokeAllBrowserSessions(input);
  }

  /**
   * Verifies the current password and replaces it, as ONE operation.
   *
   * Split into a read of the stored hash and a write of its replacement, a
   * caller would be holding the hash. Both halves live under this operation,
   * and what crosses the boundary is the word for what happened.
   */
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

  // -- the account's lifecycle -----------------------------------------------

  /** Retires an account. The effects that follow it are the process's. */
  deactivate(input: UserIdInput): Promise<UserProfile> {
    return this.#users.deactivate(input);
  }

  /** Restores a retired account. */
  reactivate(input: UserIdInput): Promise<UserProfile> {
    return this.#users.reactivate(input);
  }

  // -- the avatar ------------------------------------------------------------

  /** Stores an uploaded avatar under the user's personal workspace. */
  setAvatar(input: SetUserAvatarInput): Promise<UserAvatarResult> {
    return this.#users.setAvatar(input);
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
}

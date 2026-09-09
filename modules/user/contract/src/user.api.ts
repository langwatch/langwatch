import { featureApi } from "@langwatch/runtime-composition";
import type {
  ChangeOwnPasswordInput,
  CompleteUserVerificationInput,
  CreateCredentialUserInput,
  CreatedUser,
  RegisterCredentialAccountInput,
  RemoveUserAvatarInput,
  RotateUserPasswordInput,
  SetOwnAvatarInput,
  SetOwnFirstPasswordInput,
  UnlinkUserAccountInput,
  UnlinkUserAccountOutcome,
  UserAvatarObjectRead,
  UserAvatarReadAllowance,
  UserCaller,
  UserLinkedAccount,
  UserPasswordRotationOutcome,
  SetFirstUserPasswordInput,
  SetFirstUserPasswordResult,
  SetUserAvatarInput,
  SetUserHomePathInput,
  UpdateUserProfileInput,
  UserAccountInfo,
  UserAvatarResult,
  UserIdInput,
  UserFullProfile,
  UserProfilesInput,
  UserPasskeyNudgeStatus,
  UserPasskeyOffer,
  UserProfile,
  UserSsoStatus,
  UserTourPreference,
  UserVerificationCompleted,
} from "./user.ts";
import type {
  MeProject,
  MePersonalCredential,
  MeUsage,
  UserAvatarCaller,
} from "./user-rest.schemas.ts";
import type {
  UserBudgetIncreaseRequested,
  UserHomePagePickerState,
  UserPersonalBudget,
  UserPersonalContext,
} from "./user.responses.ts";
import type { UserApiRequestBudgetIncreaseInput } from "./user.schemas.ts";
import type {
  EnsuredPersonalWorkspace,
  FindPersonalWorkspaceInput,
  PersonalWorkspace,
  PersonalWorkspaceInput,
} from "@langwatch/organization-contract";

/** Portable User use cases exposed to process peers and transports. */
export interface UserApi {
  tryFindById(input: { id: string }): Promise<UserProfile | null>;
  updateProfile(input: UpdateUserProfileInput): Promise<UserProfile>;
  personalCallerFor(input: {
    project: { isPersonal: boolean; ownerUserId: string | null };
    callerUserId: string | undefined;
  }): string;
  getProfiles(input: UserProfilesInput): Promise<UserFullProfile[]>;
  getAccountInfo(input: UserIdInput): Promise<UserAccountInfo>;
  getSsoStatus(input: UserIdInput): Promise<UserSsoStatus>;
  updateLastLogin(input: UserIdInput): Promise<void>;
  /** Stamps the sign-in unless an operator is browsing as this account. */
  recordSignIn(input: { caller: UserCaller }): Promise<void>;
  getTraceExplorerTourPreference(input: UserIdInput): Promise<UserTourPreference>;
  dismissTraceExplorerTour(input: UserIdInput): Promise<UserTourPreference>;
  isAdmin(identity: Readonly<{ email?: string | null }>): boolean;
  /** Whether the account behind an id is a platform operator, by its own address. */
  isOperator(input: { userId: string }): Promise<boolean>;
  createCredentialUser(input: CreateCredentialUserInput): Promise<CreatedUser>;
  /** The signup form's whole path: the mode gate, the throttle and the mint. */
  registerCredentialAccount(input: RegisterCredentialAccountInput): Promise<CreatedUser>;
  hasPassword(input: UserIdInput): Promise<boolean>;
  setFirstPassword(input: SetFirstUserPasswordInput): Promise<SetFirstUserPasswordResult>;
  /** Fills an empty credential slot, then ends every other session. */
  setOwnFirstPassword(input: SetOwnFirstPasswordInput): Promise<void>;
  /** Verifies the current password, replaces it, then ends every other session. */
  changeOwnPassword(input: ChangeOwnPasswordInput): Promise<void>;
  getPasskeyNudgeStatus(input: UserIdInput): Promise<UserPasskeyNudgeStatus>;
  /** Whether to offer this person a passkey right now (ADR-120). */
  getPasskeyOffer(input: UserIdInput): Promise<UserPasskeyOffer>;
  dismissPasskeyNudge(input: UserIdInput): Promise<void>;
  /** Verifies the current password and replaces it, as ONE operation. */
  rotatePassword(input: RotateUserPasswordInput): Promise<UserPasswordRotationOutcome>;
  /** The Auth0 database identity, or absent where the person holds only social ones. */
  findAuth0DatabaseAccount(input: {
    userId: string;
  }): Promise<{ providerAccountId: string } | null>;
  listLinkedAccounts(input: { userId: string }): Promise<UserLinkedAccount[]>;
  unlinkAccount(input: UnlinkUserAccountInput): Promise<UnlinkUserAccountOutcome>;
  /** Removes one of the caller's own sign-in methods, refusing the last one. */
  unlinkOwnAccount(input: UnlinkUserAccountInput): Promise<void>;
  revokeOtherBrowserSessions(input: { userId: string; keepSessionId: string }): Promise<void>;
  revokeAllBrowserSessions(input: { userId: string }): Promise<void>;
  deactivate(input: UserIdInput): Promise<UserProfile>;
  reactivate(input: UserIdInput): Promise<UserProfile>;
  /** Retires an account and ends every credential family that outlives it. */
  deactivateAccount(input: { userId: string; caller: UserCaller }): Promise<void>;
  /** Restores a retired account. Operators only. */
  reactivateAccount(input: { userId: string; caller: UserCaller }): Promise<void>;
  setAvatar(input: SetUserAvatarInput): Promise<UserAvatarResult>;
  /** Throttles, then stores the caller's own uploaded photo. */
  setOwnAvatar(input: SetOwnAvatarInput): Promise<UserAvatarResult>;
  removeAvatar(input: RemoveUserAvatarInput): Promise<void>;
  ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace>;
  tryFindPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null>;
  tryGetLastHomePath(input: UserIdInput): Promise<string | null>;
  setLastHomePath(input: SetUserHomePathInput): Promise<void>;

  // -- the /me dashboard -----------------------------------------------------

  getPersonalContext(input: {
    userId: string;
    organizationId: string;
  }): Promise<UserPersonalContext>;
  getPersonalBudget(input: { userId: string; organizationId: string }): Promise<UserPersonalBudget>;
  requestBudgetIncrease(
    input: UserApiRequestBudgetIncreaseInput & { userId: string },
  ): Promise<UserBudgetIncreaseRequested>;
  getHomePagePickerState(input: {
    userId: string;
    organizationId: string;
  }): Promise<UserHomePagePickerState>;

  // -- the identity ceremony -------------------------------------------------

  completeEmailVerification(
    input: CompleteUserVerificationInput,
  ): Promise<UserVerificationCompleted>;

  // -- the two REST doors ----------------------------------------------------

  /** One person's own AI usage, rolled up over a window, for `/api/me/usage`. */
  getPersonalUsage(input: {
    projectId: string;
    credential: MePersonalCredential;
    window?: { startMs: number; endMs: number };
  }): Promise<MeUsage>;
  /** The identity of the project a calling key belongs to, for `/api/me/project`. */
  getKeyProject(input: { projectId: string }): Promise<MeProject>;
  /** Counts one caller's avatar reads, before any object is looked up. */
  countAvatarRead(input: {
    caller: UserAvatarCaller;
    windowSeconds: number;
    max: number;
  }): Promise<UserAvatarReadAllowance>;
  /** One avatar's row and, when the bytes are there, a stream of them. */
  readAvatarObject(input: { projectId: string; id: string }): Promise<UserAvatarObjectRead>;
}

export const UserApi = featureApi<UserApi>("user");

import { moduleApi } from "@langwatch/module";
import type {
  EnsuredPersonalWorkspace,
  FindPersonalWorkspaceInput,
  PersonalWorkspace,
  PersonalWorkspaceInput,
} from "@langwatch/organization-contract";

import type { MeProject, UserAvatarRestParams } from "./user-rest.schemas.ts";
import type { UserBudgetIncreaseRequested, UserHomePagePickerState } from "./user.responses.ts";
import type {
  UserCodeAccessPreference,
  UserApiRequestBudgetIncreaseInput,
} from "./user.schemas.ts";
import type {
  AdoptUnconfirmedAccountOutcome,
  CreateCredentialUserInput,
  CreatePasskeyUserInput,
  CreateUserInput,
  CreatedUser,
  CredentialAccountInput,
  RemoveUserAvatarInput,
  RotateUserPasswordInput,
  SetOwnAvatarInput,
  UnlinkUserAccountInput,
  UnlinkUserAccountOutcome,
  UserCaller,
  UserEmailInput,
  UserLinkedAccount,
  UserPasswordRotationOutcome,
  SetFirstUserPasswordInput,
  SetFirstUserPasswordResult,
  SetUserAvatarInput,
  SetUserHomePathInput,
  UpdateUserEmailInput,
  UpdateUserProfileInput,
  UserAccountInfo,
  UserAvatarResult,
  UserAvatarUrl,
  UserIdInput,
  UserLifecycleChangeInput,
  UserFullProfile,
  UserProfilesInput,
  UserPasskeyNudgeStatus,
  UserSecureAccountOffer,
  UserProfile,
  UserSsoStatus,
  UserTourPreference,
  UserNotificationPreference,
  UserNotificationTopicInput,
  SetUserNotificationPreferenceInput,
} from "./user.ts";

/**
 * What the install-wide usage report counts here (ADR-156, section 10): the
 * people on the install by the domain of their address, counted in the
 * database so no address is ever read out.
 */
export interface UserUsageCount {
  readonly emailDomains: Readonly<Record<string, number>>;
}

/** Portable User use cases exposed to process peers and transports. */
export interface UserApi {
  findById(input: { id: string }): Promise<UserProfile | null>;
  /** Changes the name only; an address change is `updateEmail`, behind auth's door. */
  updateProfile(input: UpdateUserProfileInput): Promise<UserProfile>;
  /** Writes a normalized address and nothing else; auth's door ends the sessions after it. */
  updateEmail(input: UpdateUserEmailInput): Promise<UserProfile>;
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
  getLangyCodeAccessPreference(input: UserIdInput): Promise<UserCodeAccessPreference>;
  setLangyCodeAccessPreference(input: UserIdInput & UserCodeAccessPreference): Promise<void>;
  /** The person's own answer about one topic's browser notifications. */
  getNotificationPreference(input: UserNotificationTopicInput): Promise<UserNotificationPreference>;
  setNotificationPreference(
    input: SetUserNotificationPreferenceInput,
  ): Promise<UserNotificationPreference>;
  /** Whether the account behind an id holds the platform-operator grant. */
  isOperator(input: { userId: string }): Promise<boolean>;
  /** The account an address belongs to, ignoring case; the exact address wins over case-twins. */
  findByEmail(input: UserEmailInput): Promise<UserProfile | null>;
  /** Mints a directory account with no sign-in method of its own. */
  create(input: CreateUserInput): Promise<UserProfile>;
  createCredentialUser(input: CreateCredentialUserInput): Promise<CreatedUser>;
  /** Mints an account whose only sign-in method is the passkey about to be registered. */
  createPasskeyUser(input: CreatePasskeyUserInput): Promise<CreatedUser>;
  /**
   * An address proof adopts the unfinished account on it: one transaction confirms the address
   * and drops every sign-in method set before the proof; memberships stay (rulings 2026-10-06).
   */
  adoptUnconfirmedAccount(input: UserEmailInput): Promise<AdoptUnconfirmedAccountOutcome>;
  /** Mints the account auth's register door cleared, its address proof already spent (D-A1U-2). */
  registerCredentialAccount(input: CredentialAccountInput): Promise<CreatedUser>;
  hasPassword(input: UserIdInput): Promise<boolean>;
  setFirstPassword(input: SetFirstUserPasswordInput): Promise<SetFirstUserPasswordResult>;
  getPasskeyNudgeStatus(input: UserIdInput): Promise<UserPasskeyNudgeStatus>;
  /** Whether to offer this person a passkey or two-step verification now, on this session. */
  getPasskeyOffer(
    input: UserIdInput & { sessionId: string | null },
  ): Promise<UserSecureAccountOffer>;
  dismissPasskeyNudge(input: UserIdInput): Promise<void>;
  /** The company domains this person said "no thanks" to being offered (D12). */
  findJoinOfferDismissedDomains(input: UserIdInput): Promise<string[]>;
  /** Remembers a "no thanks" for one domain; saying it twice changes nothing. */
  dismissJoinOffer(input: UserIdInput & { domain: string }): Promise<void>;
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
  /** Retires an account, never the last active operator, in one write; records no fact. */
  deactivate(input: UserLifecycleChangeInput): Promise<UserProfile>;
  /** Records a written retirement as user's fact, at the instant the database stamped. */
  recordDeactivated(input: UserLifecycleChangeInput): Promise<void>;
  reactivate(input: UserLifecycleChangeInput): Promise<UserProfile>;
  /** Restores a retired account. Operators only. */
  reactivateAccount(input: { userId: string; caller: UserCaller }): Promise<void>;
  setAvatar(input: SetUserAvatarInput): Promise<UserAvatarResult>;
  /** Throttles, then stores the caller's own uploaded photo. */
  setOwnAvatar(input: SetOwnAvatarInput): Promise<UserAvatarResult>;
  removeAvatar(input: RemoveUserAvatarInput): Promise<void>;
  /** A signed URL for an uploaded avatar; anything that is not one is refused as not found. */
  getAvatarUrl(input: UserAvatarRestParams): Promise<UserAvatarUrl>;
  ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace>;
  findPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null>;
  findLastHomePath(input: UserIdInput): Promise<string | null>;
  setLastHomePath(input: SetUserHomePathInput): Promise<void>;

  // -- the /me dashboard -----------------------------------------------------

  requestBudgetIncrease(
    input: UserApiRequestBudgetIncreaseInput & { userId: string },
  ): Promise<UserBudgetIncreaseRequested>;
  getHomePagePickerState(input: {
    userId: string;
    organizationId: string;
  }): Promise<UserHomePagePickerState>;

  // -- the /api/me/project door ---------------------------------------------

  /** The identity of the project a calling key belongs to, for `/api/me/project`. */
  getKeyProject(input: { projectId: string }): Promise<MeProject>;
  /** The usage report's figures (ADR-156, section 10). */
  countUsage(): Promise<UserUsageCount>;
  /** The same figures for one organization, counted over the members the caller names. */
  countUsageForMembers(input: { memberUserIds: readonly string[] }): Promise<UserUsageCount>;
  /** Whether anybody with an address on this domain has an account; no address leaves. */
  hasAccountOnDomain(input: { domain: string }): Promise<boolean>;
  /** Whether the installation holds any account at all; false only on a fresh install. */
  hasAnyAccount(): Promise<boolean>;
}

export const UserApi = moduleApi<UserApi>()("user");

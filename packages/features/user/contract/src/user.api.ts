import { featureApi } from "@langwatch/runtime-composition";
import type {
  CreateCredentialUserInput,
  CreatedUser,
  RemoveUserAvatarInput,
  RotateUserPasswordInput,
  UnlinkUserAccountInput,
  UnlinkUserAccountOutcome,
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
  UserProfile,
  UserSsoStatus,
  UserTourPreference,
} from "./user.ts";
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
  getTraceExplorerTourPreference(input: UserIdInput): Promise<UserTourPreference>;
  dismissTraceExplorerTour(input: UserIdInput): Promise<UserTourPreference>;
  isAdmin(identity: Readonly<{ email?: string | null }>): boolean;
  createCredentialUser(input: CreateCredentialUserInput): Promise<CreatedUser>;
  hasPassword(input: UserIdInput): Promise<boolean>;
  setFirstPassword(input: SetFirstUserPasswordInput): Promise<SetFirstUserPasswordResult>;
  getPasskeyNudgeStatus(input: UserIdInput): Promise<UserPasskeyNudgeStatus>;
  dismissPasskeyNudge(input: UserIdInput): Promise<void>;
  /** Verifies the current password and replaces it, as ONE operation. */
  rotatePassword(input: RotateUserPasswordInput): Promise<UserPasswordRotationOutcome>;
  /** The Auth0 database identity, or absent where the person holds only social ones. */
  findAuth0DatabaseAccount(input: {
    userId: string;
  }): Promise<{ providerAccountId: string } | null>;
  listLinkedAccounts(input: { userId: string }): Promise<UserLinkedAccount[]>;
  unlinkAccount(input: UnlinkUserAccountInput): Promise<UnlinkUserAccountOutcome>;
  revokeOtherBrowserSessions(input: { userId: string; keepSessionId: string }): Promise<void>;
  revokeAllBrowserSessions(input: { userId: string }): Promise<void>;
  deactivate(input: UserIdInput): Promise<UserProfile>;
  reactivate(input: UserIdInput): Promise<UserProfile>;
  setAvatar(input: SetUserAvatarInput): Promise<UserAvatarResult>;
  removeAvatar(input: RemoveUserAvatarInput): Promise<void>;
  ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace>;
  tryFindPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null>;
  tryGetLastHomePath(input: UserIdInput): Promise<string | null>;
  setLastHomePath(input: SetUserHomePathInput): Promise<void>;
}

export const UserApi = featureApi<UserApi>("user");

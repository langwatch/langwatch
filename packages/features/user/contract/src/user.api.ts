import { featureApi } from "@langwatch/runtime-composition";
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

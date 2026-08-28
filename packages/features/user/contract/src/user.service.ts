import type {
  CreateUserInput,
  CreateCredentialUserInput,
  CreatePasskeyUserInput,
  RemoveUserAvatarInput,
  SetUserAvatarInput,
  SetUserHomePathInput,
  UpdateUserProfileInput,
  UserAccountInfo,
  UserAvatarResult,
  UserEmailInput,
  UserFullProfile,
  UserIdInput,
  UserProfile,
  UserProfilesInput,
  UserSsoStatus,
  UserTourPreference,
  CreatedUser,
} from "./user";

export abstract class UserService {
  /** Returns every existing profile among the requested user IDs. */
  abstract getProfiles(input: UserProfilesInput): Promise<UserFullProfile[]>;
  abstract tryFindById(input: UserIdInput): Promise<UserProfile | null>;
  abstract tryFindByEmail(input: UserEmailInput): Promise<UserProfile | null>;
  abstract create(input: CreateUserInput): Promise<UserProfile>;
  abstract createCredentialUser(input: CreateCredentialUserInput): Promise<CreatedUser>;
  abstract createPasskeyUser(input: CreatePasskeyUserInput): Promise<CreatedUser>;
  abstract hasPassword(input: UserIdInput): Promise<boolean>;
  abstract updateProfile(input: UpdateUserProfileInput): Promise<UserProfile>;
  abstract getAccountInfo(input: UserIdInput): Promise<UserAccountInfo>;
  abstract getSsoStatus(input: UserIdInput): Promise<UserSsoStatus>;
  abstract getTraceExplorerTourPreference(input: UserIdInput): Promise<UserTourPreference>;
  abstract dismissTraceExplorerTour(input: UserIdInput): Promise<UserTourPreference>;
  abstract updateLastLogin(input: UserIdInput): Promise<void>;
  abstract tryGetLastHomePath(input: UserIdInput): Promise<string | null>;
  abstract setLastHomePath(input: SetUserHomePathInput): Promise<void>;
  abstract deactivate(input: UserIdInput): Promise<UserProfile>;
  abstract reactivate(input: UserIdInput): Promise<UserProfile>;
  abstract setAvatar(input: SetUserAvatarInput): Promise<UserAvatarResult>;
  abstract removeAvatar(input: RemoveUserAvatarInput): Promise<void>;
}

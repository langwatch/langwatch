import type {
  CreateUserInput,
  RemoveUserAvatarInput,
  SetUserAvatarInput,
  SetUserHomePathInput,
  UpdateUserProfileInput,
  UserAccountInfo,
  UserAvatarResult,
  UserEmailInput,
  UserIdInput,
  UserProfile,
  UserSsoStatus,
  UserTourPreference,
} from "./user";

export abstract class UserService {
  abstract tryFindById(input: UserIdInput): Promise<UserProfile | null>;
  abstract tryFindByEmail(input: UserEmailInput): Promise<UserProfile | null>;
  abstract create(input: CreateUserInput): Promise<UserProfile>;
  abstract updateProfile(input: UpdateUserProfileInput): Promise<UserProfile>;
  abstract getAccountInfo(input: UserIdInput): Promise<UserAccountInfo>;
  abstract getSsoStatus(input: UserIdInput): Promise<UserSsoStatus>;
  abstract getTraceExplorerTourPreference(
    input: UserIdInput,
  ): Promise<UserTourPreference>;
  abstract dismissTraceExplorerTour(input: UserIdInput): Promise<UserTourPreference>;
  abstract updateLastLogin(input: UserIdInput): Promise<void>;
  abstract getLastHomePath(input: UserIdInput): Promise<string | null>;
  abstract setLastHomePath(input: SetUserHomePathInput): Promise<void>;
  abstract deactivate(input: UserIdInput): Promise<UserProfile>;
  abstract reactivate(input: UserIdInput): Promise<UserProfile>;
  abstract setAvatar(input: SetUserAvatarInput): Promise<UserAvatarResult>;
  abstract removeAvatar(input: RemoveUserAvatarInput): Promise<void>;
}

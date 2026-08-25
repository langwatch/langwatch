import type {
  CreateUserInput,
  UpdateUserProfileInput,
  UserAccountInfo,
  UserFullProfile,
  UserProfile,
  UserSsoStatus,
  UserTourPreference,
} from "@langwatch/user-contract";

/** Persistence owned by User. It never crosses the feature boundary. */
export abstract class UserRepository {
  abstract getProfiles(userIds: string[]): Promise<UserFullProfile[]>;
  abstract tryFindById(id: string): Promise<UserProfile | null>;
  abstract tryFindByEmail(email: string): Promise<UserProfile | null>;
  abstract create(input: CreateUserInput): Promise<UserProfile>;
  abstract updateProfile(input: UpdateUserProfileInput): Promise<UserProfile>;
  abstract tryGetAccountInfo(id: string): Promise<UserAccountInfo | null>;
  abstract getSsoStatus(id: string): Promise<UserSsoStatus>;
  abstract getTraceExplorerTourPreference(id: string): Promise<UserTourPreference>;
  abstract setTraceExplorerTourDismissedAt(
    id: string,
    dismissedAt: Date,
  ): Promise<UserTourPreference>;
  abstract setLastLoginAt(id: string, lastLoginAt: Date): Promise<void>;
  abstract getLastHomePath(id: string): Promise<string | null>;
  abstract setLastHomePath(id: string, path: string | null): Promise<void>;
  abstract setDeactivatedAt(id: string, deactivatedAt: Date | null): Promise<UserProfile>;
  abstract setAvatar(id: string, image: string | null): Promise<void>;
}

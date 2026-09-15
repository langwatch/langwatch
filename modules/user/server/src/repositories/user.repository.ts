import type {
  CreateUserInput,
  CreateCredentialUserInput,
  CreatePasskeyUserInput,
  CreatedUser,
  SetFirstUserPasswordInput,
  SetFirstUserPasswordResult,
  UpdateUserProfileInput,
  UserAccountInfo,
  UserFullProfile,
  UserPasskeyNudgeStatus,
  UserProfile,
  UserSsoStatus,
  UserTourPreference,
} from "@langwatch/user-contract";

/**
 * The issuer a credential account row is stored under.
 *
 * It travels with the write rather than being held by the repository, because
 * a repository is built from the connection alone: the deployment states the
 * issuer once and the app carries it down to the three writes that mint a row.
 */
export type UserCredentialIssuer = Readonly<{ issuer: string }>;

export type CreateCredentialUserRow = CreateCredentialUserInput & UserCredentialIssuer;
export type CreatePasskeyUserRow = CreatePasskeyUserInput & UserCredentialIssuer;
export type SetFirstUserPasswordRow = SetFirstUserPasswordInput & UserCredentialIssuer;

/** Persistence owned by User. It never crosses the feature boundary. */
export interface UserRepository {
  getProfiles(userIds: string[]): Promise<UserFullProfile[]>;
  findById(id: string): Promise<UserProfile | null>;
  findByEmail(email: string): Promise<UserProfile | null>;
  /** The same lookup ignoring case, for rows written before sign-in lowercased. */
  findByEmailInsensitive(email: string): Promise<UserProfile | null>;
  create(input: CreateUserInput): Promise<UserProfile>;
  createCredentialUser(input: CreateCredentialUserRow): Promise<CreatedUser>;
  createPasskeyUser(input: CreatePasskeyUserRow): Promise<CreatedUser>;
  hasPassword(id: string): Promise<boolean>;
  setFirstPassword(input: SetFirstUserPasswordRow): Promise<SetFirstUserPasswordResult>;
  getPasskeyNudgeStatus(id: string): Promise<UserPasskeyNudgeStatus>;
  setPasskeyNudgeDismissedAt(input: { id: string; dismissedAt: Date }): Promise<void>;
  updateProfile(input: UpdateUserProfileInput): Promise<UserProfile>;
  findAccountInfo(id: string): Promise<UserAccountInfo | null>;
  getSsoStatus(id: string): Promise<UserSsoStatus>;
  getTraceExplorerTourPreference(id: string): Promise<UserTourPreference>;
  setTraceExplorerTourDismissedAt(input: {
    id: string;
    dismissedAt: Date;
  }): Promise<UserTourPreference>;
  setLastLoginAt(input: { id: string; lastLoginAt: Date }): Promise<void>;
  findLastHomePath(id: string): Promise<string | null>;
  setLastHomePath(input: { id: string; path: string | null }): Promise<void>;
  setDeactivatedAt(input: { id: string; deactivatedAt: Date | null }): Promise<UserProfile>;
  setAvatar(input: { id: string; image: string | null }): Promise<void>;
}

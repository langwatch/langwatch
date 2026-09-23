import type { Instant } from "@langwatch/time";
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
  UserUsageCount,
} from "@langwatch/user-contract";

/**
 * The issuer a credential account row is stored under — it travels with the
 * write rather than being held by the repository, since a repository is
 * built from the connection alone; the app carries it to the three writes that mint a row.
 */
export type UserCredentialIssuer = Readonly<{ issuer: string }>;

export type CreateCredentialUserRow = CreateCredentialUserInput & UserCredentialIssuer;
export type CreatePasskeyUserRow = CreatePasskeyUserInput & UserCredentialIssuer;
export type SetFirstUserPasswordRow = SetFirstUserPasswordInput & UserCredentialIssuer;

/** Persistence owned by User. It never crosses the feature boundary. */
export interface UserRepository {
  findProfiles(userIds: string[]): Promise<UserFullProfile[]>;
  findById(id: string): Promise<UserProfile | null>;
  findByEmail(email: string): Promise<UserProfile | null>;
  /** The same lookup ignoring case, for rows written before sign-in lowercased. */
  findByEmailInsensitive(email: string): Promise<UserProfile | null>;
  create(input: CreateUserInput): Promise<UserProfile>;
  createCredentialUser(input: CreateCredentialUserRow): Promise<CreatedUser>;
  createPasskeyUser(input: CreatePasskeyUserRow): Promise<CreatedUser>;
  hasPassword(id: string): Promise<boolean>;
  setFirstPassword(input: SetFirstUserPasswordRow): Promise<SetFirstUserPasswordResult>;
  findPasskeyNudgeStatus(id: string): Promise<UserPasskeyNudgeStatus>;
  setPasskeyNudgeDismissedAt(input: { id: string; dismissedAt: Instant }): Promise<void>;
  findJoinOfferDismissedDomains(id: string): Promise<string[]>;
  addJoinOfferDismissedDomain(input: { id: string; domain: string }): Promise<void>;
  updateProfile(input: UpdateUserProfileInput): Promise<UserProfile>;
  findAccountInfo(id: string): Promise<UserAccountInfo | null>;
  findSsoStatus(id: string): Promise<UserSsoStatus>;
  findTraceExplorerTourPreference(id: string): Promise<UserTourPreference>;
  setTraceExplorerTourDismissedAt(input: {
    id: string;
    dismissedAt: Instant;
  }): Promise<UserTourPreference>;
  setLastLoginAt(input: { id: string; lastLoginAt: Instant }): Promise<void>;
  findLastHomePath(id: string): Promise<string | null>;
  setLastHomePath(input: { id: string; path: string | null }): Promise<void>;
  setDeactivatedAt(input: { id: string; deactivatedAt: Instant | null }): Promise<UserProfile>;
  setAvatar(input: { id: string; image: string | null }): Promise<void>;
  /** The usage report's count, install-wide: the part after the `@`, never an address. */
  countUsage(): Promise<UserUsageCount>;
  /** Whether any account's address is on this domain, install-wide, case aside. */
  hasAccountOnDomain(domain: string): Promise<boolean>;
}

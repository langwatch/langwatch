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
  UserTourPreference,
  UserCodeAccessPreference,
  UserUsageCount,
} from "@langwatch/user-contract";

/**
 * The issuer a credential account row is stored under — it travels with the
 * write rather than being held by the repository, since a repository is
 * built from the connection alone; the app carries it to the three writes that mint a row.
 */
export type UserCredentialIssuer = Readonly<{ issuer: string }>;

/** Whether a mailbox proof already confirmed the address, so the account is born confirmed. */
export type UserAddressConfirmation = Readonly<{ emailVerified: boolean }>;

export type CreateCredentialUserRow = CreateCredentialUserInput &
  UserCredentialIssuer &
  UserAddressConfirmation;
export type CreatePasskeyUserRow = CreatePasskeyUserInput &
  UserCredentialIssuer &
  UserAddressConfirmation;
export type SetFirstUserPasswordRow = SetFirstUserPasswordInput & UserCredentialIssuer;

export type UserDeactivationOutcome =
  | Readonly<{ outcome: "deactivated"; user: UserProfile }>
  | Readonly<{ outcome: "none_active" }>;

/** Persistence owned by User. It never crosses the feature boundary. */
export interface UserRepository {
  findProfiles(userIds: string[]): Promise<UserFullProfile[]>;
  findById(id: string): Promise<UserProfile | null>;
  /** Every account on this address, case aside: older rows may carry capitals. */
  findByEmail(email: string): Promise<UserProfile[]>;
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
  findTraceExplorerTourPreference(id: string): Promise<UserTourPreference>;
  getLangyCodeAccessPreference(id: string): Promise<UserCodeAccessPreference>;
  setLangyCodeAccessPreference(id: string, preference: "github" | null): Promise<void>;
  setTraceExplorerTourDismissedAt(input: {
    id: string;
    dismissedAt: Instant;
  }): Promise<UserTourPreference>;
  setLastLoginAt(input: { id: string; lastLoginAt: Instant }): Promise<void>;
  findLastHomePath(id: string): Promise<string | null>;
  setLastHomePath(input: { id: string; path: string | null }): Promise<void>;
  /** The database's clock: user's facts are stamped from it, never from one server's. */
  readClock(): Promise<Instant>;
  setDeactivatedAt(input: { id: string; deactivatedAt: Instant | null }): Promise<UserProfile>;
  /** Deactivates `id` only while one of `others` stays active; two racing never both pass. */
  deactivateWhileOthersActive(input: {
    id: string;
    deactivatedAt: Instant;
    others: readonly string[];
  }): Promise<UserDeactivationOutcome>;
  setAvatar(input: { id: string; image: string | null }): Promise<void>;
  /** The usage report's count, install-wide: the part after the `@`, never an address. */
  countUsage(): Promise<UserUsageCount>;
  /** The same count, among these people only. */
  countUsageAmong(input: { userIds: readonly string[] }): Promise<UserUsageCount>;
  /** Whether any account's address is on this domain, install-wide, case aside. */
  hasAccountOnDomain(domain: string): Promise<boolean>;
}

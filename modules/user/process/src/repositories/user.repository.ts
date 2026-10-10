import type { Instant } from "@langwatch/time";
import type {
  AdoptUnconfirmedAccountOutcome,
  CreateUserInput,
  CreateCredentialUserInput,
  CreatePasskeyUserInput,
  CreatedUser,
  SetFirstUserPasswordInput,
  SetFirstUserPasswordResult,
  UpdateUserEmailInput,
  UpdateUserProfileInput,
  UserAccountInfo,
  UserFullProfile,
  UserPasskeyNudgeStatus,
  UserProfile,
  UserNotificationChoice,
  UserNotificationTopic,
  UserTourPreference,
  UserCodeAccessPreference,
  UserUsageCount,
} from "@langwatch/user-contract";

/**
 * The issuer a credential account row is stored under — it travels with the
 * write rather than being held by the repository, since a repository is
 * built from the connection alone; the app carries it to the three writes that mint a row.
 */
type UserCredentialIssuer = Readonly<{ issuer: string }>;

/** Whether a mailbox proof already confirmed the address, so the account is born confirmed. */
type UserAddressConfirmation = Readonly<{ emailVerified: boolean }>;

/** A credential user and the row it signs in with: identity states its identifier against it. */
export type CreatedCredentialUser = CreatedUser & { accountId: string; accountCreatedAtMs: number };

/** A sign-up the person made themselves: its registered fact commits with the account. */
type UserSelfRegistration = Readonly<{ selfRegistered?: boolean }>;

export type CreateCredentialUserRow = CreateCredentialUserInput &
  UserCredentialIssuer &
  UserAddressConfirmation &
  UserSelfRegistration;
export type CreatePasskeyUserRow = CreatePasskeyUserInput &
  UserCredentialIssuer &
  UserAddressConfirmation;
export type SetFirstUserPasswordRow = SetFirstUserPasswordInput & UserCredentialIssuer;

export type UserDeactivationOutcome =
  | Readonly<{ outcome: "deactivated"; user: UserProfile }>
  | Readonly<{ outcome: "none_active" }>;

/** An account as the created-fact seed reads it: its id and when its row was written. */
export type UserCreatedRow = Readonly<{ id: string; createdAt: Instant }>;

/** An account as the standing-fact step reads it: its id and when it was deactivated, if it is. */
export type UserStandingRow = Readonly<{ id: string; deactivatedAt: Instant | null }>;

/**
 * Persistence owned by User. It never crosses the feature boundary. Every mint commits user's
 * created fact (and a self-registration its registered fact) to the fact outbox with the row.
 */
/** A name change, an address change, or both, as the two `UserApi` writes ask for them. */
export type StoredProfileChange = UpdateUserProfileInput &
  Partial<Pick<UpdateUserEmailInput, "email">>;

export interface UserRepository {
  findProfiles(userIds: string[]): Promise<UserFullProfile[]>;
  findById(id: string): Promise<UserProfile | null>;
  /** Every account on this address, case aside: older rows may carry capitals. */
  findByEmail(email: string): Promise<UserProfile[]>;
  create(input: CreateUserInput): Promise<UserProfile>;
  createCredentialUser(input: CreateCredentialUserRow): Promise<CreatedCredentialUser>;
  createPasskeyUser(input: CreatePasskeyUserRow): Promise<CreatedUser>;
  hasPassword(id: string): Promise<boolean>;
  setFirstPassword(input: SetFirstUserPasswordRow): Promise<SetFirstUserPasswordResult>;
  /**
   * Confirms an unfinished account and drops every account row and passkey it holds, as ONE
   * serializable transaction; refuses, changing nothing, once it is confirmed or signed into.
   */
  adoptUnconfirmed(input: { id: string }): Promise<AdoptUnconfirmedAccountOutcome>;
  findPasskeyNudgeStatus(id: string): Promise<UserPasskeyNudgeStatus>;
  setPasskeyNudgeDismissedAt(input: { id: string; dismissedAt: Instant }): Promise<void>;
  findJoinOfferDismissedDomains(id: string): Promise<string[]>;
  /** Whether the changelog entry is the one this person last opened. */
  hasSeenWhatsNewEntry(input: { id: string; entryId: string }): Promise<boolean>;
  setWhatsNewSeenEntry(input: { id: string; entryId: string }): Promise<void>;
  addJoinOfferDismissedDomain(input: { id: string; domain: string }): Promise<void>;
  updateProfile(input: StoredProfileChange): Promise<UserProfile>;
  findAccountInfo(id: string): Promise<UserAccountInfo | null>;
  findTraceExplorerTourPreference(id: string): Promise<UserTourPreference>;
  getLangyCodeAccessPreference(id: string): Promise<UserCodeAccessPreference>;
  setLangyCodeAccessPreference(id: string, preference: "github" | null): Promise<void>;
  setTraceExplorerTourDismissedAt(input: {
    id: string;
    dismissedAt: Instant;
  }): Promise<UserTourPreference>;
  /** The stored topic-to-choice map; a topic that is absent was never answered. */
  findNotificationPreferences(id: string): Promise<Record<string, UserNotificationChoice>>;
  setNotificationPreference(input: {
    id: string;
    topic: UserNotificationTopic;
    choice: UserNotificationChoice;
  }): Promise<void>;
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
  /** Whether any account exists, install-wide. */
  hasAnyAccount(): Promise<boolean>;
  /** One page of every account, in id order after `afterId`, for user's created-fact seed. */
  findCreatedPage(input: { afterId: string | null; limit: number }): Promise<UserCreatedRow[]>;
  /** One page of every account, in id order after `afterId`, for user's standing-fact step. */
  findStandingPage(input: { afterId: string | null; limit: number }): Promise<UserStandingRow[]>;
}

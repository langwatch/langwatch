import { generate } from "@langwatch/ksuid";
import { nowInstant, toDate, type Instant } from "@langwatch/time";
import {
  createdUserSchema,
  userAccountInfoSchema,
  userFullProfileSchema,
  userPasskeyNudgeStatusSchema,
  userProfileSchema,
  userTourPreferenceSchema,
  UserNotFoundError,
  USER_ACCOUNT_KSUID_RESOURCE,
  USER_KSUID_RESOURCE,
  type CreateUserInput,
  type CreatedUser,
  type SetFirstUserPasswordResult,
  type UpdateUserProfileInput,
  type UserAccountInfo,
  type UserFullProfile,
  type UserPasskeyNudgeStatus,
  type UserProfile,
  type UserTourPreference,
  type UserCodeAccessPreference,
  type UserUsageCount,
} from "@langwatch/user-contract";

import type {
  CreateCredentialUserRow,
  CreatePasskeyUserRow,
  SetFirstUserPasswordRow,
  UserRepository,
} from "../user.repository.ts";
import { type MemoryUserDatabase, type MemoryUserRow } from "./memory.user.database.ts";

/** better-auth's own provider name for an email-and-password sign-in method. */
const CREDENTIAL_PROVIDER = "credential";

/**
 * The Prisma user repository's observable behaviour over a map: same
 * profiles through the same contract schemas, same "already_set" refusal
 * on a second first-password, same absence for a user nobody created.
 */
export class MemoryUserRepository implements UserRepository {
  #database: MemoryUserDatabase;

  private constructor(database: MemoryUserDatabase) {
    this.#database = database;
  }

  static create(input: Readonly<{ database: MemoryUserDatabase }>): MemoryUserRepository {
    return new MemoryUserRepository(input.database);
  }

  async countUsage(): Promise<UserUsageCount> {
    const emailDomains: Record<string, number> = {};
    for (const row of this.#database.rows()) {
      const domain = row.email?.trim().toLowerCase().split("@")[1];
      if (domain) emailDomains[domain] = (emailDomains[domain] ?? 0) + 1;
    }
    return { emailDomains };
  }

  async hasAccountOnDomain(domain: string): Promise<boolean> {
    return this.#database
      .rows()
      .some((row) => row.email?.trim().toLowerCase().split("@")[1] === domain);
  }

  async findProfiles(userIds: string[]): Promise<UserFullProfile[]> {
    if (userIds.length === 0) return [];

    return this.#database.usersById(userIds).map((row) => userFullProfileSchema.parse(fullOf(row)));
  }

  async findById(id: string): Promise<UserProfile | null> {
    const [row] = this.#database.usersById([id]);

    return row ? userProfileSchema.parse(profileOf(row)) : null;
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    const [row] = this.#database.usersWithEmail(email);

    return row ? userProfileSchema.parse(profileOf(row)) : null;
  }

  async findByEmailInsensitive(email: string): Promise<UserProfile | null> {
    const [row] = this.#database.usersWithEmailInsensitive(email);

    return row ? userProfileSchema.parse(profileOf(row)) : null;
  }

  async create(input: CreateUserInput): Promise<UserProfile> {
    const row = this.#insertUser({ name: input.name, email: input.email, emailVerified: false });

    return userProfileSchema.parse(profileOf(row));
  }

  async createCredentialUser(input: CreateCredentialUserRow): Promise<CreatedUser> {
    const row = this.#insertUser({
      name: input.name,
      email: input.email,
      emailVerified: input.emailVerified,
    });
    this.#insertCredentialAccount({
      userId: row.id,
      issuer: input.issuer,
      password: input.passwordHash,
    });

    return createdUserSchema.parse({ id: row.id });
  }

  async createPasskeyUser(input: CreatePasskeyUserRow): Promise<CreatedUser> {
    const row = this.#insertUser({
      name: null,
      email: input.email,
      emailVerified: input.emailVerified,
    });
    this.#insertCredentialAccount({ userId: row.id, issuer: input.issuer, password: null });

    return createdUserSchema.parse({ id: row.id });
  }

  async hasPassword(id: string): Promise<boolean> {
    const account = this.#credentialAccount(id);

    return account ? account.password !== null : false;
  }

  async setFirstPassword(input: SetFirstUserPasswordRow): Promise<SetFirstUserPasswordResult> {
    const account = this.#credentialAccount(input.id);
    if (account?.password) return "already_set";

    if (account) {
      this.#database.writeAccount({ ...account, password: input.passwordHash });

      return "set";
    }

    this.#insertCredentialAccount({
      userId: input.id,
      issuer: input.issuer,
      password: input.passwordHash,
    });

    return "set";
  }

  async findPasskeyNudgeStatus(id: string): Promise<UserPasskeyNudgeStatus> {
    const [user] = this.#database.usersById([id]);
    const dismissedAt = user?.passkeyNudgeDismissedAt ?? null;

    return userPasskeyNudgeStatusSchema.parse({
      hasPasskey: this.#database.passkeyCount(id) > 0,
      twoStepEnabled: user?.twoFactorEnabled ?? false,
      dismissedAt: dismissedAt ? toDate(dismissedAt) : null,
    });
  }

  async setPasskeyNudgeDismissedAt(input: { id: string; dismissedAt: Instant }): Promise<void> {
    const row = this.#require(input.id);
    this.#database.writeUser({ ...row, passkeyNudgeDismissedAt: input.dismissedAt });
  }

  async findJoinOfferDismissedDomains(id: string): Promise<string[]> {
    return [...(this.#database.usersById([id])[0]?.joinOfferDismissedDomains ?? [])];
  }

  async addJoinOfferDismissedDomain(input: { id: string; domain: string }): Promise<void> {
    const row = this.#require(input.id);
    this.#database.writeUser({
      ...row,
      joinOfferDismissedDomains: [...row.joinOfferDismissedDomains, input.domain],
    });
  }

  async updateProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
    const row = this.#require(input.id);
    const updated: MemoryUserRow = {
      ...row,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.email === undefined ? {} : { email: input.email }),
      updatedAt: nowInstant(),
    };
    this.#database.writeUser(updated);

    return userProfileSchema.parse(profileOf(updated));
  }

  async findAccountInfo(id: string): Promise<UserAccountInfo | null> {
    const [row] = this.#database.usersById([id]);

    return row ? userAccountInfoSchema.parse({ createdAt: toDate(row.createdAt) }) : null;
  }

  async getLangyCodeAccessPreference(id: string): Promise<UserCodeAccessPreference> {
    const row = this.#require(id);

    return { preference: row.langyCodeAccessPreference === "github" ? "github" : null };
  }

  async findTraceExplorerTourPreference(id: string): Promise<UserTourPreference> {
    const row = this.#require(id);

    return userTourPreferenceSchema.parse({
      dismissed: row.tracesExplorerTourDismissedAt !== null,
      dismissedAt: row.tracesExplorerTourDismissedAt
        ? toDate(row.tracesExplorerTourDismissedAt)
        : null,
    });
  }

  async setTraceExplorerTourDismissedAt(input: {
    id: string;
    dismissedAt: Instant;
  }): Promise<UserTourPreference> {
    const row = this.#require(input.id);
    this.#database.writeUser({
      ...row,
      tracesExplorerTourDismissedAt: input.dismissedAt,
    });

    return userTourPreferenceSchema.parse({
      dismissed: true,
      dismissedAt: toDate(input.dismissedAt),
    });
  }

  async setLastLoginAt(input: { id: string; lastLoginAt: Instant }): Promise<void> {
    const row = this.#require(input.id);
    this.#database.writeUser({ ...row, lastLoginAt: input.lastLoginAt });
  }

  async findLastHomePath(id: string): Promise<string | null> {
    return this.#database.usersById([id])[0]?.lastHomePath ?? null;
  }

  async setLastHomePath(input: { id: string; path: string | null }): Promise<void> {
    const row = this.#require(input.id);
    this.#database.writeUser({ ...row, lastHomePath: input.path });
  }

  async setDeactivatedAt(input: {
    id: string;
    deactivatedAt: Instant | null;
  }): Promise<UserProfile> {
    const row = this.#require(input.id);
    const updated: MemoryUserRow = {
      ...row,
      deactivatedAt: input.deactivatedAt,
    };
    this.#database.writeUser(updated);

    return userProfileSchema.parse(profileOf(updated));
  }

  async setAvatar(input: { id: string; image: string | null }): Promise<void> {
    const row = this.#require(input.id);
    this.#database.writeUser({ ...row, image: input.image });
  }

  #require(id: string): MemoryUserRow {
    const [row] = this.#database.usersById([id]);
    if (!row) throw new UserNotFoundError(id);

    return row;
  }

  #credentialAccount(userId: string) {
    return this.#database
      .accountsOf(userId)
      .find((account) => account.provider === CREDENTIAL_PROVIDER);
  }

  #insertUser(input: {
    name: string | null;
    email: string;
    emailVerified: boolean;
  }): MemoryUserRow {
    const stamp = nowInstant();
    const row: MemoryUserRow = {
      id: generate(USER_KSUID_RESOURCE).toString(),
      name: input.name,
      email: input.email,
      emailVerified: input.emailVerified,
      image: null,
      pendingSsoSetup: false,
      createdAt: stamp,
      updatedAt: stamp,
      lastLoginAt: null,
      deactivatedAt: null,
      lastHomePath: null,
      tracesExplorerTourDismissedAt: null,
      passkeyNudgeDismissedAt: null,
      twoFactorEnabled: false,
      joinOfferDismissedDomains: [],
    };
    this.#database.writeUser(row);

    return row;
  }

  #insertCredentialAccount(input: {
    userId: string;
    issuer: string;
    password: string | null;
  }): void {
    this.#database.writeAccount({
      id: generate(USER_ACCOUNT_KSUID_RESOURCE).toString(),
      userId: input.userId,
      type: CREDENTIAL_PROVIDER,
      provider: CREDENTIAL_PROVIDER,
      issuer: input.issuer,
      providerAccountId: input.userId,
      password: input.password,
    });
  }
}

function profileOf(row: MemoryUserRow): UserProfile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    pendingSsoSetup: row.pendingSsoSetup,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    lastLoginAt: row.lastLoginAt ? toDate(row.lastLoginAt) : null,
    deactivatedAt: row.deactivatedAt ? toDate(row.deactivatedAt) : null,
  };
}

function fullOf(row: MemoryUserRow): UserFullProfile {
  return {
    ...profileOf(row),
    lastHomePath: row.lastHomePath,
    tracesExplorerTourDismissedAt: row.tracesExplorerTourDismissedAt
      ? toDate(row.tracesExplorerTourDismissedAt)
      : null,
  };
}

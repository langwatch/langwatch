import { generate } from "@langwatch/ksuid";
import { nowInstant, toDate } from "@langwatch/time";
import {
  createdUserSchema,
  userAccountInfoSchema,
  userFullProfileSchema,
  userPasskeyNudgeStatusSchema,
  userProfileSchema,
  userSsoStatusSchema,
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
  type UserSsoStatus,
  type UserTourPreference,
} from "@langwatch/user-contract";
import type {
  CreateCredentialUserRow,
  CreatePasskeyUserRow,
  SetFirstUserPasswordRow,
  UserRepository,
} from "../user.repository.ts";
import { MemoryUserDatabase, type MemoryUserRow } from "./memory.user.database.ts";

/** better-auth's own provider name for an email-and-password sign-in method. */
const CREDENTIAL_PROVIDER = "credential";

/**
 * The Prisma user repository's observable behaviour over a map: the same
 * profiles parsed through the same contract schemas, the same "already_set"
 * refusal on a second first-password, and the same absence for a user nobody
 * created.
 */
export class MemoryUserRepository implements UserRepository {
  #database: MemoryUserDatabase;

  private constructor(database: MemoryUserDatabase) {
    this.#database = database;
  }

  static create(input: Readonly<{ database: MemoryUserDatabase }>): MemoryUserRepository {
    return new MemoryUserRepository(input.database);
  }

  async getProfiles(userIds: string[]): Promise<UserFullProfile[]> {
    if (userIds.length === 0) return [];

    return this.#database.usersById(userIds).map((row) => userFullProfileSchema.parse(fullOf(row)));
  }

  async findById(id: string): Promise<UserProfile | null> {
    const row = this.#database.user(id);

    return row ? userProfileSchema.parse(profileOf(row)) : null;
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    const row = this.#database.userByEmail(email);

    return row ? userProfileSchema.parse(profileOf(row)) : null;
  }

  async create(input: CreateUserInput): Promise<UserProfile> {
    const row = this.#insertUser({ name: input.name, email: input.email });

    return userProfileSchema.parse(profileOf(row));
  }

  async createCredentialUser(input: CreateCredentialUserRow): Promise<CreatedUser> {
    const row = this.#insertUser({ name: input.name, email: input.email });
    this.#insertCredentialAccount({
      userId: row.id,
      issuer: input.issuer,
      password: input.passwordHash,
    });

    return createdUserSchema.parse({ id: row.id });
  }

  async createPasskeyUser(input: CreatePasskeyUserRow): Promise<CreatedUser> {
    const row = this.#insertUser({ name: null, email: input.email });
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

  async getPasskeyNudgeStatus(id: string): Promise<UserPasskeyNudgeStatus> {
    return userPasskeyNudgeStatusSchema.parse({
      hasPasskey: this.#database.passkeyCount(id) > 0,
      dismissedAt: this.#database.user(id)?.passkeyNudgeDismissedAt ?? null,
    });
  }

  async setPasskeyNudgeDismissedAt(input: { id: string; dismissedAt: Date }): Promise<void> {
    const row = this.#require(input.id);
    this.#database.writeUser({ ...row, passkeyNudgeDismissedAt: input.dismissedAt });
  }

  async updateProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
    const row = this.#require(input.id);
    const updated: MemoryUserRow = {
      ...row,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.email === undefined ? {} : { email: input.email }),
      updatedAt: toDate(nowInstant()),
    };
    this.#database.writeUser(updated);

    return userProfileSchema.parse(profileOf(updated));
  }

  async findAccountInfo(id: string): Promise<UserAccountInfo | null> {
    const row = this.#database.user(id);

    return row ? userAccountInfoSchema.parse({ createdAt: row.createdAt }) : null;
  }

  async getSsoStatus(id: string): Promise<UserSsoStatus> {
    return userSsoStatusSchema.parse({
      pendingSsoSetup: this.#database.user(id)?.pendingSsoSetup ?? false,
    });
  }

  async getTraceExplorerTourPreference(id: string): Promise<UserTourPreference> {
    const row = this.#require(id);

    return userTourPreferenceSchema.parse({
      dismissed: row.tracesExplorerTourDismissedAt !== null,
      dismissedAt: row.tracesExplorerTourDismissedAt,
    });
  }

  async setTraceExplorerTourDismissedAt(input: {
    id: string;
    dismissedAt: Date;
  }): Promise<UserTourPreference> {
    const row = this.#require(input.id);
    this.#database.writeUser({ ...row, tracesExplorerTourDismissedAt: input.dismissedAt });

    return userTourPreferenceSchema.parse({ dismissed: true, dismissedAt: input.dismissedAt });
  }

  async setLastLoginAt(input: { id: string; lastLoginAt: Date }): Promise<void> {
    const row = this.#require(input.id);
    this.#database.writeUser({ ...row, lastLoginAt: input.lastLoginAt });
  }

  async findLastHomePath(id: string): Promise<string | null> {
    return this.#database.user(id)?.lastHomePath ?? null;
  }

  async setLastHomePath(input: { id: string; path: string | null }): Promise<void> {
    const row = this.#require(input.id);
    this.#database.writeUser({ ...row, lastHomePath: input.path });
  }

  async setDeactivatedAt(input: {
    id: string;
    deactivatedAt: Date | null;
  }): Promise<UserProfile> {
    const row = this.#require(input.id);
    const updated: MemoryUserRow = { ...row, deactivatedAt: input.deactivatedAt };
    this.#database.writeUser(updated);

    return userProfileSchema.parse(profileOf(updated));
  }

  async setAvatar(input: { id: string; image: string | null }): Promise<void> {
    const row = this.#require(input.id);
    this.#database.writeUser({ ...row, image: input.image });
  }

  #require(id: string): MemoryUserRow {
    const row = this.#database.user(id);
    if (!row) throw new UserNotFoundError(id);

    return row;
  }

  #credentialAccount(userId: string) {
    return this.#database
      .accountsOf(userId)
      .find((account) => account.provider === CREDENTIAL_PROVIDER);
  }

  #insertUser(input: { name: string | null; email: string }): MemoryUserRow {
    const stamp = toDate(nowInstant());
    const row: MemoryUserRow = {
      id: generate(USER_KSUID_RESOURCE).toString(),
      name: input.name,
      email: input.email,
      emailVerified: false,
      image: null,
      pendingSsoSetup: false,
      createdAt: stamp,
      updatedAt: stamp,
      lastLoginAt: null,
      deactivatedAt: null,
      lastHomePath: null,
      tracesExplorerTourDismissedAt: null,
      passkeyNudgeDismissedAt: null,
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

function profileOf(row: MemoryUserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image,
    pendingSsoSetup: row.pendingSsoSetup,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
    deactivatedAt: row.deactivatedAt,
  };
}

function fullOf(row: MemoryUserRow) {
  return {
    ...profileOf(row),
    lastHomePath: row.lastHomePath,
    tracesExplorerTourDismissedAt: row.tracesExplorerTourDismissedAt,
  };
}

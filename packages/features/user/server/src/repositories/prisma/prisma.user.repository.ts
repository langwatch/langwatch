import {
  userAccountInfoSchema,
  userFullProfileSchema,
  userProfileSchema,
  userSsoStatusSchema,
  userTourPreferenceSchema,
  userTourPreferenceRowSchema,
  userHomePathSchema,
  createdUserSchema,
  userCredentialAccountRowSchema,
  type CreateUserInput,
  type UpdateUserProfileInput,
  type UserAccountInfo,
  type UserFullProfile,
  type UserProfile,
  type UserSsoStatus,
  type UserTourPreference,
  type CreateCredentialUserInput,
  type CreatePasskeyUserInput,
  type CreatedUser,
} from "@langwatch/user-contract";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { UserRepository } from "../user.repository";

export type UserDatabase = {
  user: {
    findMany(args: Prisma.UserFindManyArgs): PromiseLike<Record<string, unknown>[]>;
    findUnique(args: Prisma.UserFindUniqueArgs): PromiseLike<Record<string, unknown> | null>;
    findUniqueOrThrow(args: Prisma.UserFindUniqueOrThrowArgs): PromiseLike<Record<string, unknown>>;
    create(args: Prisma.UserCreateArgs): PromiseLike<Record<string, unknown>>;
    update(args: Prisma.UserUpdateArgs): PromiseLike<Record<string, unknown>>;
  };
  account: {
    create(args: Prisma.AccountCreateArgs): PromiseLike<Record<string, unknown>>;
    findFirst(args: Prisma.AccountFindFirstArgs): PromiseLike<Record<string, unknown> | null>;
  };
  $transaction<T>(callback: (transaction: UserDatabase) => Promise<T>): Promise<T>;
};

const userProfileSelect = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  pendingSsoSetup: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
  deactivatedAt: true,
} satisfies Prisma.UserSelect;

const userFullProfileSelect = {
  ...userProfileSelect,
  lastHomePath: true,
  tracesExplorerTourDismissedAt: true,
} satisfies Prisma.UserSelect;

export class PrismaUserRepository extends UserRepository {
  private constructor(
    private readonly database: UserDatabase,
    private readonly credentialIssuer: string,
  ) {
    super();
  }

  static create(database: UserDatabase, credentialIssuer: string): PrismaUserRepository {
    return new PrismaUserRepository(database, credentialIssuer);
  }

  async getProfiles(userIds: string[]): Promise<UserFullProfile[]> {
    if (userIds.length === 0) return [];
    const rows = await this.database.user.findMany({
      where: { id: { in: userIds } },
      select: userFullProfileSelect,
    });
    return rows.map((row) => userFullProfileSchema.parse(row));
  }

  async tryFindById(id: string): Promise<UserProfile | null> {
    return this.map(
      await this.database.user.findUnique({ where: { id }, select: userProfileSelect }),
    );
  }

  async tryFindByEmail(email: string): Promise<UserProfile | null> {
    return this.map(
      await this.database.user.findUnique({
        where: { email },
        select: userProfileSelect,
      }),
    );
  }

  async create(input: CreateUserInput): Promise<UserProfile> {
    return this.mapRequired(
      await this.database.user.create({ data: input, select: userProfileSelect }),
    );
  }

  async createCredentialUser(input: CreateCredentialUserInput): Promise<CreatedUser> {
    const created = await this.database.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: { name: input.name, email: input.email },
      });
      const parsedUser = createdUserSchema.parse(user);
      await transaction.account.create({
        data: {
          userId: parsedUser.id,
          type: "credential",
          provider: "credential",
          issuer: this.credentialIssuer,
          providerAccountId: parsedUser.id,
          password: input.passwordHash,
        },
      });
      return { id: parsedUser.id };
    });
    return createdUserSchema.parse(created);
  }

  async createPasskeyUser(input: CreatePasskeyUserInput): Promise<CreatedUser> {
    const created = await this.database.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: { name: null, email: input.email },
      });
      const parsedUser = createdUserSchema.parse(user);
      await transaction.account.create({
        data: {
          userId: parsedUser.id,
          type: "credential",
          provider: "credential",
          issuer: this.credentialIssuer,
          providerAccountId: parsedUser.id,
          password: null,
        },
      });
      return { id: parsedUser.id };
    });
    return createdUserSchema.parse(created);
  }

  async hasPassword(id: string): Promise<boolean> {
    const row = await this.database.account.findFirst({
      where: { userId: id, provider: "credential" },
      select: { password: true },
    });
    return row ? userCredentialAccountRowSchema.parse(row).password !== null : false;
  }

  async updateProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
    const data: { name?: string; email?: string } = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email;
    return this.mapRequired(
      await this.database.user.update({
        where: { id: input.id },
        data,
        select: userProfileSelect,
      }),
    );
  }

  async tryGetAccountInfo(id: string): Promise<UserAccountInfo | null> {
    const row = await this.database.user.findUnique({
      where: { id },
      select: { createdAt: true },
    });
    return row ? userAccountInfoSchema.parse(row) : null;
  }

  async getSsoStatus(id: string): Promise<UserSsoStatus> {
    const row = await this.database.user.findUnique({
      where: { id },
      select: { pendingSsoSetup: true },
    });
    const parsed = row ? userSsoStatusSchema.safeParse(row) : null;
    return userSsoStatusSchema.parse({
      pendingSsoSetup: parsed?.success ? parsed.data.pendingSsoSetup : false,
    });
  }

  async getTraceExplorerTourPreference(id: string): Promise<UserTourPreference> {
    const row = await this.database.user.findUniqueOrThrow({
      where: { id },
      select: { tracesExplorerTourDismissedAt: true },
    });
    const parsed = userTourPreferenceRowSchema.parse(row);
    return userTourPreferenceSchema.parse({
      dismissed: parsed.tracesExplorerTourDismissedAt !== null,
      dismissedAt: parsed.tracesExplorerTourDismissedAt,
    });
  }

  async setTraceExplorerTourDismissedAt(
    id: string,
    dismissedAt: Date,
  ): Promise<UserTourPreference> {
    const row = await this.database.user.update({
      where: { id },
      data: { tracesExplorerTourDismissedAt: dismissedAt },
      select: { tracesExplorerTourDismissedAt: true },
    });
    return userTourPreferenceSchema.parse({
      dismissed: true,
      dismissedAt: userTourPreferenceRowSchema.parse(row).tracesExplorerTourDismissedAt,
    });
  }

  async setLastLoginAt(id: string, lastLoginAt: Date): Promise<void> {
    await this.database.user.update({
      where: { id },
      data: { lastLoginAt },
    });
  }

  async tryGetLastHomePath(id: string): Promise<string | null> {
    const row = await this.database.user.findUnique({
      where: { id },
      select: { lastHomePath: true },
    });
    return row ? userHomePathSchema.parse(row).lastHomePath : null;
  }

  async setLastHomePath(id: string, path: string | null): Promise<void> {
    await this.database.user.update({
      where: { id },
      data: { lastHomePath: path },
    });
  }

  async setDeactivatedAt(id: string, deactivatedAt: Date | null): Promise<UserProfile> {
    return this.mapRequired(
      await this.database.user.update({
        where: { id },
        data: { deactivatedAt },
        select: userProfileSelect,
      }),
    );
  }

  async setAvatar(id: string, image: string | null): Promise<void> {
    await this.database.user.update({
      where: { id },
      data: { image },
    });
  }

  private map(row: unknown | null): UserProfile | null {
    return row ? userProfileSchema.parse(row) : null;
  }

  private mapRequired(row: unknown): UserProfile {
    return userProfileSchema.parse(row);
  }
}

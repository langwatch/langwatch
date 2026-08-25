import {
  userAccountInfoSchema,
  userFullProfileSchema,
  userProfileSchema,
  userSsoStatusSchema,
  userTourPreferenceSchema,
  type CreateUserInput,
  type UpdateUserProfileInput,
  type UserAccountInfo,
  type UserFullProfile,
  type UserProfile,
  type UserSsoStatus,
  type UserTourPreference,
} from "@langwatch/user-contract";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { UserRepository } from "../user.repository";

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
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: PrismaClient): PrismaUserRepository {
    return new PrismaUserRepository(database);
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
    return userSsoStatusSchema.parse({
      pendingSsoSetup: row?.pendingSsoSetup ?? false,
    });
  }

  async getTraceExplorerTourPreference(id: string): Promise<UserTourPreference> {
    const row = await this.database.user.findUniqueOrThrow({
      where: { id },
      select: { tracesExplorerTourDismissedAt: true },
    });
    return userTourPreferenceSchema.parse({
      dismissed: row.tracesExplorerTourDismissedAt !== null,
      dismissedAt: row.tracesExplorerTourDismissedAt,
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
      dismissedAt: row.tracesExplorerTourDismissedAt,
    });
  }

  async setLastLoginAt(id: string, lastLoginAt: Date): Promise<void> {
    await this.database.user.update({
      where: { id },
      data: { lastLoginAt },
    });
  }

  async getLastHomePath(id: string): Promise<string | null> {
    const row = await this.database.user.findUnique({
      where: { id },
      select: { lastHomePath: true },
    });
    return row?.lastHomePath ?? null;
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

  private map(row: UserProfile | null): UserProfile | null {
    return row ? userProfileSchema.parse(row) : null;
  }

  private mapRequired(row: UserProfile): UserProfile {
    return userProfileSchema.parse(row);
  }
}

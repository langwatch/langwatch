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
  userCredentialAccountSchema,
  userPasskeyNudgeStatusSchema,
  type CreateUserInput,
  type UpdateUserProfileInput,
  type UserAccountInfo,
  type UserFullProfile,
  type UserPasskeyNudgeStatus,
  type UserProfile,
  type UserSsoStatus,
  type UserTourPreference,
  type CreatedUser,
  type SetFirstUserPasswordResult,
} from "@langwatch/user-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  CreateCredentialUserRow,
  CreatePasskeyUserRow,
  SetFirstUserPasswordRow,
  UserRepository,
} from "../user.repository.ts";

/** The three models and the transaction runner these statements need. */
export type UserDatabase = Pick<PrismaClient, "user" | "account" | "passkey" | "$transaction">;

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

/**
 * A freshly created user is read back as its id and nothing else, because
 * `createdUserSchema` is `.strict()` on exactly `{ id }`. Without this select
 * Prisma returns every scalar on `User` — fifteen of them — and the parse
 * throws `unrecognized_keys` on the one row shape no test ever built.
 */
const createdUserSelect = { id: true } satisfies Prisma.UserSelect;

export class PrismaUserRepository
  extends PrismaRepository.transactionalFor("User", "Account", "Passkey")
  implements UserRepository
{
  static readonly create = this.factory((prisma) => new PrismaUserRepository(prisma));

  async getProfiles(userIds: string[]): Promise<UserFullProfile[]> {
    if (userIds.length === 0) return [];

    const rows = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: userFullProfileSelect,
    });

    return rows.map((row) => userFullProfileSchema.parse(row));
  }

  async findById(id: string): Promise<UserProfile | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: userProfileSelect });

    return row ? userProfileSchema.parse(row) : null;
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    const row = await this.prisma.user.findUnique({ where: { email }, select: userProfileSelect });

    return row ? userProfileSchema.parse(row) : null;
  }

  async create(input: CreateUserInput): Promise<UserProfile> {
    return userProfileSchema.parse(
      await this.prisma.user.create({ data: input, select: userProfileSelect }),
    );
  }

  async createCredentialUser(input: CreateCredentialUserRow): Promise<CreatedUser> {
    return createdUserSchema.parse(
      await this.transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { name: input.name, email: input.email },
          select: createdUserSelect,
        });
        const parsed = createdUserSchema.parse(user);
        await transaction.account.create({
          data: credentialAccountData({
            userId: parsed.id,
            issuer: input.issuer,
            password: input.passwordHash,
          }),
        });

        return { id: parsed.id };
      }),
    );
  }

  async createPasskeyUser(input: CreatePasskeyUserRow): Promise<CreatedUser> {
    return createdUserSchema.parse(
      await this.transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { name: null, email: input.email },
          select: createdUserSelect,
        });
        const parsed = createdUserSchema.parse(user);
        await transaction.account.create({
          data: credentialAccountData({
            userId: parsed.id,
            issuer: input.issuer,
            password: null,
          }),
        });

        return { id: parsed.id };
      }),
    );
  }

  async hasPassword(id: string): Promise<boolean> {
    const row = await this.prisma.account.findFirst({
      where: { userId: id, provider: CREDENTIAL_PROVIDER },
      select: { password: true },
    });

    return row ? userCredentialAccountRowSchema.parse(row).password !== null : false;
  }

  async setFirstPassword(input: SetFirstUserPasswordRow): Promise<SetFirstUserPasswordResult> {
    const credential = await this.prisma.account.findFirst({
      where: { userId: input.id, provider: CREDENTIAL_PROVIDER },
      select: { id: true, password: true },
    });
    const parsed = credential ? userCredentialAccountSchema.parse(credential) : null;
    if (parsed?.password) return "already_set";

    if (parsed) {
      await this.prisma.account.update({
        where: { id: parsed.id },
        data: { password: input.passwordHash },
      });

      return "set";
    }

    await this.prisma.account.create({
      data: credentialAccountData({
        userId: input.id,
        issuer: input.issuer,
        password: input.passwordHash,
      }),
    });

    return "set";
  }

  async getPasskeyNudgeStatus(id: string): Promise<UserPasskeyNudgeStatus> {
    const [passkeyCount, user] = await Promise.all([
      this.prisma.passkey.count({ where: { userId: id } }),
      this.prisma.user.findUnique({ where: { id }, select: { passkeyNudgeDismissedAt: true } }),
    ]);

    return userPasskeyNudgeStatusSchema.parse({
      hasPasskey: passkeyCount > 0,
      dismissedAt: user?.passkeyNudgeDismissedAt ?? null,
    });
  }

  async setPasskeyNudgeDismissedAt(input: { id: string; dismissedAt: Date }): Promise<void> {
    await this.prisma.user.update({
      where: { id: input.id },
      data: { passkeyNudgeDismissedAt: input.dismissedAt },
    });
  }

  async updateProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
    const data: { name?: string; email?: string } = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email;

    return userProfileSchema.parse(
      await this.prisma.user.update({
        where: { id: input.id },
        data,
        select: userProfileSelect,
      }),
    );
  }

  async findAccountInfo(id: string): Promise<UserAccountInfo | null> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: { createdAt: true } });

    return row ? userAccountInfoSchema.parse(row) : null;
  }

  async getSsoStatus(id: string): Promise<UserSsoStatus> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: { pendingSsoSetup: true },
    });
    const parsed = row ? userSsoStatusSchema.safeParse(row) : null;

    return userSsoStatusSchema.parse({
      pendingSsoSetup: parsed?.success ? parsed.data.pendingSsoSetup : false,
    });
  }

  async getTraceExplorerTourPreference(id: string): Promise<UserTourPreference> {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { tracesExplorerTourDismissedAt: true },
    });
    const parsed = userTourPreferenceRowSchema.parse(row);

    return userTourPreferenceSchema.parse({
      dismissed: parsed.tracesExplorerTourDismissedAt !== null,
      dismissedAt: parsed.tracesExplorerTourDismissedAt,
    });
  }

  async setTraceExplorerTourDismissedAt(input: {
    id: string;
    dismissedAt: Date;
  }): Promise<UserTourPreference> {
    const row = await this.prisma.user.update({
      where: { id: input.id },
      data: { tracesExplorerTourDismissedAt: input.dismissedAt },
      select: { tracesExplorerTourDismissedAt: true },
    });

    return userTourPreferenceSchema.parse({
      dismissed: true,
      dismissedAt: userTourPreferenceRowSchema.parse(row).tracesExplorerTourDismissedAt,
    });
  }

  async setLastLoginAt(input: { id: string; lastLoginAt: Date }): Promise<void> {
    await this.prisma.user.update({
      where: { id: input.id },
      data: { lastLoginAt: input.lastLoginAt },
    });
  }

  async findLastHomePath(id: string): Promise<string | null> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: { lastHomePath: true },
    });

    return row ? userHomePathSchema.parse(row).lastHomePath : null;
  }

  async setLastHomePath(input: { id: string; path: string | null }): Promise<void> {
    await this.prisma.user.update({
      where: { id: input.id },
      data: { lastHomePath: input.path },
    });
  }

  async setDeactivatedAt(input: {
    id: string;
    deactivatedAt: Date | null;
  }): Promise<UserProfile> {
    return userProfileSchema.parse(
      await this.prisma.user.update({
        where: { id: input.id },
        data: { deactivatedAt: input.deactivatedAt },
        select: userProfileSelect,
      }),
    );
  }

  async setAvatar(input: { id: string; image: string | null }): Promise<void> {
    await this.prisma.user.update({ where: { id: input.id }, data: { image: input.image } });
  }
}

/** better-auth's own provider name for an email-and-password sign-in method. */
const CREDENTIAL_PROVIDER = "credential";

/** The one row shape all three credential-account writes share. */
function credentialAccountData(input: {
  userId: string;
  issuer: string;
  password: string | null;
}): Prisma.AccountUncheckedCreateInput {
  return {
    userId: input.userId,
    type: CREDENTIAL_PROVIDER,
    provider: CREDENTIAL_PROVIDER,
    issuer: input.issuer,
    providerAccountId: input.userId,
    password: input.password,
  };
}

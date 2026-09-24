import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate, type Instant } from "@langwatch/time";
import {
  userAccountInfoSchema,
  userFullProfileSchema,
  userProfileSchema,
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
  type UserTourPreference,
  type CreatedUser,
  type SetFirstUserPasswordResult,
  type UserUsageCount,
} from "@langwatch/user-contract";

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
 * A freshly created user is read back as its id alone, since
 * `createdUserSchema` is `.strict()` on exactly `{ id }`. Without this
 * select Prisma returns all fifteen scalars and the parse throws `unrecognized_keys`.
 */
const createdUserSelect = { id: true } satisfies Prisma.UserSelect;

export class PrismaUserRepository
  extends PrismaRepository.transactionalFor("User", "Account", "Passkey")
  implements UserRepository
{
  static readonly create = this.factory((prisma) => new PrismaUserRepository(prisma));

  /**
   * Folded here, in the module that owns the addresses: only the per-domain
   * counts leave it. The tenancy guard is not asked for a tenant because the
   * report describes the whole install.
   */
  async countUsage(): Promise<UserUsageCount> {
    const rows = await this.prisma.user.findMany({
      where: { email: { not: null } },
      select: { email: true },
    });
    return { emailDomains: domainCounts(rows.map((row) => row.email ?? "")) };
  }

  /** Install-wide on purpose, like the report: one row at most, and only a yes or no leaves. */
  async hasAccountOnDomain(domain: string): Promise<boolean> {
    const row = await this.prisma.user.findFirst({
      where: { email: { endsWith: `@${domain}`, mode: "insensitive" } },
      select: { id: true },
    });
    return row !== null;
  }

  async findProfiles(userIds: string[]): Promise<UserFullProfile[]> {
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

  async findByEmailInsensitive(email: string): Promise<UserProfile | null> {
    const row = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: userProfileSelect,
    });

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

  async findPasskeyNudgeStatus(id: string): Promise<UserPasskeyNudgeStatus> {
    const [passkeyCount, user] = await Promise.all([
      this.prisma.passkey.count({ where: { userId: id } }),
      this.prisma.user.findUnique({
        where: { id },
        select: { passkeyNudgeDismissedAt: true, twoFactorEnabled: true },
      }),
    ]);

    return userPasskeyNudgeStatusSchema.parse({
      hasPasskey: passkeyCount > 0,
      twoStepEnabled: user?.twoFactorEnabled ?? false,
      dismissedAt: user?.passkeyNudgeDismissedAt ?? null,
    });
  }

  async setPasskeyNudgeDismissedAt(input: { id: string; dismissedAt: Instant }): Promise<void> {
    await this.prisma.user.update({
      where: { id: input.id },
      data: { passkeyNudgeDismissedAt: toDate(input.dismissedAt) },
    });
  }

  async findJoinOfferDismissedDomains(id: string): Promise<string[]> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: { joinOfferDismissedDomains: true },
    });

    return row?.joinOfferDismissedDomains ?? [];
  }

  async addJoinOfferDismissedDomain(input: { id: string; domain: string }): Promise<void> {
    await this.prisma.user.update({
      where: { id: input.id },
      data: { joinOfferDismissedDomains: { push: input.domain } },
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

  async findTraceExplorerTourPreference(id: string): Promise<UserTourPreference> {
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
    dismissedAt: Instant;
  }): Promise<UserTourPreference> {
    const row = await this.prisma.user.update({
      where: { id: input.id },
      data: { tracesExplorerTourDismissedAt: toDate(input.dismissedAt) },
      select: { tracesExplorerTourDismissedAt: true },
    });

    return userTourPreferenceSchema.parse({
      dismissed: true,
      dismissedAt: userTourPreferenceRowSchema.parse(row).tracesExplorerTourDismissedAt,
    });
  }

  async setLastLoginAt(input: { id: string; lastLoginAt: Instant }): Promise<void> {
    await this.prisma.user.update({
      where: { id: input.id },
      data: { lastLoginAt: toDate(input.lastLoginAt) },
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
    deactivatedAt: Instant | null;
  }): Promise<UserProfile> {
    return userProfileSchema.parse(
      await this.prisma.user.update({
        where: { id: input.id },
        data: { deactivatedAt: input.deactivatedAt ? toDate(input.deactivatedAt) : null },
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

/** One count per domain, the part after the `@`, dropping an address with none. */
function domainCounts(emails: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const email of emails) {
    const domain = email.trim().toLowerCase().split("@")[1];
    if (domain) counts[domain] = (counts[domain] ?? 0) + 1;
  }
  return counts;
}

import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";
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
  userNotificationChoiceSchema,
  type AdoptUnconfirmedAccountOutcome,
  type CreateUserInput,
  type UserAccountInfo,
  type UserFullProfile,
  type UserPasskeyNudgeStatus,
  type UserProfile,
  type UserTourPreference,
  type UserCodeAccessPreference,
  type UserNotificationChoice,
  type UserNotificationTopic,
  type CreatedUser,
  type SetFirstUserPasswordResult,
  type UserUsageCount,
} from "@langwatch/user-contract";

import type {
  CreateCredentialUserRow,
  CreatedCredentialUser,
  CreatePasskeyUserRow,
  SetFirstUserPasswordRow,
  UserCreatedRow,
  UserStandingRow,
  UserDeactivationOutcome,
  UserRepository,
  StoredProfileChange,
} from "../user.repository.ts";
import { PrismaUserLifecycleOutboxStore } from "./prisma.user-lifecycle-outbox.store.ts";

/**
 * The stored map, read leniently: a choice this release does not know (one a
 * newer release wrote) is dropped rather than failing the read.
 */
function readNotificationPreferences(value: unknown): Record<string, UserNotificationChoice> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const known: Record<string, UserNotificationChoice> = {};
  for (const [topic, choice] of Object.entries(value)) {
    const parsed = userNotificationChoiceSchema.safeParse(choice);
    if (parsed.success) known[topic] = parsed.data;
  }
  return known;
}

/** The stored map as it is, every key kept; anything that is not an object reads as empty. */
function storedPreferenceMap(value: Prisma.JsonValue): Prisma.JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value;
}

/** The three models, the transaction runner, and the raw read of the database's clock. */
export type UserDatabase = Pick<
  PrismaClient,
  "user" | "account" | "passkey" | "$transaction" | "$queryRaw"
>;

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
  static create({ prisma }: { prisma: UserDatabase }): PrismaUserRepository {
    return new PrismaUserRepository(prisma);
  }

  readonly #database: UserDatabase;
  readonly #facts: PrismaUserLifecycleOutboxStore;

  private constructor(prisma: UserDatabase) {
    super(prisma);
    this.#database = prisma;
    this.#facts = PrismaUserLifecycleOutboxStore.create({ database: prisma });
  }

  /** The created fact, and registered for a self-service sign-up, in the mint's transaction. */
  async #appendMintFacts({
    transaction,
    userId,
    createdAt,
    registration,
  }: {
    transaction: object;
    userId: string;
    createdAt: Date;
    registration?: { accountId: string; createdAtMs: number; email: string };
  }): Promise<void> {
    const occurredAt = createdAt.getTime();
    const fact = { tenantId: userId, userId, occurredAt };
    await this.#facts.append({
      userId,
      transaction,
      now: occurredAt,
      intents: [
        { type: "recordCreated", data: fact },
        ...(registration
          ? [{ type: "recordRegistered" as const, data: { ...fact, ...registration } }]
          : []),
      ],
    });
  }

  /** One clock for every server, so user's facts order however the servers' clocks drift. */
  async readClock(): Promise<Instant> {
    const [row] = await this.#database.$queryRaw<{ now: Date }[]>`
      -- @tenancy: reads the database clock; no table is touched.
      SELECT now() AS "now"
    `;
    if (!row) throw new Error("The database answered no clock reading");

    return fromDate(row.now);
  }

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

  async countUsageAmong({ userIds }: { userIds: readonly string[] }): Promise<UserUsageCount> {
    if (userIds.length === 0) return { emailDomains: {} };
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] }, email: { not: null } },
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

  async hasAnyAccount(): Promise<boolean> {
    const row = await this.prisma.user.findFirst({ select: { id: true } });
    return row !== null;
  }

  async findCreatedPage({
    afterId,
    limit,
  }: {
    afterId: string | null;
    limit: number;
  }): Promise<UserCreatedRow[]> {
    const rows = await this.prisma.user.findMany({
      where: afterId === null ? {} : { id: { gt: afterId } },
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true, createdAt: true },
    });
    return rows.map((row) => ({ id: row.id, createdAt: fromDate(row.createdAt) }));
  }

  async findStandingPage({
    afterId,
    limit,
  }: {
    afterId: string | null;
    limit: number;
  }): Promise<UserStandingRow[]> {
    const rows = await this.prisma.user.findMany({
      where: afterId === null ? {} : { id: { gt: afterId } },
      orderBy: { id: "asc" },
      take: limit,
      select: { id: true, deactivatedAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      deactivatedAt: row.deactivatedAt ? fromDate(row.deactivatedAt) : null,
    }));
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

  async findByEmail(email: string): Promise<UserProfile[]> {
    const rows = await this.prisma.user.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: userProfileSelect,
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => userProfileSchema.parse(row));
  }

  async create(input: CreateUserInput): Promise<UserProfile> {
    return this.transaction(async (transaction) => {
      const user = userProfileSchema.parse(
        await transaction.user.create({ data: input, select: userProfileSelect }),
      );
      await this.#appendMintFacts({ transaction, userId: user.id, createdAt: user.createdAt });
      return user;
    });
  }

  async createCredentialUser(input: CreateCredentialUserRow): Promise<CreatedCredentialUser> {
    return this.transaction(async (transaction) => {
      const { createdAt, ...user } = await transaction.user.create({
        data: { name: input.name, email: input.email, emailVerified: input.emailVerified },
        select: { ...createdUserSelect, createdAt: true },
      });
      const parsed = createdUserSchema.parse(user);
      const account = await transaction.account.create({
        data: credentialAccountData({
          userId: parsed.id,
          issuer: input.issuer,
          password: input.passwordHash,
        }),
        select: { id: true, createdAt: true },
      });
      await this.#appendMintFacts({
        transaction,
        userId: parsed.id,
        createdAt,
        ...(input.selfRegistered
          ? {
              registration: {
                accountId: account.id,
                createdAtMs: account.createdAt.getTime(),
                email: input.email,
              },
            }
          : {}),
      });

      return {
        id: parsed.id,
        accountId: account.id,
        accountCreatedAtMs: account.createdAt.getTime(),
      };
    });
  }

  async createPasskeyUser(input: CreatePasskeyUserRow): Promise<CreatedUser> {
    return createdUserSchema.parse(
      await this.transaction(async (transaction) => {
        const { createdAt, ...user } = await transaction.user.create({
          data: { name: null, email: input.email, emailVerified: input.emailVerified },
          select: { ...createdUserSelect, createdAt: true },
        });
        const parsed = createdUserSchema.parse(user);
        await this.#appendMintFacts({ transaction, userId: parsed.id, createdAt });
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

  async adoptUnconfirmed(input: { id: string }): Promise<AdoptUnconfirmedAccountOutcome> {
    // Serializable, so a sign-in or a confirmation racing the adoption is either seen
    // here or retried against what this one wrote.
    return this.serializableTransaction<AdoptUnconfirmedAccountOutcome>(async (transaction) => {
      const row = await transaction.user.findUnique({
        where: { id: input.id },
        select: { emailVerified: true, lastLoginAt: true },
      });
      if (!row) return "no_account";
      if (row.emailVerified) return "already_confirmed";
      if (row.lastLoginAt) return "signed_in";

      await transaction.account.deleteMany({ where: { userId: input.id } });
      await transaction.passkey.deleteMany({ where: { userId: input.id } });
      await transaction.user.update({
        where: { id: input.id },
        data: {
          emailVerified: true,
          signupConfirmationPending: false,
          passkeySignupClaimHash: null,
        },
      });

      return "adopted";
    });
  }

  async findPasskeyNudgeStatus(id: string): Promise<UserPasskeyNudgeStatus> {
    const [passkeyCount, user] = await Promise.all([
      this.prisma.passkey.count({ where: { userId: id } }),
      this.prisma.user.findUnique({
        where: { id },
        select: { passkeyNudgeDismissedAt: true, twoFactorEnabled: true, createdAt: true },
      }),
    ]);

    return userPasskeyNudgeStatusSchema.parse({
      hasPasskey: passkeyCount > 0,
      twoStepEnabled: user?.twoFactorEnabled ?? false,
      dismissedAt: user?.passkeyNudgeDismissedAt ?? null,
      accountCreatedAt: user?.createdAt ?? new Date(0),
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

  async updateProfile(input: StoredProfileChange): Promise<UserProfile> {
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

  async getLangyCodeAccessPreference(id: string): Promise<UserCodeAccessPreference> {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { langyCodeAccessPreference: true },
    });

    return { preference: row.langyCodeAccessPreference === "github" ? "github" : null };
  }

  async setLangyCodeAccessPreference(id: string, preference: "github" | null): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { langyCodeAccessPreference: preference },
    });
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

  async findNotificationPreferences(id: string): Promise<Record<string, UserNotificationChoice>> {
    const row = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: { notificationPreferences: true },
    });

    return readNotificationPreferences(row.notificationPreferences);
  }

  /**
   * One topic is merged into the stored map as it is stored, so a value this release does not
   * read is kept. Serializable, so two answers to different topics cannot drop each other.
   */
  async setNotificationPreference(input: {
    id: string;
    topic: UserNotificationTopic;
    choice: UserNotificationChoice;
  }): Promise<void> {
    await this.serializableTransaction(async (transaction) => {
      const row = await transaction.user.findUniqueOrThrow({
        where: { id: input.id },
        select: { notificationPreferences: true },
      });
      await transaction.user.update({
        where: { id: input.id },
        data: {
          notificationPreferences: {
            ...storedPreferenceMap(row.notificationPreferences),
            [input.topic]: input.choice,
          },
        },
      });
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

  async deactivateWhileOthersActive(input: {
    id: string;
    deactivatedAt: Instant;
    others: readonly string[];
  }): Promise<UserDeactivationOutcome> {
    // Serializable: two deactivations each reading the other as active is a write skew
    // Postgres refuses, and the base reruns the loser against the winner's row.
    return this.serializableTransaction<UserDeactivationOutcome>(async (transaction) => {
      const active = await transaction.user.count({
        where: { id: { in: [...input.others] }, deactivatedAt: null },
      });
      if (active === 0) return { outcome: "none_active" };

      const row = await transaction.user.update({
        where: { id: input.id },
        data: { deactivatedAt: toDate(input.deactivatedAt) },
        select: userProfileSelect,
      });

      return { outcome: "deactivated", user: userProfileSchema.parse(row) };
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

/**
 * @vitest-environment node
 * The two UserApi operations auth's require-password-reset task drives, over the memory store and
 * a real Postgres. On the shared test database "every user" is only read, never marked.
 * @see modules/auth/specs/forced-password-reset.feature
 */
import { randomUUID } from "node:crypto";

import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { InMemoryProcessStore } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { toDate } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserAvatarStorage } from "../../services/user-avatar-object.service.ts";
import { UserLifecycleNoticeService } from "../../services/user-lifecycle-notice.service.ts";
import { UserService } from "../../services/user.service.ts";
import { MemoryUserDatabase } from "../memory/memory.user.database.ts";
import { memoryUserRepositoriesOver } from "../memory/memory.user.repositories.ts";
import { PrismaUserRepository } from "../prisma/prisma.user.repository.ts";
import type { UserRepository } from "../user.repository.ts";

/** One backend, seeded and read the way its own store holds rows. */
type Backend = {
  service: UserService;
  /** Other suites' users live here too, so marking "everyone" for real is left to memory. */
  shared: boolean;
  /** Seeds a credential password holder, storing the address exactly as given. */
  seedPasswordHolder: (email: string) => Promise<string>;
  seedProviderOnly: (email: string) => Promise<string>;
  markOf: (userId: string) => Promise<Date | null>;
};

function serviceOver(repository: UserRepository): UserService {
  return UserService.create({
    repository,
    personalProjects: { findPersonalProjectId: async () => null },
    auth: createApiFixture<AuthApi>({}),
    avatarStorage: createApiFixture<UserAvatarStorage>({}),
    credentialIssuer: "credential",
    platformOperators: createApiFixture<AuthzApi>({}),
    lifecycle: UserLifecycleNoticeService.create(),
  });
}

function memoryBackend(): Backend {
  const database = MemoryUserDatabase.create({
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const { users } = memoryUserRepositoriesOver({ database });
  return {
    service: serviceOver(users),
    shared: false,
    seedPasswordHolder: async (email) => {
      const { id } = await users.createCredentialUser({
        name: "Holder",
        email,
        passwordHash: "stored-hash",
        issuer: "credential",
        emailVerified: true,
      });
      const [row] = database.usersById([id]);
      if (row) database.writeUser({ ...row, email });
      return id;
    },
    seedProviderOnly: async (email) => (await users.create({ name: "Provider", email })).id,
    markOf: async (userId) => {
      const mark = database.usersById([userId])[0]?.passwordResetRequiredAt;
      return mark ? toDate(mark) : null;
    },
  };
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `reset-${randomUUID()}`;
let connection: PrismaConnection | undefined;

function postgresBackend(): Backend {
  if (!connection) throw new Error("Test database URL is required");
  const client = connection.client;
  const seed = async ({
    email,
    account,
  }: {
    email: string;
    account: { type: string; provider: string; issuer: string; password: string | null };
  }) => {
    const user = await client.user.create({ data: { name: "Seeded", email } });
    await client.account.create({
      data: { userId: user.id, providerAccountId: `${account.provider}-${user.id}`, ...account },
    });
    return user.id;
  };
  return {
    service: serviceOver(PrismaUserRepository.create({ prisma: client })),
    shared: true,
    seedPasswordHolder: (email) =>
      seed({
        email,
        account: {
          type: "credential",
          provider: "credential",
          issuer: "credential",
          password: "stored-hash",
        },
      }),
    seedProviderOnly: (email) =>
      seed({
        email,
        account: {
          type: "oauth",
          provider: "google",
          issuer: "https://accounts.google.com",
          password: null,
        },
      }),
    markOf: async (userId) =>
      (
        await client.user.findUniqueOrThrow({
          where: { id: userId },
          select: { passwordResetRequiredAt: true },
        })
      ).passwordResetRequiredAt,
  };
}

beforeAll(() => {
  if (!databaseUrl) return;
  connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:password-holders:test"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
});

afterAll(async () => {
  const current = connection;
  if (!current) return;
  try {
    const seeded = await current.client.user.findMany({
      where: { email: { contains: RUN, mode: "insensitive" } },
      select: { id: true },
    });
    const ids = seeded.map((user) => user.id);
    await current.client.account.deleteMany({ where: { userId: { in: ids } } });
    await current.client.user.deleteMany({ where: { id: { in: ids } } });
  } finally {
    await current.closeOnce();
  }
});

const backends: readonly { name: string; create: () => Backend }[] = databaseUrl
  ? [
      { name: "memory", create: memoryBackend },
      { name: "Postgres", create: postgresBackend },
    ]
  : [{ name: "memory", create: memoryBackend }];

const address = (name: string) => `${name}-${randomUUID()}@${RUN}.acme.test`;

describe.each(backends)("password holders over $name", ({ create }) => {
  /** @scenario "The task marks every user who holds a password" */
  it("finds and marks every password holder and nobody who signs in only through a provider", async () => {
    const { service, shared, seedPasswordHolder, seedProviderOnly, markOf } = create();
    const first = await seedPasswordHolder(address("first"));
    const second = await seedPasswordHolder(address("second"));
    const providerOnly = await seedProviderOnly(address("provider"));

    const holders = (await service.findPasswordHolders({ emails: null })).map((row) => row.id);
    expect(holders).toEqual(expect.arrayContaining([first, second]));
    expect(holders).not.toContain(providerOnly);
    if (shared) return;

    await expect(service.markPasswordResetRequired({ userIds: holders })).resolves.toEqual({
      marked: 2,
    });
    expect(await markOf(first)).toBeInstanceOf(Date);
    expect(await markOf(second)).toBeInstanceOf(Date);
    expect(await markOf(providerOnly)).toBeNull();
  });

  /** @scenario "The task marks only the users named by email" */
  it("finds a holder stored with capitals by an address typed in any case", async () => {
    const { service, seedPasswordHolder, seedProviderOnly, markOf } = create();
    const storedEmail = address("Mixed-Case").replace("Mixed-Case", "Mixed-CASE");
    const named = await seedPasswordHolder(storedEmail);
    const other = await seedPasswordHolder(address("other"));
    await seedProviderOnly(address("provider"));

    const holders = await service.findPasswordHolders({ emails: [storedEmail.toLowerCase()] });

    expect(holders).toEqual([{ id: named, email: storedEmail, markedForReset: false }]);
    await service.markPasswordResetRequired({ userIds: [named] });
    expect(await markOf(named)).toBeInstanceOf(Date);
    expect(await markOf(other)).toBeNull();
    const [marked] = await service.findPasswordHolders({ emails: [storedEmail.toUpperCase()] });
    expect(marked).toMatchObject({ id: named, markedForReset: true });
  });

  /** @scenario "Running the task again keeps the first mark" */
  it("keeps the first mark time when marked again", async () => {
    const { service, seedPasswordHolder, markOf } = create();
    const userId = await seedPasswordHolder(address("again"));
    await service.markPasswordResetRequired({ userIds: [userId] });
    const firstMark = await markOf(userId);

    await expect(service.markPasswordResetRequired({ userIds: [userId] })).resolves.toEqual({
      marked: 0,
    });
    expect(await markOf(userId)).toEqual(firstMark);
  });

  /** @scenario "The task reports addresses that hold no password" */
  it("finds no holder for an unknown address or a provider-only address", async () => {
    const { service, seedProviderOnly, markOf } = create();
    const providerEmail = address("provider-only");
    const providerOnly = await seedProviderOnly(providerEmail);

    await expect(
      service.findPasswordHolders({ emails: [address("unknown"), providerEmail] }),
    ).resolves.toEqual([]);
    expect(await markOf(providerOnly)).toBeNull();
  });
});

/**
 * @vitest-environment node
 * The require-password-reset task over the memory store and a real Postgres. On the shared test
 * database "every user" is only read and dry-run, so no other suite's user is ever marked.
 * @see modules/auth/specs/forced-password-reset.feature
 */
import { randomUUID } from "node:crypto";

import { InMemoryProcessStore } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { toDate } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryUserDatabase } from "../../repositories/memory/memory.user.database.ts";
import { memoryUserRepositoriesOver } from "../../repositories/memory/memory.user.repositories.ts";
import { PrismaUserRepository } from "../../repositories/prisma/prisma.user.repository.ts";
import type { UserRepository } from "../../repositories/user.repository.ts";
import { RequirePasswordResetTask } from "../require-password-reset.task.ts";

/** One backend, seeded and read the way its own store holds rows. */
type Backend = {
  users: UserRepository;
  /** Other suites' users live here too, so marking "everyone" for real is left to memory. */
  shared: boolean;
  seedPasswordHolder: (email: string) => Promise<string>;
  seedProviderOnly: (email: string) => Promise<string>;
  markOf: (userId: string) => Promise<Date | null>;
};

function memoryBackend(): Backend {
  const database = MemoryUserDatabase.create({
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const { users } = memoryUserRepositoriesOver({ database });
  return {
    users,
    shared: false,
    seedPasswordHolder: async (email) =>
      (
        await users.createCredentialUser({
          name: "Holder",
          email,
          passwordHash: "stored-hash",
          issuer: "credential",
          emailVerified: true,
        })
      ).id,
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
    users: PrismaUserRepository.create({ prisma: client }),
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
    logger: createLogger("langwatch:require-password-reset:test"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
});

afterAll(async () => {
  if (!connection) return;
  const seeded = await connection.client.user.findMany({
    where: { email: { contains: RUN } },
    select: { id: true },
  });
  const ids = seeded.map((user) => user.id);
  await connection.client.account.deleteMany({ where: { userId: { in: ids } } });
  await connection.client.user.deleteMany({ where: { id: { in: ids } } });
  await connection.client.$disconnect();
});

const backends: readonly { name: string; create: () => Backend }[] = databaseUrl
  ? [
      { name: "memory", create: memoryBackend },
      { name: "Postgres", create: postgresBackend },
    ]
  : [{ name: "memory", create: memoryBackend }];

const address = (name: string) => `${name}-${randomUUID()}@${RUN}.acme.test`;
const run = async (create: () => Backend, test: (backend: Backend) => Promise<void>) =>
  test(create());
const runTask = (users: UserRepository, args: string[]) =>
  RequirePasswordResetTask.create({ users }).markForReset({ args });

describe.each(backends)("require-password-reset over $name", ({ create }) => {
  /** @scenario "The task marks every user who holds a password" */
  it("marks every password holder and nobody who signs in only through a provider", async () => {
    await run(create, async ({ users, shared, seedPasswordHolder, seedProviderOnly, markOf }) => {
      const first = await seedPasswordHolder(address("first"));
      const second = await seedPasswordHolder(address("second"));
      const providerOnly = await seedProviderOnly(address("provider"));

      const holders = (await users.findPasswordHolders({ emails: null })).map((row) => row.id);
      expect(holders).toEqual(expect.arrayContaining([first, second]));
      expect(holders).not.toContain(providerOnly);
      const dryRun = await runTask(users, ["--all-credential-users", "--dry-run"]);
      expect(dryRun.newlyMarked).toBeGreaterThanOrEqual(2);
      if (shared) return;

      const report = await runTask(users, ["--all-credential-users"]);

      expect(report).toMatchObject({ mode: "execute", matched: 2, newlyMarked: 2 });
      expect(await markOf(first)).toBeInstanceOf(Date);
      expect(await markOf(second)).toBeInstanceOf(Date);
      expect(await markOf(providerOnly)).toBeNull();
    });
  });

  /** @scenario "The task marks only the users named by email" */
  it("marks only the named address, whatever case it was typed in", async () => {
    await run(create, async ({ users, seedPasswordHolder, markOf }) => {
      const namedEmail = address("named");
      const named = await seedPasswordHolder(namedEmail);
      const other = await seedPasswordHolder(address("other"));

      const report = await runTask(users, ["--email", namedEmail.toUpperCase()]);

      expect(report).toMatchObject({ mode: "execute", matched: 1, newlyMarked: 1 });
      expect(await markOf(named)).toBeInstanceOf(Date);
      expect(await markOf(other)).toBeNull();
    });
  });

  /** @scenario "A dry run counts and writes nothing" */
  it("counts the users it would mark and writes nothing", async () => {
    await run(create, async ({ users, seedPasswordHolder, markOf }) => {
      const firstEmail = address("dry-first");
      const secondEmail = address("dry-second");
      const first = await seedPasswordHolder(firstEmail);
      const second = await seedPasswordHolder(secondEmail);

      const report = await runTask(users, ["--email", `${firstEmail},${secondEmail}`, "--dry-run"]);

      expect(report).toMatchObject({ mode: "dry-run", matched: 2, newlyMarked: 2 });
      expect(await markOf(first)).toBeNull();
      expect(await markOf(second)).toBeNull();
    });
  });

  /** @scenario "Running the task again keeps the first mark" */
  it("keeps the first run's mark time on a second run", async () => {
    await run(create, async ({ users, seedPasswordHolder, markOf }) => {
      const email = address("again");
      const userId = await seedPasswordHolder(email);
      await runTask(users, ["--email", email]);
      const firstMark = await markOf(userId);

      const report = await runTask(users, ["--email", email]);

      expect(report).toMatchObject({ matched: 1, newlyMarked: 0, alreadyMarked: 1 });
      expect(await markOf(userId)).toEqual(firstMark);
    });
  });

  /** @scenario "The task reports addresses that hold no password" */
  it("reports an unknown address and a provider-only address as not marked", async () => {
    await run(create, async ({ users, seedProviderOnly, markOf }) => {
      const unknown = address("unknown");
      const providerEmail = address("provider-only");
      const providerOnly = await seedProviderOnly(providerEmail);

      const report = await runTask(users, ["--email", unknown, "--email", providerEmail]);

      expect(report).toMatchObject({ matched: 0, newlyMarked: 0 });
      expect(report.notMarkedEmails.toSorted()).toEqual([unknown, providerEmail].toSorted());
      expect(await markOf(providerOnly)).toBeNull();
    });
  });
});

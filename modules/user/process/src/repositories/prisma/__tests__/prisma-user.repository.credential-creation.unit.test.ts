import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { fromDate } from "@langwatch/time";
import { EmailAlreadyRegisteredError } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { PrismaUserRepository, type UserDatabase } from "../prisma.user.repository.ts";

/** The issuer the deployment states, carried down with each credential write. */
const ISSUER = "local:credential";

/**
 * Every scalar column on `model User`. A `create` naming no `select` returns
 * all of them, so a mock answering `{ id }` regardless masks that shape —
 * exactly how a `.strict()` parse stayed green here while signup 500'd in prod.
 */
const FULL_USER_ROW = {
  id: "user-1",
  name: null,
  email: "ada@example.com",
  emailVerified: false,
  image: null,
  pendingSsoSetup: false,
  userHashKey: null,
  twoFactorEnabled: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastLoginAt: null,
  deactivatedAt: null,
  lastHomePath: null,
  tracesExplorerTourDismissedAt: null,
  passkeyNudgeDismissedAt: null,
};

/** Projects `FULL_USER_ROW` through a `select`, the way Prisma would. */
function selectFrom(select?: object | null): Record<string, unknown> {
  if (!select) return { ...FULL_USER_ROW };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, picked]) => Boolean(picked))
      .map(([column]) => column)
      .map((column) => [column, FULL_USER_ROW[column as keyof typeof FULL_USER_ROW]]),
  );
}

function makeDatabase() {
  const userCreate = vi.fn(async (args: { select?: object | null }) => selectFrom(args.select));
  const accountCreate = vi.fn(async () => ({ id: "account-1", createdAt: new Date(1_000) }));
  const accountUpdate = vi.fn(async () => ({}));
  const userUpdate = vi.fn(async () => ({}));
  const passkeyCount = vi.fn(async () => 0);
  const userFindUnique = vi.fn<(...args: unknown[]) => Promise<Record<string, unknown> | null>>(
    async () => null,
  );
  const accountFindFirst = vi.fn<(...args: unknown[]) => Promise<Record<string, unknown> | null>>(
    async () => null,
  );
  const state = { committed: false };
  const outboxCreateMany = vi.fn(async (args?: { data: unknown }) => ({
    count: [args?.data].flat().length,
  }));
  const client: PrismaClient = prismaDouble({
    processManagerOutbox: { createMany: outboxCreateMany, findMany: vi.fn(async () => []) },
    processManagerOutboxAttempt: {},
    processManagerInbox: {},
    processManagerInstance: {},
    $executeRaw: vi.fn(async () => 0),
    user: {
      findMany: vi.fn(async () => []),
      findUnique: userFindUnique,
      findUniqueOrThrow: vi.fn(async () => ({})),
      create: userCreate,
      update: userUpdate,
    },
    account: {
      create: accountCreate,
      findFirst: accountFindFirst,
      update: accountUpdate,
    },
    passkey: { count: passkeyCount },
    $transaction: vi.fn(async (callback: (prisma: PrismaClient) => Promise<unknown>) => {
      const result = await callback(client);
      state.committed = true;
      return result;
    }),
  });
  const database: UserDatabase = client;
  return {
    database,
    userCreate,
    userUpdate,
    userFindUnique,
    accountCreate,
    accountUpdate,
    accountFindFirst,
    passkeyCount,
    outboxCreateMany,
    state,
  };
}

function repositoryOver(database: UserDatabase) {
  return PrismaUserRepository.create({ prisma: database });
}

describe("PrismaUserRepository credential creation", () => {
  it("creates a user and credential account atomically", async () => {
    const { database, userCreate, accountCreate } = makeDatabase();

    await expect(
      repositoryOver(database).createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hash",
        issuer: ISSUER,
        emailVerified: true,
      }),
    ).resolves.toEqual({ id: "user-1", accountId: "account-1", accountCreatedAtMs: 1_000 });
    expect(userCreate).toHaveBeenCalledWith({
      data: { name: "Ada", email: "ada@example.com", emailVerified: true },
      select: { id: true, createdAt: true },
    });
    expect(accountCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "credential",
        provider: "credential",
        issuer: ISSUER,
        providerAccountId: "user-1",
        password: "hash",
      },
      select: { id: true, createdAt: true },
    });
  });

  it("creates a recovery account with a null password for passkey signup", async () => {
    const { database, accountCreate } = makeDatabase();

    await repositoryOver(database).createPasskeyUser({
      email: "ada@example.com",
      issuer: ISSUER,
      emailVerified: true,
    });

    expect(accountCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ password: null, provider: "credential" }),
    });
  });

  describe("when the new row is read back", () => {
    /**
     * `createdUserSchema` is `.strict()` on `{ id }`; a `create` naming no
     * `select` hands every scalar on `User`, throwing `unrecognized_keys` from
     * inside the repository — which is how both signup routes answered 500.
     */
    it("asks for the id and its stamp alone, so a credential signup survives the full row", async () => {
      const { database, userCreate } = makeDatabase();

      await expect(
        repositoryOver(database).createCredentialUser({
          name: "Ada",
          email: "ada@example.com",
          passwordHash: "hash",
          issuer: ISSUER,
          emailVerified: false,
        }),
      ).resolves.toEqual({ id: "user-1", accountId: "account-1", accountCreatedAtMs: 1_000 });
      expect(userCreate.mock.calls[0]?.[0].select).toEqual({ id: true, createdAt: true });
    });

    it("asks for the id and its stamp alone on the passkey route too", async () => {
      const { database, userCreate } = makeDatabase();

      await expect(
        repositoryOver(database).createPasskeyUser({
          email: "ada@example.com",
          issuer: ISSUER,
          emailVerified: true,
        }),
      ).resolves.toEqual({ id: "user-1" });
      expect(userCreate.mock.calls[0]?.[0].select).toEqual({ id: true, createdAt: true });
    });
  });

  describe("when an account is minted", () => {
    /** @scenario "Every account mint records user's created fact" */
    it("appends the created fact to the outbox in the mint's transaction", async () => {
      const { database, outboxCreateMany } = makeDatabase();

      await repositoryOver(database).createPasskeyUser({
        email: "ada@example.com",
        issuer: ISSUER,
        emailVerified: true,
      });

      expect(outboxCreateMany.mock.calls[0]?.[0]?.data).toEqual([
        expect.objectContaining({
          processName: "userLifecycleFacts",
          tenantId: "user-1",
          messageKey: "user-1:created",
          intentType: "recordCreated",
          payload: { tenantId: "user-1", userId: "user-1", occurredAt: 0 },
        }),
      ]);
    });

    /** @scenario "A self-service registration is recorded as user's fact" */
    it("appends the registered fact beside it for a self-registration", async () => {
      const { database, outboxCreateMany } = makeDatabase();

      await repositoryOver(database).createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hash",
        issuer: ISSUER,
        emailVerified: true,
        selfRegistered: true,
      });

      expect(outboxCreateMany.mock.calls[0]?.[0]?.data).toEqual([
        expect.objectContaining({ messageKey: "user-1:created" }),
        expect.objectContaining({
          messageKey: "user-1:registered",
          payload: {
            tenantId: "user-1",
            userId: "user-1",
            occurredAt: 0,
            accountId: "account-1",
            createdAtMs: 1_000,
            email: "ada@example.com",
          },
        }),
      ]);
    });

    /** @scenario "A mint whose fact cannot be committed writes no account" */
    it("fails the whole transaction when the outbox row cannot be written", async () => {
      const { database, outboxCreateMany, state } = makeDatabase();
      outboxCreateMany.mockRejectedValueOnce(new Error("outbox unavailable"));

      await expect(
        repositoryOver(database).create({ name: "Ada", email: "ada@example.com" }),
      ).rejects.toThrow("outbox unavailable");
      expect(state.committed).toBe(false);
    });

    /** @scenario "A mint that loses a race for its address answers that the address is taken" */
    it("reads the store's unique-email refusal as the address being taken", async () => {
      const { database, userCreate } = makeDatabase();
      userCreate.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));

      await expect(
        repositoryOver(database).create({ name: "Ada", email: "ada@example.com" }),
      ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
    });
  });

  it("fills an empty credential row without creating another account", async () => {
    const { database, accountCreate, accountUpdate, accountFindFirst } = makeDatabase();
    accountFindFirst.mockResolvedValue({ id: "account-1", password: null });

    await expect(
      repositoryOver(database).setFirstPassword({
        id: "user-1",
        passwordHash: "bcrypt-hash",
        issuer: ISSUER,
      }),
    ).resolves.toBe("set");
    expect(accountUpdate).toHaveBeenCalledWith({
      where: { id: "account-1" },
      data: { password: "bcrypt-hash" },
    });
    expect(accountCreate).not.toHaveBeenCalled();
  });

  it("creates the credential row where an older account has none", async () => {
    const { database, accountCreate } = makeDatabase();

    await expect(
      repositoryOver(database).setFirstPassword({
        id: "user-1",
        passwordHash: "bcrypt-hash",
        issuer: ISSUER,
      }),
    ).resolves.toBe("set");
    expect(accountCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "credential",
        provider: "credential",
        issuer: ISSUER,
        providerAccountId: "user-1",
        password: "bcrypt-hash",
      },
    });
  });

  it("does not overwrite a credential that already has a password", async () => {
    const { database, accountCreate, accountUpdate, accountFindFirst } = makeDatabase();
    accountFindFirst.mockResolvedValue({ id: "account-1", password: "existing-hash" });

    await expect(
      repositoryOver(database).setFirstPassword({
        id: "user-1",
        passwordHash: "bcrypt-hash",
        issuer: ISSUER,
      }),
    ).resolves.toBe("already_set");
    expect(accountUpdate).not.toHaveBeenCalled();
    expect(accountCreate).not.toHaveBeenCalled();
  });

  it("loads passkey presence and nudge dismissal together", async () => {
    const { database, passkeyCount, userFindUnique } = makeDatabase();
    const dismissedAt = new Date(42);
    passkeyCount.mockResolvedValue(1);
    userFindUnique.mockResolvedValue({
      passkeyNudgeDismissedAt: dismissedAt,
      twoFactorEnabled: true,
    });

    await expect(repositoryOver(database).findPasskeyNudgeStatus("user-1")).resolves.toEqual({
      hasPasskey: true,
      twoStepEnabled: true,
      dismissedAt,
    });
    expect(passkeyCount).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("stores the passkey-nudge dismissal timestamp", async () => {
    const { database, userUpdate } = makeDatabase();
    const dismissedAt = new Date(42);

    await repositoryOver(database).setPasskeyNudgeDismissedAt({
      id: "user-1",
      dismissedAt: fromDate(dismissedAt),
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passkeyNudgeDismissedAt: dismissedAt },
    });
  });

  it("propagates account failure through the transaction without committing the user", async () => {
    const { database, accountCreate, state } = makeDatabase();
    const failure = new Error("account write failed");
    accountCreate.mockRejectedValue(failure);

    await expect(
      repositoryOver(database).createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hash",
        issuer: ISSUER,
        emailVerified: true,
      }),
    ).rejects.toBe(failure);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(state.committed).toBe(false);
  });
});

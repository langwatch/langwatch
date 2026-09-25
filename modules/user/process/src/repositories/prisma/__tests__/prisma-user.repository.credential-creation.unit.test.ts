import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { fromDate } from "@langwatch/time";
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
  const accountCreate = vi.fn(async () => ({}));
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
  const client: PrismaClient = prismaDouble({
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
    ).resolves.toEqual({ id: "user-1" });
    expect(userCreate).toHaveBeenCalledWith({
      data: { name: "Ada", email: "ada@example.com", emailVerified: true },
      select: { id: true },
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
    it("asks for the id alone, so a credential signup survives the full row", async () => {
      const { database, userCreate } = makeDatabase();

      await expect(
        repositoryOver(database).createCredentialUser({
          name: "Ada",
          email: "ada@example.com",
          passwordHash: "hash",
          issuer: ISSUER,
          emailVerified: false,
        }),
      ).resolves.toEqual({ id: "user-1" });
      expect(userCreate.mock.calls[0]?.[0].select).toEqual({ id: true });
    });

    it("asks for the id alone on the passkey route too", async () => {
      const { database, userCreate } = makeDatabase();

      await expect(
        repositoryOver(database).createPasskeyUser({
          email: "ada@example.com",
          issuer: ISSUER,
          emailVerified: true,
        }),
      ).resolves.toEqual({ id: "user-1" });
      expect(userCreate.mock.calls[0]?.[0].select).toEqual({ id: true });
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

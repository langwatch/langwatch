import { describe, expect, it, vi } from "vitest";
import {
  PrismaUserRepository,
  type UserDatabase,
} from "../src/repositories/prisma/prisma.user.repository";

function makeDatabase() {
  const userCreate = vi.fn(async () => ({ id: "user-1" }));
  const accountCreate = vi.fn(async () => ({}));
  const accountUpdate = vi.fn(async () => ({}));
  const userUpdate = vi.fn(async () => ({}));
  const passkeyCount = vi.fn(async () => 0);
  const state = { committed: false };
  const transaction = {
    user: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      findUniqueOrThrow: vi.fn(async () => ({})),
      create: userCreate,
      update: userUpdate,
    },
    account: {
      create: accountCreate,
      findFirst: vi.fn(async () => null),
      update: accountUpdate,
    },
    passkey: { count: passkeyCount },
    $transaction: vi.fn(async (callback) => {
      const result = await callback(transaction);
      state.committed = true;
      return result;
    }),
  };
  return {
    database: transaction as UserDatabase,
    userCreate,
    userUpdate,
    accountCreate,
    accountUpdate,
    passkeyCount,
    state,
  };
}

describe("PrismaUserRepository credential creation", () => {
  it("creates a user and credential account atomically", async () => {
    const { database, userCreate, accountCreate } = makeDatabase();

    await expect(
      PrismaUserRepository.create(database, "local:credential").createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hash",
      }),
    ).resolves.toEqual({ id: "user-1" });
    expect(userCreate).toHaveBeenCalledWith({
      data: { name: "Ada", email: "ada@example.com" },
    });
    expect(accountCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "credential",
        provider: "credential",
        issuer: "local:credential",
        providerAccountId: "user-1",
        password: "hash",
      },
    });
  });

  it("creates a recovery account with a null password for passkey signup", async () => {
    const { database, accountCreate } = makeDatabase();

    await PrismaUserRepository.create(database, "local:credential").createPasskeyUser({
      email: "ada@example.com",
    });

    expect(accountCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ password: null, provider: "credential" }),
    });
  });

  it("fills an empty credential row without creating another account", async () => {
    const { database, accountCreate, accountUpdate } = makeDatabase();
    database.account.findFirst = vi.fn(async () => ({ id: "account-1", password: null }));

    await expect(
      PrismaUserRepository.create(database, "local:credential").setFirstPassword({
        id: "user-1",
        passwordHash: "bcrypt-hash",
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
      PrismaUserRepository.create(database, "local:credential").setFirstPassword({
        id: "user-1",
        passwordHash: "bcrypt-hash",
      }),
    ).resolves.toBe("set");
    expect(accountCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        type: "credential",
        provider: "credential",
        issuer: "local:credential",
        providerAccountId: "user-1",
        password: "bcrypt-hash",
      },
    });
  });

  it("does not overwrite a credential that already has a password", async () => {
    const { database, accountCreate, accountUpdate } = makeDatabase();
    database.account.findFirst = vi.fn(async () => ({
      id: "account-1",
      password: "existing-hash",
    }));

    await expect(
      PrismaUserRepository.create(database, "local:credential").setFirstPassword({
        id: "user-1",
        passwordHash: "bcrypt-hash",
      }),
    ).resolves.toBe("already_set");
    expect(accountUpdate).not.toHaveBeenCalled();
    expect(accountCreate).not.toHaveBeenCalled();
  });

  it("loads passkey presence and nudge dismissal together", async () => {
    const { database, passkeyCount } = makeDatabase();
    const dismissedAt = new Date(42);
    passkeyCount.mockResolvedValue(1);
    database.user.findUnique = vi.fn(async () => ({ passkeyNudgeDismissedAt: dismissedAt }));

    await expect(
      PrismaUserRepository.create(database, "local:credential").getPasskeyNudgeStatus("user-1"),
    ).resolves.toEqual({ hasPasskey: true, dismissedAt });
    expect(passkeyCount).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("stores the passkey-nudge dismissal timestamp", async () => {
    const { database, userUpdate } = makeDatabase();
    const dismissedAt = new Date(42);

    await PrismaUserRepository.create(database, "local:credential").setPasskeyNudgeDismissedAt(
      "user-1",
      dismissedAt,
    );
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
      PrismaUserRepository.create(database, "local:credential").createCredentialUser({
        name: "Ada",
        email: "ada@example.com",
        passwordHash: "hash",
      }),
    ).rejects.toBe(failure);
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(state.committed).toBe(false);
  });
});

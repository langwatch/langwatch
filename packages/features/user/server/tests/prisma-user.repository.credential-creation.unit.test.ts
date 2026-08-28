import { describe, expect, it, vi } from "vitest";
import {
  PrismaUserRepository,
  type UserDatabase,
} from "../src/repositories/prisma/prisma.user.repository";

function makeDatabase() {
  const userCreate = vi.fn(async () => ({ id: "user-1" }));
  const accountCreate = vi.fn(async () => ({}));
  const state = { committed: false };
  const transaction = {
    user: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      findUniqueOrThrow: vi.fn(async () => ({})),
      create: userCreate,
      update: vi.fn(async () => ({})),
    },
    account: { create: accountCreate, findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (callback) => {
      try {
        const result = await callback(transaction);
        state.committed = true;
        return result;
      } catch (error) {
        throw error;
      }
    }),
  };
  return { database: transaction as UserDatabase, userCreate, accountCreate, state };
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

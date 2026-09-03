import { describe, expect, it, vi } from "vitest";
import { PrismaUserRepository, type UserDatabase } from "../prisma.user.repository";

/**
 * Every scalar column on `model User`. Prisma returns all of them from a
 * `create` that names no `select`, so a mock answering `{ id }` regardless is
 * a mock of a row shape the database never sends — which is how a `.strict()`
 * parse over the real row stayed green here while signup 500'd in production.
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
function selectFrom(select?: Record<string, boolean>): Record<string, unknown> {
  if (!select) return { ...FULL_USER_ROW };
  return Object.fromEntries(
    Object.keys(select)
      .filter((column) => select[column])
      .map((column) => [column, FULL_USER_ROW[column as keyof typeof FULL_USER_ROW]]),
  );
}

function makeDatabase() {
  const userCreate = vi.fn(async (args: { select?: Record<string, boolean> }) =>
    selectFrom(args.select),
  );
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
      select: { id: true },
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

  describe("when the new row is read back", () => {
    /**
     * `createdUserSchema` is `.strict()` on `{ id }`. A `create` that names no
     * `select` hands it every scalar on `User`, and the parse throws
     * `unrecognized_keys` — from inside the repository, on an unhandled
     * channel, so both signup routes answered 500. Asking for the id alone is
     * what keeps the row and the schema the same shape.
     */
    it("asks for the id alone, so a credential signup survives the full row", async () => {
      const { database, userCreate } = makeDatabase();

      await expect(
        PrismaUserRepository.create(database, "local:credential").createCredentialUser({
          name: "Ada",
          email: "ada@example.com",
          passwordHash: "hash",
        }),
      ).resolves.toEqual({ id: "user-1" });
      expect(userCreate.mock.calls[0]?.[0].select).toEqual({ id: true });
    });

    it("asks for the id alone on the passkey route too", async () => {
      const { database, userCreate } = makeDatabase();

      await expect(
        PrismaUserRepository.create(database, "local:credential").createPasskeyUser({
          email: "ada@example.com",
        }),
      ).resolves.toEqual({ id: "user-1" });
      expect(userCreate.mock.calls[0]?.[0].select).toEqual({ id: true });
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

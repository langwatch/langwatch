/**
 * What the API's tRPC ports composition may read on its own connection, and
 * what it may not.
 *
 * The file under test answers roughly forty `user.*` / `workflow.*` /
 * `experiments.*` entries from this process's own guarded Prisma client, on the
 * rule that each is "a row read with a project or user id already in hand".
 * Four of them broke that rule without looking like it: they read `Account`,
 * the table a person's sign-in methods live on, and one of the four selected
 * `password` — the bcrypt hash a credential sign-in is checked against.
 *
 * Nothing leaked. What was wrong is the seam. `prisma-containment` governs
 * which modules may NAME the generated client, not which rows they then ask
 * for, so a composition that legitimately holds a client could select a
 * credential column with no rule about that column attached to the read.
 *
 * So the client this composition is handed below refuses EVERY access to
 * `account` — a property read, not only a call — and the four answers still
 * come back, because they are the user feature's own reads now, issued by
 * `PrismaUserCredentialRepository` behind `UserCredentialService`. The hash
 * that service reads is compared inside it and discarded; the word it returns
 * is what crosses the boundary.
 */
// @vitest-environment node
import type { AuthzService } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  PostgresUserCredentialAdapter,
  UserPasswordHasherPort,
  type UserCredentialDatabase,
} from "@langwatch/user-server";
import { describe, expect, it, vi } from "vitest";
import type { ApiTrpcFeatureMount } from "../../api.application";
import { createApiTrpcPorts } from "../api-trpc-ports.composition";

const USER_ID = "user-1";
const CREDENTIAL_ACCOUNT_ID = "account-credential";
const AUTH0_ACCOUNT_ID = "account-auth0";
const CURRENT_PASSWORD = "the-current-one";
const NEW_PASSWORD = "the-next-one";

/** The request context these ports take and none of them read. */
const CTX = {} as never;

/**
 * The deployment's stored-password format, as this test can observe it.
 *
 * A reversible stand-in for bcrypt rather than bcrypt itself: what is being
 * pinned is WHO holds the hash, so the hash has to be recognisable in an
 * assertion. Production composes `BcryptPasswordHasher` through the same port.
 */
class TestPasswordHasher extends UserPasswordHasherPort {
  async hash({ password }: { password: string }): Promise<string> {
    return `hashed:${password}`;
  }

  async matches({ password, hash }: { password: string; hash: string }): Promise<boolean> {
    return hash === `hashed:${password}`;
  }
}

/** The two sign-in methods this person holds, as rows. */
function accountRows() {
  return [
    {
      id: CREDENTIAL_ACCOUNT_ID,
      userId: USER_ID,
      provider: "credential",
      providerAccountId: USER_ID,
      password: `hashed:${CURRENT_PASSWORD}`,
    },
    {
      id: AUTH0_ACCOUNT_ID,
      userId: USER_ID,
      provider: "auth0",
      providerAccountId: "auth0|abc123",
      password: null,
    },
  ];
}

/**
 * The user feature's OWN connection.
 *
 * Separate from the one the composition is built on, and that separation is
 * the whole instrument: every account statement that runs has to land here,
 * because the other client refuses them.
 */
function credentialClient() {
  const rows = accountRows();
  type Where = {
    id?: string;
    userId?: string;
    provider?: string;
    providerAccountId?: { startsWith: string };
  };
  const matches = (row: (typeof rows)[number], where: Where): boolean =>
    (where.id === void 0 || row.id === where.id) &&
    (where.userId === void 0 || row.userId === where.userId) &&
    (where.provider === void 0 || row.provider === where.provider) &&
    (where.providerAccountId === void 0 ||
      row.providerAccountId.startsWith(where.providerAccountId.startsWith));

  // `select` is honoured rather than ignored: a repository that asked for the
  // credential column would be visible in what came back, and a test that
  // returned whole rows regardless could not tell the two apart.
  const project = (
    row: (typeof rows)[number] | undefined,
    select: Record<string, boolean> | undefined,
  ): Record<string, unknown> | null => {
    if (!row) return null;
    if (!select) return { ...row };
    return Object.fromEntries(
      Object.keys(select).map((column) => [column, row[column as keyof typeof row]]),
    );
  };

  const account = {
    findFirst: vi.fn(
      async ({ where, select }: { where: Where; select?: Record<string, boolean> }) =>
        project(
          rows.find((row) => matches(row, where)),
          select,
        ),
    ),
    findMany: vi.fn(async () =>
      rows.map(({ id, provider, providerAccountId }) => ({ id, provider, providerAccountId })),
    ),
    update: vi.fn(async () => rows[0]),
    count: vi.fn(async () => rows.length),
    delete: vi.fn(async () => rows[0]),
  };

  const client = {
    account,
    $transaction: vi.fn(async (run: (transaction: unknown) => Promise<unknown>) =>
      run({ account }),
    ),
  };

  return { database: client as unknown as UserCredentialDatabase, account, client };
}

/**
 * The connection the composition itself is built on.
 *
 * `account` is a `Proxy` whose `get` trap throws, so reaching for the delegate
 * at all fails here — including a read that only wanted an id, and including
 * one written with a different method name than the four that were removed.
 */
function portsPrisma() {
  const user = { findFirst: vi.fn(async () => null) };
  return {
    user,
    account: new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(
            `the ports composition reached prisma.account.${String(property)}; the credential rows are the user feature's read`,
          );
        },
      },
    ),
  } as unknown as PrismaClient & { user: typeof user };
}

/** Permits everything: the refusal path belongs to the declared check's suite. */
function testAuthz(): AuthzService {
  return { hasPermission: async () => true } as unknown as AuthzService;
}

/** The two declared checks this composition builds, recorded rather than run. */
function testMount() {
  return {
    middlewares: { declaredCheck: vi.fn((declaration: unknown) => declaration) },
  } as unknown as ApiTrpcFeatureMount;
}

function composePorts() {
  const credentials = credentialClient();
  const service = PostgresUserCredentialAdapter.create({
    database: credentials.database,
    passwords: new TestPasswordHasher(),
  }).build();
  const prisma = portsPrisma();

  // Every group this composition spreads but does not exercise here. Empty on
  // read and empty on spread, so the record builds without a stub per group.
  const emptyGroup = (): unknown =>
    new Proxy(
      {},
      {
        get: () => emptyGroup(),
      },
    );

  // The four entries as the identity half publishes them: forwarding, with the
  // service holding every rule about the rows.
  const userPorts = {
    rotatePassword: (
      _ctx: unknown,
      input: Readonly<{ userId: string; currentPassword: string; newPassword: string }>,
    ) => service.rotatePassword(input),
    tryFindAuth0DatabaseAccount: (_ctx: unknown, input: Readonly<{ userId: string }>) =>
      service.tryFindAuth0DatabaseAccount(input),
    listLinkedAccounts: (_ctx: unknown, input: Readonly<{ userId: string }>) =>
      service.listLinkedAccounts(input),
    unlinkAccount: (_ctx: unknown, input: Readonly<{ userId: string; accountId: string }>) =>
      service.unlinkAccount(input),
  };

  const collaborators = new Proxy({ user: userPorts } as Record<string, unknown>, {
    get: (target, property) => (property in target ? target[property as string] : emptyGroup()),
  }) as never;

  const ports = createApiTrpcPorts({
    prisma,
    authz: testAuthz(),
    audit: void 0,
    mount: testMount(),
    collaborators,
  });

  return { ports, prisma, credentials };
}

describe("given the API process's tRPC ports composed on its own connection", () => {
  describe("when a signed-in person changes their own password", () => {
    /**
     * The composition's client refuses `account` outright, so a rotation that
     * completes proves the read and the write were somebody else's — and the
     * assertions below say whose: the feature's repository, with its own
     * predicate and its own selection.
     */
    /** @scenario "Credential password hashes never leave the user feature" */
    it("rotates through the user feature and never touches this connection's account table", async () => {
      const { ports, credentials } = composePorts();

      await expect(
        ports.user.rotatePassword(CTX, {
          userId: USER_ID,
          currentPassword: CURRENT_PASSWORD,
          newPassword: NEW_PASSWORD,
        }),
      ).resolves.toBe("rotated");

      expect(credentials.account.findFirst).toHaveBeenCalledWith({
        where: { userId: USER_ID, provider: "credential" },
        select: { id: true, password: true },
      });
      expect(credentials.account.update).toHaveBeenCalledWith({
        where: { id: CREDENTIAL_ACCOUNT_ID },
        data: { password: `hashed:${NEW_PASSWORD}` },
      });
    });

    it("answers with a word rather than the stored hash on every outcome", async () => {
      const { ports } = composePorts();

      const wrong = await ports.user.rotatePassword(CTX, {
        userId: USER_ID,
        currentPassword: "not-the-current-one",
        newPassword: NEW_PASSWORD,
      });
      const rotated = await ports.user.rotatePassword(CTX, {
        userId: USER_ID,
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      });

      expect(wrong).toBe("wrong_password");
      expect(rotated).toBe("rotated");
      for (const answer of [wrong, rotated]) {
        expect(String(answer)).not.toContain("hashed:");
      }
    });

    it("reports a passkey-only account as having no password rather than refusing it", async () => {
      const { ports, credentials } = composePorts();
      credentials.account.findFirst.mockResolvedValueOnce(null);

      await expect(
        ports.user.rotatePassword(CTX, {
          userId: USER_ID,
          currentPassword: CURRENT_PASSWORD,
          newPassword: NEW_PASSWORD,
        }),
      ).resolves.toBe("no_password");
    });
  });

  describe("when the settings page reads the sign-in methods this person holds", () => {
    it("lists them through the feature, carrying no credential column", async () => {
      const { ports } = composePorts();

      const linked = await ports.user.listLinkedAccounts(CTX, { userId: USER_ID });

      expect(linked).toEqual([
        { id: CREDENTIAL_ACCOUNT_ID, provider: "credential", providerAccountId: USER_ID },
        { id: AUTH0_ACCOUNT_ID, provider: "auth0", providerAccountId: "auth0|abc123" },
      ]);
      expect(JSON.stringify(linked)).not.toContain("password");
    });

    it("finds the Auth0 database identity through the feature's own subject prefix", async () => {
      const { ports, credentials } = composePorts();

      await expect(
        ports.user.tryFindAuth0DatabaseAccount(CTX, { userId: USER_ID }),
      ).resolves.toEqual({ providerAccountId: "auth0|abc123" });
      expect(credentials.account.findFirst).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          provider: "auth0",
          providerAccountId: { startsWith: "auth0|" },
        },
        select: { providerAccountId: true },
      });
    });

    it("removes one method under the serializable transaction the feature owns", async () => {
      const { ports, credentials } = composePorts();

      await expect(
        ports.user.unlinkAccount(CTX, { userId: USER_ID, accountId: AUTH0_ACCOUNT_ID }),
      ).resolves.toBe("unlinked");

      expect(credentials.client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: "Serializable",
      });
      expect(credentials.account.delete).toHaveBeenCalledWith({
        where: { id: AUTH0_ACCOUNT_ID },
      });
    });

    it("refuses to remove the last one", async () => {
      const { ports, credentials } = composePorts();
      credentials.account.count.mockResolvedValueOnce(1);

      await expect(
        ports.user.unlinkAccount(CTX, { userId: USER_ID, accountId: AUTH0_ACCOUNT_ID }),
      ).resolves.toBe("last_account");
      expect(credentials.account.delete).not.toHaveBeenCalled();
    });
  });

  describe("when a sign-up asks whether an address is already taken", () => {
    /**
     * The contrast that keeps the rule above from being read as "this
     * composition reads nothing". `User` is a different table with no
     * credential on it, and this read stays here.
     */
    it("asks this process's own connection, case-insensitively", async () => {
      const { ports, prisma } = composePorts();

      await expect(ports.user.emailIsTaken(CTX, { email: "Somebody@Example.com" })).resolves.toBe(
        false,
      );
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: { equals: "Somebody@Example.com", mode: "insensitive" } },
      });
    });
  });
});

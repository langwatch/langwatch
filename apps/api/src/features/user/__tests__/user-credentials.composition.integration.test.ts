/**
 * What the user feature's composition reads on its own connection, and how.
 *
 * The four account answers behind `/settings/authentication` — the password
 * rotation, the Auth0 subject lookup, the linked-method list and the unlink —
 * used to be `prisma.account` statements in the API's tRPC ports composition,
 * one of them a `select` naming `password`, the bcrypt hash a credential
 * sign-in is checked against.
 *
 * Nothing leaked. What was wrong is the seam. `prisma-containment` governs
 * which modules may NAME the generated client, not which rows they then ask
 * for, so a composition that legitimately holds a client could select a
 * credential column with no rule about that column attached to the read.
 *
 * So the client below records every account statement the composed feature
 * makes, honouring `select` rather than ignoring it, and what is pinned is
 * WHOSE read each one is and WHAT crosses the port: the predicate and the
 * selection are `PrismaUserCredentialRepository`'s, the hash is compared and
 * discarded inside `UserCredentialService`, and every answer a port returns is
 * a word rather than a stored hash.
 */
// @vitest-environment node
import { compareSync, hashSync } from "bcrypt";
import type { AuthService } from "@langwatch/auth-contract";
import { IdentityEventingPort } from "@langwatch/identity-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { UserService } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";
import { composeUserFeature } from "../user.composition";

const USER_ID = "user-1";
const CREDENTIAL_ACCOUNT_ID = "account-credential";
const AUTH0_ACCOUNT_ID = "account-auth0";
const CURRENT_PASSWORD = "the-current-one";
const NEW_PASSWORD = "the-next-one";

/** The request context these ports take and none of them read. */
const CTX = {} as never;

/** A stored bcrypt hash, in the deployment's own format. */
const STORED_HASH = hashSync(CURRENT_PASSWORD, 10);

/** The two sign-in methods this person holds, as rows. */
function accountRows() {
  return [
    {
      id: CREDENTIAL_ACCOUNT_ID,
      userId: USER_ID,
      provider: "credential",
      providerAccountId: USER_ID,
      password: STORED_HASH,
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
 * The ONE connection the composed feature holds, recording every statement.
 *
 * `select` is honoured rather than ignored: a repository that asked for the
 * credential column would be visible in what came back, and a test that
 * returned whole rows regardless could not tell the two apart.
 */
function testPrisma() {
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
    update: vi.fn(async (_input: { where: { id: string }; data: { password: string } }) => rows[0]),
    count: vi.fn(async () => rows.length),
    delete: vi.fn(async () => rows[0]),
  };

  const user = { findFirst: vi.fn(async () => null) };

  const client = {
    account,
    user,
    $transaction: vi.fn(async (run: (transaction: unknown) => Promise<unknown>) =>
      run({ account }),
    ),
  };

  return { client: client as unknown as PrismaClient, account, user, raw: client };
}

/** No event stack: nothing here spends an identifier command. */
class SilentEventing extends IdentityEventingPort {
  async tryPipelineCommand() {
    return null;
  }
}

function composeFeature() {
  const prisma = testPrisma();
  const feature = composeUserFeature({
    prisma: prisma.client,
    peers: {
      users: {} as unknown as UserService,
      auth: {} as unknown as AuthService,
      organizations: {} as unknown as OrganizationService,
      resolveAuthProvider: async () => "email",
    },
    eventing: new SilentEventing(),
    rateLimit: async () => ({ allowed: true, resetAt: Date.now() + 60_000 }),
    deployment: {},
    processName: "langwatch-api",
  });

  return { ports: feature.ports, prisma };
}

describe("given the API process's user feature composed on its own connection", () => {
  describe("when a signed-in person changes their own password", () => {
    /**
     * The predicate and the selection are the feature repository's, and the
     * hash it reads never reaches the port: what comes back is a word.
     */
    /** @scenario "Credential password hashes never leave the user feature" */
    it("rotates through the feature's own repository, with its own predicate and selection", async () => {
      const { ports, prisma } = composeFeature();

      await expect(
        ports.user.rotatePassword(CTX, {
          userId: USER_ID,
          currentPassword: CURRENT_PASSWORD,
          newPassword: NEW_PASSWORD,
        }),
      ).resolves.toBe("rotated");

      expect(prisma.account.findFirst).toHaveBeenCalledWith({
        where: { userId: USER_ID, provider: "credential" },
        select: { id: true, password: true },
      });
      const written = prisma.account.update.mock.calls[0]?.[0];
      if (!written) throw new Error("the rotation wrote nothing");
      expect(written.where).toEqual({ id: CREDENTIAL_ACCOUNT_ID });
      // Written in the deployment's own stored format, and it is the NEW
      // password that was written rather than the one it replaced.
      expect(compareSync(NEW_PASSWORD, written.data.password)).toBe(true);
      expect(compareSync(CURRENT_PASSWORD, written.data.password)).toBe(false);
    });

    it("answers with a word rather than the stored hash on every outcome", async () => {
      const { ports } = composeFeature();

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
        expect(String(answer)).not.toContain("$2");
        expect(String(answer)).not.toContain(STORED_HASH);
      }
    });

    it("reports a passkey-only account as having no password rather than refusing it", async () => {
      const { ports, prisma } = composeFeature();
      prisma.account.findFirst.mockResolvedValueOnce(null);

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
      const { ports } = composeFeature();

      const linked = await ports.user.listLinkedAccounts(CTX, { userId: USER_ID });

      expect(linked).toEqual([
        { id: CREDENTIAL_ACCOUNT_ID, provider: "credential", providerAccountId: USER_ID },
        { id: AUTH0_ACCOUNT_ID, provider: "auth0", providerAccountId: "auth0|abc123" },
      ]);
      expect(JSON.stringify(linked)).not.toContain("password");
    });

    it("finds the Auth0 database identity through the feature's own subject prefix", async () => {
      const { ports, prisma } = composeFeature();

      await expect(
        ports.user.tryFindAuth0DatabaseAccount(CTX, { userId: USER_ID }),
      ).resolves.toEqual({ providerAccountId: "auth0|abc123" });
      expect(prisma.account.findFirst).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          provider: "auth0",
          providerAccountId: { startsWith: "auth0|" },
        },
        select: { providerAccountId: true },
      });
    });

    it("removes one method under the serializable transaction the feature owns", async () => {
      const { ports, prisma } = composeFeature();

      await expect(
        ports.user.unlinkAccount(CTX, { userId: USER_ID, accountId: AUTH0_ACCOUNT_ID }),
      ).resolves.toBe("unlinked");

      expect(prisma.raw.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: "Serializable",
      });
      expect(prisma.account.delete).toHaveBeenCalledWith({
        where: { id: AUTH0_ACCOUNT_ID },
      });
    });

    it("refuses to remove the last one", async () => {
      const { ports, prisma } = composeFeature();
      prisma.account.count.mockResolvedValueOnce(1);

      await expect(
        ports.user.unlinkAccount(CTX, { userId: USER_ID, accountId: AUTH0_ACCOUNT_ID }),
      ).resolves.toBe("last_account");
      expect(prisma.account.delete).not.toHaveBeenCalled();
    });
  });

  describe("when a sign-up asks whether an address is already taken", () => {
    /**
     * The contrast that keeps the rule above from being read as "this feature
     * reads nothing directly". `User` is a different table with no credential
     * on it, and this read is answered on the connection itself.
     */
    it("asks this process's own connection, case-insensitively", async () => {
      const { ports, prisma } = composeFeature();

      await expect(ports.user.emailIsTaken(CTX, { email: "Somebody@Example.com" })).resolves.toBe(
        false,
      );
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: { equals: "Somebody@Example.com", mode: "insensitive" } },
      });
    });
  });
});

/**
 * @vitest-environment node
 * The account contract, stated once and run against every backend the package
 * can reach. The memory twin runs always; a Postgres backend joins the table
 * when this package declares a datastore in its vitest config.
 *
 * The two repositories are exercised over ONE bundle on purpose: they share the
 * `Account` rows, so a credential minted by the user repository has to be the
 * row the credential repository reads back.
 * @see packages/features/user/specs/user.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryUserRepositories } from "../memory/memory.user.repositories.ts";
import type { UserRepositories } from "../user.repositories.ts";

const backends: ReadonlyArray<{ name: string; create: () => UserRepositories }> = [
  { name: "memory", create: () => MemoryUserRepositories.create() },
];

const ISSUER = "credential";
const EMAIL = "ada@example.com";

describe.each(backends)("given the $name user repositories", ({ create }) => {
  describe("when nobody has been created", () => {
    /** @scenario "The memory and Postgres user repositories answer alike" */
    it("answers absence for a user id nobody minted", async () => {
      const { users } = create();

      await expect(users.findById("user-nobody")).resolves.toBeNull();
      await expect(users.findByEmail(EMAIL)).resolves.toBeNull();
      await expect(users.findAccountInfo("user-nobody")).resolves.toBeNull();
      await expect(users.getProfiles([])).resolves.toEqual([]);
    });

    it("reports no password for an account that does not exist", async () => {
      const { users } = create();

      await expect(users.hasPassword("user-nobody")).resolves.toBe(false);
    });
  });

  describe("when a credential account is minted", () => {
    it("reads the profile back by id and by email", async () => {
      const { users } = create();

      const created = await users.createCredentialUser({
        name: "Ada",
        email: EMAIL,
        passwordHash: "hash",
        issuer: ISSUER,
      });

      await expect(users.findById(created.id)).resolves.toMatchObject({
        id: created.id,
        name: "Ada",
        email: EMAIL,
      });
      await expect(users.findByEmail(EMAIL)).resolves.toMatchObject({ id: created.id });
    });

    /**
     * Rows written before sign-in lowercased addresses may carry capitals, so
     * the signup gate asks this question rather than the exact-match one: a
     * case-twin beside one would leave two accounts answering for one person.
     */
    it("finds the same account from an address typed with capitals", async () => {
      const { users } = create();

      const created = await users.createCredentialUser({
        name: "Ada",
        email: EMAIL,
        passwordHash: "hash",
        issuer: ISSUER,
      });

      await expect(users.findByEmailInsensitive("Ada@Example.com")).resolves.toMatchObject({
        id: created.id,
      });
      await expect(users.findByEmailInsensitive("other@example.com")).resolves.toBeNull();
    });

    it("reports that the account can sign in with a password", async () => {
      const { users } = create();

      const created = await users.createCredentialUser({
        name: "Ada",
        email: EMAIL,
        passwordHash: "hash",
        issuer: ISSUER,
      });

      await expect(users.hasPassword(created.id)).resolves.toBe(true);
    });

    it("hands the credential repository the same row, hash included", async () => {
      const { users, credentials } = create();

      const created = await users.createCredentialUser({
        name: "Ada",
        email: EMAIL,
        passwordHash: "hash",
        issuer: ISSUER,
      });

      await expect(
        credentials.findCredentialAccount({ userId: created.id }),
      ).resolves.toMatchObject({ passwordHash: "hash" });
    });

    it("refuses a second first-password rather than overwriting one", async () => {
      const { users } = create();

      const created = await users.createCredentialUser({
        name: "Ada",
        email: EMAIL,
        passwordHash: "hash",
        issuer: ISSUER,
      });

      await expect(
        users.setFirstPassword({ id: created.id, passwordHash: "another", issuer: ISSUER }),
      ).resolves.toBe("already_set");
    });
  });

  describe("when a passkey account is minted", () => {
    it("leaves the credential row empty, so a first password can still be set", async () => {
      const { users } = create();

      const created = await users.createPasskeyUser({ email: EMAIL, issuer: ISSUER });

      await expect(users.hasPassword(created.id)).resolves.toBe(false);
      await expect(
        users.setFirstPassword({ id: created.id, passwordHash: "first", issuer: ISSUER }),
      ).resolves.toBe("set");
      await expect(users.hasPassword(created.id)).resolves.toBe(true);
    });
  });

  describe("when the account's preferences are written", () => {
    it("reads back the pinned home path", async () => {
      const { users } = create();
      const created = await users.createPasskeyUser({ email: EMAIL, issuer: ISSUER });

      await users.setLastHomePath({ id: created.id, path: "/me/usage" });

      await expect(users.findLastHomePath(created.id)).resolves.toBe("/me/usage");
    });

    it("dates the trace-explorer dismissal rather than flagging it", async () => {
      const { users } = create();
      const created = await users.createPasskeyUser({ email: EMAIL, issuer: ISSUER });
      const dismissedAt = new Date(42);

      await expect(
        users.setTraceExplorerTourDismissedAt({ id: created.id, dismissedAt }),
      ).resolves.toEqual({ dismissed: true, dismissedAt });
      await expect(users.getTraceExplorerTourPreference(created.id)).resolves.toEqual({
        dismissed: true,
        dismissedAt,
      });
    });

    it("dates the passkey-nudge dismissal", async () => {
      const { users } = create();
      const created = await users.createPasskeyUser({ email: EMAIL, issuer: ISSUER });
      const dismissedAt = new Date(42);

      await users.setPasskeyNudgeDismissedAt({ id: created.id, dismissedAt });

      await expect(users.getPasskeyNudgeStatus(created.id)).resolves.toEqual({
        hasPasskey: false,
        dismissedAt,
      });
    });

    it("refuses a preference write for a user nobody minted", async () => {
      const { users } = create();

      await expect(
        users.setLastHomePath({ id: "user-nobody", path: "/me" }),
      ).rejects.toThrow();
    });
  });

  describe("when the account is retired and restored", () => {
    it("stamps and then clears the deactivation date", async () => {
      const { users } = create();
      const created = await users.createPasskeyUser({ email: EMAIL, issuer: ISSUER });
      const deactivatedAt = new Date(42);

      await expect(users.setDeactivatedAt({ id: created.id, deactivatedAt })).resolves.toMatchObject(
        { deactivatedAt },
      );
      await expect(
        users.setDeactivatedAt({ id: created.id, deactivatedAt: null }),
      ).resolves.toMatchObject({ deactivatedAt: null });
    });
  });

  describe("when the avatar column is written", () => {
    it("reads the stored URL back on the profile, and clears it again", async () => {
      const { users } = create();
      const created = await users.createPasskeyUser({ email: EMAIL, issuer: ISSUER });

      await users.setAvatar({ id: created.id, image: "/api/user-avatar/p/o" });
      await expect(users.findById(created.id)).resolves.toMatchObject({
        image: "/api/user-avatar/p/o",
      });

      await users.setAvatar({ id: created.id, image: null });
      await expect(users.findById(created.id)).resolves.toMatchObject({ image: null });
    });
  });
});

describe.each(backends)("given the $name credential repository", ({ create }) => {
  describe("when the person holds one sign-in method", () => {
    /** @scenario "The memory and Postgres credential repositories answer alike" */
    it("refuses to unlink it, so nobody is left with no way in", async () => {
      const { users, credentials } = create();
      const created = await users.createCredentialUser({
        name: "Ada",
        email: EMAIL,
        passwordHash: "hash",
        issuer: ISSUER,
      });
      const [linked] = await credentials.findLinkedAccounts({ userId: created.id });

      await expect(
        credentials.unlinkAccount({ userId: created.id, accountId: linked?.id ?? "" }),
      ).resolves.toBe("last_account");
    });

    it("lists that method without its password", async () => {
      const { users, credentials } = create();
      const created = await users.createCredentialUser({
        name: "Ada",
        email: EMAIL,
        passwordHash: "hash",
        issuer: ISSUER,
      });

      const linked = await credentials.findLinkedAccounts({ userId: created.id });

      expect(linked).toHaveLength(1);
      expect(JSON.stringify(linked)).not.toContain("hash");
    });
  });

  describe("when the person holds no Auth0 database identity", () => {
    it("answers with absence rather than a social identity", async () => {
      const { users, credentials } = create();
      const created = await users.createCredentialUser({
        name: "Ada",
        email: EMAIL,
        passwordHash: "hash",
        issuer: ISSUER,
      });

      await expect(
        credentials.findAuth0DatabaseAccount({ userId: created.id }),
      ).resolves.toBeNull();
    });
  });

  describe("when a password is rotated", () => {
    it("stores the replacement on the same account row", async () => {
      const { users, credentials } = create();
      const created = await users.createCredentialUser({
        name: "Ada",
        email: EMAIL,
        passwordHash: "hash",
        issuer: ISSUER,
      });
      const account = await credentials.findCredentialAccount({ userId: created.id });

      await credentials.writePasswordHash({
        accountId: account?.id ?? "",
        passwordHash: "replacement",
      });

      await expect(
        credentials.findCredentialAccount({ userId: created.id }),
      ).resolves.toMatchObject({ passwordHash: "replacement" });
    });
  });
});

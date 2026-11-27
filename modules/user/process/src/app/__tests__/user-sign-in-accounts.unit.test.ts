/**
 * @vitest-environment node
 * The staff investigation read of the accounts behind one address (ADR-202, ops functions):
 * ids, method codes, flags and times, never a name, an address or a credential.
 * @see dev/docs/adr/202-ops-agent-access.md
 */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryUserCredentialRepository } from "../../repositories/memory/memory.user-signin-credential.repository.ts";
import { MemoryUserDatabase } from "../../repositories/memory/memory.user.database.ts";
import { MemoryUserRepositories } from "../../repositories/memory/memory.user.repositories.ts";
import { MemoryUserRepository } from "../../repositories/memory/memory.user.repository.ts";
import { createUserTestApp } from "./user.fixture.ts";

const SIGNED_IN_AT = new Date("2026-11-20T09:30:00Z");

async function seeded() {
  const database = MemoryUserDatabase.create({
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const users = MemoryUserRepository.create({ database });
  const { id } = await users.createCredentialUser({
    name: "Sam",
    email: "sam@acme.com",
    issuer: "local:credential",
    passwordHash: "hashed-secret",
    emailVerified: true,
  });
  const other = await users.createCredentialUser({
    name: "Kim",
    email: "kim@acme.com",
    issuer: "local:credential",
    passwordHash: "hashed-other",
    emailVerified: true,
  });
  const [row] = database.usersById([id]);
  if (!row) throw new Error("the user was not stored");
  database.writeUser({ ...row, twoFactorEnabled: true, lastLoginAt: fromDate(SIGNED_IN_AT) });
  for (const [index, provider] of ["google", "acme-okta"].entries()) {
    database.writeAccount({
      id: `account-${index}`,
      userId: id,
      type: "oauth",
      provider,
      issuer: `https://${provider}.example.com`,
      providerAccountId: `subject-${index}`,
      password: null,
    });
  }
  const app = createUserTestApp({
    repositories: {
      ...MemoryUserRepositories.create({ processStore: InMemoryProcessStore.createForTesting() }),
      users,
      credentials: MemoryUserCredentialRepository.create({ database }),
    },
  });
  return { app, id, otherId: other.id, createdAt: row.createdAt.epochMilliseconds };
}

describe("UserModule.findSignInAccounts", () => {
  describe("given an account with a password, Google and an organization connection", () => {
    it("answers its id, method codes, flags and times", async () => {
      const { app, id, createdAt } = await seeded();

      await expect(app.findSignInAccounts({ email: "sam@acme.com" })).resolves.toEqual([
        {
          userId: id,
          createdAt,
          lastSignInAt: SIGNED_IN_AT.getTime(),
          methods: ["google", "password", "sso"],
          twoStepEnabled: true,
          deactivated: false,
        },
      ]);
    });

    it("matches the address however it is typed, and names nobody else", async () => {
      const { app, id, otherId } = await seeded();

      const accounts = await app.findSignInAccounts({ email: "  Sam@ACME.com " });

      expect(accounts.map(({ userId }) => userId)).toEqual([id]);
      expect(JSON.stringify(accounts)).not.toContain(otherId);
    });

    it("carries no name, address, connection id or password hash", async () => {
      const { app } = await seeded();

      const text = JSON.stringify(await app.findSignInAccounts({ email: "sam@acme.com" }));

      for (const word of ["Sam", "acme", "okta", "hashed", "@"]) {
        expect(text).not.toContain(word);
      }
    });
  });

  describe("when no account holds the address", () => {
    it("answers an empty list", async () => {
      const { app } = await seeded();

      await expect(app.findSignInAccounts({ email: "nobody@acme.com" })).resolves.toEqual([]);
    });
  });

  describe("when the text is no address", () => {
    it("answers an empty list", async () => {
      const { app } = await seeded();

      await expect(app.findSignInAccounts({ email: "sam" })).resolves.toEqual([]);
    });
  });
});

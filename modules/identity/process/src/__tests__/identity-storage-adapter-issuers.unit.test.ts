/**
 * Parity with main's storage adapter on the legacy branch: the transaction is rebound to the
 * legacy engine, and an SSO connection's real issuer is translated both ways. Hermetic.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { type IdentityStack, identityStack, signUp } from "./support/storage-adapter-stack.ts";

const EMAIL = "olga@acme.com";
const CONNECTION = "ssoc_acme";
const REAL_ISSUER = "https://login.acme.example";
const SUBJECT = "subject-olga";

describe("given the identity storage adapter over the legacy engine", () => {
  let stack: IdentityStack;
  let userId: string;

  beforeEach(async () => {
    stack = identityStack({ inert: true, schemaBoundLegacy: true });
    await signUp(stack.auth, EMAIL);
    userId = String(stack.db.user?.[0]?.id);
  });

  const linkConnection = async (issuer: string) => {
    const context = await stack.auth.$context;
    await context.internalAdapter.linkAccount({
      userId,
      providerId: CONNECTION,
      issuer,
      accountId: SUBJECT,
    });
    return context;
  };

  describe("when better-auth runs work inside the adapter's transaction", () => {
    /** @scenario "The identity adapter runs a transaction over the rebound legacy engine" */
    it("opens one Postgres transaction and serves the work through it", async () => {
      const context = await stack.auth.$context;
      const before = stack.transactions.opened;

      const users = await context.adapter.transaction((trx) =>
        trx.findMany<{ id: string }>({ model: "user" }),
      );

      expect(stack.transactions.opened).toBe(before + 1);
      expect(users.map((row) => row.id)).toEqual([userId]);
    });
  });

  describe("when a connection account is looked up by its id beside its real issuer", () => {
    /** @scenario "A connection account is found by its real issuer beside its connection id" */
    it("returns the row", async () => {
      const context = await linkConnection(REAL_ISSUER);

      const found = await context.adapter.findOne<{ userId: string }>({
        model: "account",
        where: [
          { field: "providerId", value: CONNECTION },
          { field: "issuer", value: REAL_ISSUER },
          { field: "accountId", value: SUBJECT },
        ],
      });

      expect(found).toMatchObject({ userId });
    });
  });

  describe("when a built-in provider is looked up beside a foreign issuer", () => {
    /** @scenario "A built-in provider beside a foreign issuer stays unanswered" */
    it("returns no row", async () => {
      const context = await stack.auth.$context;
      await context.internalAdapter.linkAccount({
        userId,
        providerId: "github",
        issuer: "local:oauth:github",
        accountId: "sub-github-1",
      });

      const found = await context.adapter.findOne({
        model: "account",
        where: [
          { field: "providerId", value: "github" },
          { field: "issuer", value: REAL_ISSUER },
          { field: "accountId", value: "sub-github-1" },
        ],
      });

      expect(found).toBeNull();
    });
  });

  describe("when a backfilled connection account is looked up by the real issuer alone", () => {
    /** @scenario "A backfilled connection account is found by the issuer its connection registered" */
    it("asks for the connection's id and the subject, and returns the row", async () => {
      const context = await linkConnection(`local:oauth:${CONNECTION}`);
      stack.connections.push({ providerId: CONNECTION, issuer: REAL_ISSUER });

      const found = await context.adapter.findOne<{ userId: string }>({
        model: "account",
        where: [
          { field: "issuer", value: REAL_ISSUER },
          { field: "accountId", value: SUBJECT },
        ],
      });

      expect(found).toMatchObject({ userId });
    });
  });

  describe("when a connection account without an issuer is read", () => {
    /** @scenario "A connection account without an issuer is served the issuer its connection registered" */
    it("carries the registered issuer, not a synthetic one", async () => {
      const context = await linkConnection(REAL_ISSUER);
      stack.connections.push({ providerId: CONNECTION, issuer: REAL_ISSUER });
      for (const row of stack.db.account ?? []) {
        if (row.providerId === CONNECTION) row.issuer = null;
      }

      const found = await context.adapter.findOne<{ issuer: string }>({
        model: "account",
        where: [
          { field: "providerId", value: CONNECTION },
          { field: "accountId", value: SUBJECT },
        ],
      });

      expect(found).toMatchObject({ issuer: REAL_ISSUER });
    });
  });
});

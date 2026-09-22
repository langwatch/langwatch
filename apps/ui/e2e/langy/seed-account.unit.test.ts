/**
 * The account a scenario seeds for a person of their own
 * (specs/langy/langy-dogfood-scenarios.feature).
 */
import { compare } from "bcrypt";
import { describe, expect, it, vi } from "vitest";

import {
  type AccountStore,
  databaseUrlFromDotenv,
  resolveSeedDatabaseUrl,
  seedCredentialAccount,
} from "./seed-account";

const LOCAL_APP = "http://localhost:5560";
const LOCAL_DB = "postgresql://user:secret@localhost:5432/langwatch_db?schema=langwatch_db";

function fakeStore(existingUserId: string | null = null) {
  const rows: {
    account?: { name: string; email: string; passwordHash: string };
  } = {};
  const store: AccountStore = {
    findUserIdByEmail: vi.fn(async () => existingUserId),
    createVerifiedUserWithPassword: vi.fn(async (account) => {
      rows.account = account;
      return "user_1";
    }),
    close: vi.fn(async () => undefined),
  };
  return { store, rows };
}

describe("seeding a scenario's own account", () => {
  describe("given a local stack", () => {
    /** @scenario "A scenario's own account is seeded in the local stack's database" */
    it("writes a user and a password account the sign-in accepts", async () => {
      const { store, rows } = fakeStore();

      const { userId } = await seedCredentialAccount({
        name: "Riley",
        email: "riley@acme.test",
        password: "GuidedRun!2026",
        store,
      });

      expect(userId).toBe("user_1");
      expect(rows.account).toMatchObject({
        name: "Riley",
        email: "riley@acme.test",
      });
      // One write for both rows, so a failure never leaves a user with no
      // account behind.
      expect(store.createVerifiedUserWithPassword).toHaveBeenCalledOnce();
      expect(await compare("GuidedRun!2026", rows.account?.passwordHash ?? "")).toBe(true);
      expect(store.close).toHaveBeenCalledOnce();
    });

    it("reads the database address from the environment first", () => {
      const readDotenv = vi.fn(() => "DATABASE_URL=ignored");

      expect(
        resolveSeedDatabaseUrl({
          appBase: LOCAL_APP,
          env: { DATABASE_URL: LOCAL_DB },
          readDotenv,
        }),
      ).toBe(LOCAL_DB);
      expect(readDotenv).not.toHaveBeenCalled();
    });

    it("falls back to the app's own .env", () => {
      expect(
        resolveSeedDatabaseUrl({
          appBase: LOCAL_APP,
          env: {},
          readDotenv: () => `OTHER=1\nDATABASE_URL="${LOCAL_DB}"\n`,
        }),
      ).toBe(LOCAL_DB);
    });

    it("says what is missing when no database address is found", () => {
      expect(() =>
        resolveSeedDatabaseUrl({
          appBase: LOCAL_APP,
          env: {},
          readDotenv: () => undefined,
        }),
      ).toThrow(/set DATABASE_URL/);
    });

    it("refuses an address that already has an account, and still closes", async () => {
      const { store } = fakeStore("user_0");

      await expect(
        seedCredentialAccount({
          name: "Riley",
          email: "riley@acme.test",
          password: "GuidedRun!2026",
          store,
        }),
      ).rejects.toThrow(/already exists/);
      expect(store.createVerifiedUserWithPassword).not.toHaveBeenCalled();
      expect(store.close).toHaveBeenCalledOnce();
    });
  });

  describe("given something that is not on this machine", () => {
    /** @scenario "An account is never seeded outside this machine" */
    it("refuses a remote app and names its host alone", () => {
      let message = "";
      try {
        resolveSeedDatabaseUrl({
          appBase: "https://riley:hunter2@langwatch.acme.test/?token=tok_1",
          env: { DATABASE_URL: LOCAL_DB },
          readDotenv: () => undefined,
        });
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain("langwatch.acme.test");
      expect(message).not.toContain("hunter2");
      expect(message).not.toContain("tok_1");
    });

    /** @scenario "An account is never seeded outside this machine" */
    it("refuses a remote database and names its host alone, with no credential or query", () => {
      const remote = "postgresql://user:secret@db.acme.test:5432/langwatch?sslpassword=hunter2";

      let message = "";
      try {
        resolveSeedDatabaseUrl({
          appBase: LOCAL_APP,
          env: { DATABASE_URL: remote },
          readDotenv: () => undefined,
        });
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain("db.acme.test");
      expect(message).not.toContain("secret");
      expect(message).not.toContain("hunter2");
      expect(message).not.toContain("langwatch?");
    });

    it("names no part of an address that does not parse", () => {
      expect(() =>
        resolveSeedDatabaseUrl({
          appBase: LOCAL_APP,
          env: { DATABASE_URL: "not an address with secret" },
          readDotenv: () => undefined,
        }),
      ).toThrow(/points at an address that does not parse\.$/);
    });

    it("does not take a loopback word inside the credentials for the host", () => {
      expect(() =>
        resolveSeedDatabaseUrl({
          appBase: LOCAL_APP,
          env: { DATABASE_URL: "postgresql://localhost:x@db.acme.test/db" },
          readDotenv: () => undefined,
        }),
      ).toThrow(/db\.acme\.test/);
    });
  });

  describe("reading the app's .env", () => {
    it("takes the value with or without quotes", () => {
      expect(databaseUrlFromDotenv(`DATABASE_URL="${LOCAL_DB}"`)).toBe(LOCAL_DB);
      expect(databaseUrlFromDotenv(`DATABASE_URL=${LOCAL_DB}`)).toBe(LOCAL_DB);
      expect(databaseUrlFromDotenv("# DATABASE_URL=commented")).toBeUndefined();
    });
  });
});
